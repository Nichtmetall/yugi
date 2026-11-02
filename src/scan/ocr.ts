import { createWorker, PSM, type Worker as TesseractWorker } from 'tesseract.js';
import {
  backgroundColor,
  BOTTOM_REGION,
  CARD_RATIO,
  clippedShare,
  frameProbabilities,
  NAME_REGION,
  ocrGray,
  type Region,
  SETCODE_REGION,
  sharpness,
  STATS_REGION,
  TEXT_REGION,
} from './image';
import { detectCard, warpQuad, type Quad } from './detect';
import type { DetectRequest, DetectResponse } from './detectWorker';

/** Kartenbreite beim Kopieren aus dem Video: mindestens so fein wie bisher, hoechstens so fein, dass es flott bleibt. */
const CARD_MIN_W = 720;
const CARD_MAX_W = 1400;

export interface OcrResult {
  name: string;
  /** Tesseract-Konfidenz der Namenszeile (0..100). */
  nameConf: number;
  codes: string;
  /** Wahrscheinlichkeit je Rahmenfarbe (Reihenfolge wie FRAME_GROUPS), aus dem Hintergrund des Namensfelds. */
  frame: number[];
}

/** Zwei Worker, damit Name und Codes gleichzeitig gelesen werden und keiner die Parameter umstellen muss. */
interface OcrWorkers {
  name: TesseractWorker;
  codes: TesseractWorker;
}

let workersPromise: Promise<OcrWorkers> | null = null;
let statusListener: ((text: string) => void) | null = null;

export function onOcrStatus(listener: ((text: string) => void) | null) {
  statusListener = listener;
}

const logger = (m: { status?: string; progress?: number }) => {
  if (m.status && m.status !== 'recognizing text') {
    const what = m.status.includes('traineddata') ? 'Sprachdaten für die Texterkennung' : 'Texterkennung';
    statusListener?.(`${what} wird geladen … ${Math.round((m.progress ?? 0) * 100)} %`);
  }
};

// Kartennamen und Codes sind keine Woerterbuchwoerter; das Woerterbuch "korrigiert" sie sonst falsch.
const NO_DICTIONARY = { load_system_dawg: '0', load_freq_dawg: '0' };

async function createNameWorker() {
  const w = await createWorker(['eng', 'deu'], 1, { logger }, NO_DICTIONARY);
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: '300' });
  return w;
}

async function createCodeWorker() {
  const w = await createWorker('eng', 1, { logger }, NO_DICTIONARY);
  await w.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/',
    user_defined_dpi: '300',
  });
  return w;
}

/** Laedt Tesseract (Sprachdaten werden im Browser gecacht). */
export function getOcrWorker(): Promise<OcrWorkers> {
  workersPromise ??= Promise.allSettled([createNameWorker(), createCodeWorker()]).then(([name, codes]) => {
    if (name.status === 'fulfilled' && codes.status === 'fulfilled') return { name: name.value, codes: codes.value };
    for (const r of [name, codes]) if (r.status === 'fulfilled') void r.value.terminate();
    workersPromise = null;
    throw name.status === 'rejected' ? name.reason : (codes as PromiseRejectedResult).reason;
  });
  return workersPromise;
}

type Rect = { x: number; y: number; w: number; h: number };

/** Rahmenkoordinaten (CSS-Pixel im Sucher) in Videopixel umrechnen; das Video ist per object-fit: cover skaliert. */
function sourceRect(video: HTMLVideoElement, frame: Rect, view: { w: number; h: number }): Rect {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(view.w / vw, view.h / vh);
  const ox = (view.w - vw * scale) / 2;
  const oy = (view.h - vh * scale) / 2;
  return { x: (frame.x - ox) / scale, y: (frame.y - oy) / scale, w: frame.w / scale, h: frame.h / scale };
}

/** Kopiert den Kartenausschnitt in Kameraaufloesung aus dem Video (nicht erst verkleinern und spaeter wieder vergroessern). */
export function grabCard(video: HTMLVideoElement, frame: Rect, view: { w: number; h: number }): HTMLCanvasElement {
  const s = sourceRect(video, frame, view);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, s.w)));
  canvas.height = Math.round(canvas.width / CARD_RATIO);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, s.x, s.y, s.w, s.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Breite des Schnappschusses fuer die Kartensuche: fein genug fuer die Kanten, klein genug fuer jedes Bild. */
const SNAP_W = 320;

export interface Snapshot {
  /** Sichtbares Sucherbild in Suchaufloesung. */
  px: ImageData;
  /** Sichtbarer Ausschnitt in Videopixeln. */
  src: Rect;
  /** CSS-Pixel im Sucher je Schnappschuss-Pixel. */
  scale: number;
}

const snapCanvases: HTMLCanvasElement[] = [];
function snapCanvas(level: number, width: number, height: number) {
  const c = (snapCanvases[level] ??= document.createElement('canvas'));
  if (c.width !== width || c.height !== height) Object.assign(c, { width, height });
  return c;
}

/** Das sichtbare Sucherbild, verkleinert fuer die Kartensuche. */
export function snapshot(video: HTMLVideoElement, view: { w: number; h: number }): Snapshot {
  const src = sourceRect(video, { x: 0, y: 0, w: view.w, h: view.h }, view);
  const width = SNAP_W;
  const height = Math.round((SNAP_W * view.h) / view.w);
  // Stufenweise halbieren: Manche Browser glaetten beim Verkleinern in einem Schritt kaum, dann zerfallen Kanten in
  // Treppen und Rauschen.
  let from: CanvasImageSource = video;
  let r = { ...src };
  let level = 0;
  while (r.w > width * 2) {
    const c = snapCanvas(level++, Math.round(r.w / 2), Math.round(r.h / 2));
    c.getContext('2d')!.drawImage(from, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    from = c;
    r = { x: 0, y: 0, w: c.width, h: c.height };
  }
  const out = snapCanvas(level, width, height);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(from, r.x, r.y, r.w, r.h, 0, 0, width, height);
  return { px: ctx.getImageData(0, 0, width, height), src, scale: view.w / width };
}

let detector: Worker | null | undefined;
let detectSeq = 0;
const pending = new Map<number, (quad: Quad | null) => void>();

/** Sucht die Karte im Schnappschuss (im Hintergrund-Thread, wo moeglich). Ecken in Schnappschuss-Pixeln. */
export function findCard(px: ImageData, prev: Quad | null): Promise<Quad | null> {
  if (detector === undefined) {
    try {
      detector = new Worker(new URL('./detectWorker.ts', import.meta.url), { type: 'module' });
      detector.onmessage = (ev: MessageEvent<DetectResponse>) => {
        pending.get(ev.data.id)?.(ev.data.quad);
        pending.delete(ev.data.id);
      };
      detector.onerror = () => {
        // Worker laesst sich nicht laden: ab jetzt im Hauptthread suchen, offene Anfragen ohne Ergebnis beenden.
        detector = null;
        for (const done of pending.values()) done(null);
        pending.clear();
      };
    } catch {
      detector = null;
    }
  }
  if (!detector) return Promise.resolve(detectCard(px, prev));
  const req: DetectRequest = { id: ++detectSeq, data: px.data, width: px.width, height: px.height, prev };
  return new Promise((resolve) => {
    pending.set(req.id, resolve);
    detector!.postMessage(req);
  });
}

/**
 * Kopiert die erkannte Karte entzerrt aus dem Video: aufrecht, im Kartenformat und in Kameraaufloesung (nicht aus dem
 * kleinen Schnappschuss). `quad` in Schnappschuss-Pixeln.
 */
export function grabQuad(video: HTMLVideoElement, snap: Snapshot, quad: Quad): HTMLCanvasElement {
  const k = snap.src.w / snap.px.width;
  const q = quad.map((p) => ({ x: snap.src.x + p.x * k, y: snap.src.y + p.y * k })) as Quad;
  const cardW = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2;
  const width = Math.round(Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, cardW)));
  const height = Math.round(width / CARD_RATIO);
  // Nur den umgebenden Ausschnitt kopieren, und nicht feiner als die fertige Karte.
  const scale = Math.min(1, width / cardW);
  const x0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p.y))));
  const x1 = Math.min(video.videoWidth, Math.ceil(Math.max(...q.map((p) => p.x))));
  const y1 = Math.min(video.videoHeight, Math.ceil(Math.max(...q.map((p) => p.y))));
  const area = document.createElement('canvas');
  area.width = Math.max(2, Math.round((x1 - x0) * scale));
  area.height = Math.max(2, Math.round((y1 - y0) * scale));
  const actx = area.getContext('2d', { willReadFrequently: true })!;
  actx.imageSmoothingQuality = 'high';
  actx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, area.width, area.height);
  const local = q.map((p) => ({ x: (p.x - x0) * (area.width / (x1 - x0)), y: (p.y - y0) * (area.height / (y1 - y0)) })) as Quad;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const out = ctx.createImageData(width, height);
  warpQuad(actx.getImageData(0, 0, area.width, area.height), local, out);
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Mittlere Helligkeitsabweichung zweier Signaturen (0..255). */
export function signatureDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function regionData(card: HTMLCanvasElement, r: Region): ImageData {
  const ctx = card.getContext('2d', { willReadFrequently: true })!;
  return ctx.getImageData(
    Math.round(r.x * card.width),
    Math.round(r.y * card.height),
    Math.max(1, Math.round(r.w * card.width)),
    Math.max(1, Math.round(r.h * card.height)),
  );
}

export interface CardQuality {
  /** Kantenschaerfe der Namenszeile; nur innerhalb derselben Szene vergleichbar. */
  sharpness: number;
  /** Anteil ausgebrannter Pixel in Textfeld und Set-Code-Bereich (0..1). */
  glare: number;
}

export function inspectCard(card: HTMLCanvasElement): CardQuality {
  return {
    sharpness: sharpness(regionData(card, NAME_REGION)),
    glare: Math.max(clippedShare(regionData(card, TEXT_REGION)), clippedShare(regionData(card, SETCODE_REGION))),
  };
}

/** Ausschnitt so skalieren, dass er etwa `height` Pixel hoch ist; die Schrift liegt dann bei 30 bis 60 px. */
function crop(card: HTMLCanvasElement, r: Region, height: number) {
  const sw = r.w * card.width;
  const sh = r.h * card.height;
  const scale = Math.min(4, Math.max(1, height / sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(card, r.x * card.width, r.y * card.height, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, img: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

/** Ausschnitt fuer Tesseract aufbereiten: kontraststaerkster Kanal, gestreckt, dunkle Schrift auf hellem Grund. */
function forOcr({ canvas, ctx, img }: ReturnType<typeof crop>): HTMLCanvasElement {
  const gray = ocrGray(img);
  const out = ctx.createImageData(img.width, img.height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    out.data[i] = out.data[i + 1] = out.data[i + 2] = gray[j];
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Set-Code-Zeile, ATK/DEF und Fusszeile untereinander auf weissen Grund: ein Erkennungslauf statt drei. */
function stack(parts: HTMLCanvasElement[], gap = 24): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(...parts.map((p) => p.width)) + gap * 2;
  out.height = parts.reduce((h, p) => h + p.height + gap, gap);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  let y = gap;
  for (const p of parts) {
    ctx.drawImage(p, gap, y);
    y += p.height + gap;
  }
  return out;
}

export async function readCard(card: HTMLCanvasElement): Promise<OcrResult> {
  const workers = await getOcrWorker();
  const name = crop(card, NAME_REGION, 120);
  const frame = frameProbabilities(backgroundColor(name.img));
  const codes = stack([
    forOcr(crop(card, SETCODE_REGION, 160)),
    forOcr(crop(card, STATS_REGION, 110)),
    forOcr(crop(card, BOTTOM_REGION, 160)),
  ]);
  const [n, c] = await Promise.all([workers.name.recognize(forOcr(name)), workers.codes.recognize(codes)]);
  return { name: n.data.text.trim(), nameConf: n.data.confidence, codes: c.data.text, frame };
}
