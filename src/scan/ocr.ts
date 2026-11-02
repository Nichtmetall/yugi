import { createWorker, PSM, type Worker } from 'tesseract.js';
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
  name: Worker;
  codes: Worker;
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

const SIG_W = 24;
const SIG_H = 35;
let sigCanvas: HTMLCanvasElement | null = null;

/** Winziges Graustufenbild des Rahmens, um Bewegung und Kartenwechsel billig zu erkennen. */
export function frameSignature(video: HTMLVideoElement, frame: Rect, view: { w: number; h: number }): Uint8Array {
  sigCanvas ??= Object.assign(document.createElement('canvas'), { width: SIG_W, height: SIG_H });
  const ctx = sigCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'medium';
  const s = sourceRect(video, frame, view);
  ctx.drawImage(video, s.x, s.y, s.w, s.h, 0, 0, SIG_W, SIG_H);
  const px = ctx.getImageData(0, 0, SIG_W, SIG_H).data;
  const out = new Uint8Array(SIG_W * SIG_H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  return out;
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
