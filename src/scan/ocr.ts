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

let workerPromise: Promise<Worker> | null = null;
let statusListener: ((text: string) => void) | null = null;

export function onOcrStatus(listener: ((text: string) => void) | null) {
  statusListener = listener;
}

/** Laedt Tesseract mit Englisch + Deutsch (Sprachdaten werden im Browser gecacht). */
export function getOcrWorker(): Promise<Worker> {
  workerPromise ??= createWorker(['eng', 'deu'], 1, {
    logger: (m) => {
      if (m.status && m.status !== 'recognizing text') {
        const what = m.status.includes('traineddata') ? 'Sprachdaten für die Texterkennung' : 'Texterkennung';
        statusListener?.(`${what} wird geladen … ${Math.round((m.progress ?? 0) * 100)} %`);
      }
    },
  }).catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/** Kopiert den Kartenausschnitt aus dem Video in ein Canvas fester Groesse. */
export function grabCard(
  video: HTMLVideoElement,
  frame: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number },
): HTMLCanvasElement {
  // Das Video ist per object-fit: cover skaliert; Rahmenkoordinaten in Videopixel umrechnen.
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(view.w / vw, view.h / vh);
  const ox = (view.w - vw * scale) / 2;
  const oy = (view.h - vh * scale) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, (frame.x - ox) / scale, (frame.y - oy) / scale, frame.w / scale, frame.h / scale, 0, 0, CARD_W, CARD_H);
  return canvas;
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

export async function readCard(card: HTMLCanvasElement): Promise<OcrResult> {
  const worker = await getOcrWorker();

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' });
  const name = (await worker.recognize(prepare(card, NAME_REGION, 2))).data.text;

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
  });
  const setLine = (await worker.recognize(prepare(card, SETCODE_REGION, 2.5))).data.text;
  const bottom = (await worker.recognize(prepare(card, BOTTOM_REGION, 2.5))).data.text;

  return { name: name.trim(), codes: `${setLine}\n${bottom}` };
}
