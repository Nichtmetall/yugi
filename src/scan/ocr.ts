import { createWorker, PSM, type Worker } from 'tesseract.js';

// Kartenmasse 59 x 86 mm. Alle Regionen sind Anteile der Kartenbreite/-hoehe.
export const CARD_RATIO = 59 / 86;
const CARD_W = 720;
const CARD_H = Math.round(CARD_W / CARD_RATIO);

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NAME_REGION: Region = { x: 0.05, y: 0.035, w: 0.78, h: 0.085 };
// Set-Code sitzt bei normalen Karten rechts unter dem Artwork ...
const SETCODE_REGION: Region = { x: 0.45, y: 0.7, w: 0.52, h: 0.075 };
// ... bei Pendel-Karten unten links; dort steht auch immer der Passcode.
const BOTTOM_REGION: Region = { x: 0.0, y: 0.92, w: 0.75, h: 0.075 };

export interface OcrResult {
  name: string;
  codes: string;
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

async function createNameWorker() {
  const w = await createWorker(['eng', 'deu'], 1, { logger });
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  return w;
}

async function createCodeWorker() {
  const w = await createWorker('eng', 1, { logger });
  await w.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
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

/** Kopiert den Kartenausschnitt aus dem Video in ein Canvas fester Groesse. */
export function grabCard(video: HTMLVideoElement, frame: Rect, view: { w: number; h: number }): HTMLCanvasElement {
  const s = sourceRect(video, frame, view);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, s.x, s.y, s.w, s.h, 0, 0, CARD_W, CARD_H);
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

/** Ausschnitt vergroessern, in Graustufen wandeln und so drehen, dass dunkle Schrift auf hellem Grund steht. */
function prepare(card: HTMLCanvasElement, r: Region, upscale: number): HTMLCanvasElement {
  const sw = r.w * card.width;
  const sh = r.h * card.height;
  const out = document.createElement('canvas');
  out.width = Math.round(sw * upscale);
  out.height = Math.round(sh * upscale);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(card, r.x * card.width, r.y * card.height, sw, sh, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  const gray = new Uint8ClampedArray(px.length / 4);
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
    sum += g;
  }
  const mean = sum / gray.length;
  const range = Math.max(1, max - min);
  // Ueberwiegend dunkler Hintergrund (Xyz, Zauber, Fallen) -> invertieren.
  const invert = mean < min + range / 2;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v = ((gray[j] - min) / range) * 255;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Set-Code-Zeile und Fusszeile untereinander auf weissen Grund: ein Erkennungslauf statt zwei. */
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
  const [name, codes] = await Promise.all([
    workers.name.recognize(prepare(card, NAME_REGION, 2)),
    workers.codes.recognize(stack([prepare(card, SETCODE_REGION, 2.5), prepare(card, BOTTOM_REGION, 2.5)])),
  ]);
  return { name: name.data.text.trim(), codes: codes.data.text };
}
