// Kartengeometrie und reine Bildfunktionen auf RGBA-Pixeln (ohne DOM, testbar mit node --test).

// Kartenmasse 59 x 86 mm. Alle Regionen sind Anteile der Kartenbreite/-hoehe.
export const CARD_RATIO = 59 / 86;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NAME_REGION: Region = { x: 0.05, y: 0.035, w: 0.78, h: 0.085 };
// Set-Code sitzt bei normalen Karten rechts unter dem Artwork (bei Speed-Duel-Karten hoeher, neben "SPEED DUEL") ...
export const SETCODE_REGION: Region = { x: 0.45, y: 0.655, w: 0.52, h: 0.12 };
// ... bei Pendel-Karten unten links; dort steht auch immer der Passcode.
export const BOTTOM_REGION: Region = { x: 0.0, y: 0.92, w: 0.75, h: 0.075 };
/** "ATK/2500 DEF/2100" bzw. "ATK/2300 LINK-3" unten rechts im Textfeld. */
export const STATS_REGION: Region = { x: 0.5, y: 0.895, w: 0.47, h: 0.055 };
/** Textfeld: glaenzt bei Spiegelungen als Erstes aus. */
export const TEXT_REGION: Region = { x: 0.08, y: 0.76, w: 0.84, h: 0.13 };

export interface Pixels {
  /** RGBA wie in ImageData. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const luma = (d: Pixels['data'], i: number) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;

function histogram(gray: Uint8Array): Float64Array {
  const h = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

/** Otsu-Schwelle; `between` ist die Varianz zwischen Schrift- und Hintergrundklasse (Mass fuer Kontrast). */
export function otsu(hist: ArrayLike<number>): { threshold: number; between: number; darkShare: number } {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let w0 = 0;
  let sum0 = 0;
  let best = { threshold: 127, between: 0, darkShare: 0.5 };
  for (let t = 0; t < 255; t++) {
    w0 += hist[t];
    sum0 += t * hist[t];
    const w1 = total - w0;
    if (!w0 || !w1) continue;
    const m0 = sum0 / w0;
    const m1 = (sum - sum0) / w1;
    const between = (w0 / total) * (w1 / total) * (m0 - m1) ** 2;
    if (between > best.between) best = { threshold: t, between, darkShare: w0 / total };
  }
  return best;
}

function percentile(hist: ArrayLike<number>, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/**
 * Graustufen fuer die Texterkennung: nimmt den Kanal (Helligkeit, R, G oder B), in dem Schrift und
 * Hintergrund am staerksten getrennt sind (z. B. Goldschrift auf orangem Rahmen), streckt den Kontrast
 * zwischen dem 1. und 99. Perzentil (einzelne Glanzpunkte verderben ihn so nicht) und dreht hellen
 * Text auf dunklem Grund um.
 */
export function ocrGray(px: Pixels): Uint8Array {
  const n = px.width * px.height;
  const d = px.data;
  const channels = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    channels[0][j] = luma(d, i);
    channels[1][j] = d[i];
    channels[2][j] = d[i + 1];
    channels[3][j] = d[i + 2];
  }
  let gray = channels[0];
  let hist = histogram(gray);
  let split = otsu(hist);
  // Helligkeit bevorzugen; ein Farbkanal muss deutlich besser trennen.
  for (const c of channels.slice(1)) {
    const h = histogram(c);
    const s = otsu(h);
    if (s.between > split.between * 1.25) [gray, hist, split] = [c, h, s];
  }
  const lo = percentile(hist, n, 0.01);
  const hi = Math.max(lo + 1, percentile(hist, n, 0.99));
  // Die groessere Klasse ist der Hintergrund; ist sie dunkel, steht helle Schrift darauf.
  const invert = split.darkShare > 0.5;
  const out = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const v = Math.min(255, Math.max(0, ((gray[j] - lo) / (hi - lo)) * 255));
    out[j] = invert ? 255 - v : v;
  }
  return out;
}

/**
 * Schrift fuer die Code-Bereiche freistellen: schwarz auf weiss, alles andere weiss. Ein Pixel ist Schrift, wenn es
 * deutlich dunkler (`dark`) bzw. heller als seine Umgebung ist; eine globale Schwelle oder Polaritaet scheitert dort an
 * Artwork-Kante, Textbox-Rahmen und Glanz. Danach fallen Teile weg, die keine Zeichen sind: am Rand angeschnitten
 * (Rahmenlinien, Artwork, halbe Textzeilen), zu gross, zu breit oder zu klein.
 */
export function textMask(px: Pixels, dark: boolean): Uint8Array {
  const { width: w, height: h, data: d } = px;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) gray[j] = luma(d, i);
  // Integralbild fuer den Mittelwert der Umgebung
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const hist = histogram(gray);
  const margin = Math.max(10, 0.1 * (percentile(hist, n, 0.98) - percentile(hist, n, 0.02)));
  const r = Math.max(4, Math.round(h * 0.06));
  const ink = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      ink[y * w + x] = dark ? +(v < mean - margin) : +(v > mean + margin);
    }
  }

  const out = new Uint8Array(n).fill(255);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!ink[s] || seen[s]) continue;
    seen[s] = 1;
    let top = 0;
    let count = 0;
    stack[top++] = s;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    while (top) {
      const p = stack[--top];
      members[count++] = p;
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const cut = minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1;
    const line = bh > 4 && bw > bh * 4;
    if (cut || line || bh > h * 0.45 || bw > w * 0.25 || count < 10) continue;
    for (let k = 0; k < count; k++) out[members[k]] = 0;
  }
  return out;
}

/** Bildschaerfe als mittleres Quadrat des Laplace-Operators (unscharfe Bilder haben schwache Kanten). */
export function sharpness(px: Pixels): number {
  const { width: w, height: h, data: d } = px;
  if (w < 3 || h < 3) return 0;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = luma(d, i);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const lap = 4 * g[k] - g[k - 1] - g[k + 1] - g[k - w] - g[k + w];
      sum += lap * lap;
    }
  }
  return sum / ((w - 2) * (h - 2));
}

/** Anteil ausgebrannter Pixel (alle Kanaele fast weiss): Spiegelung oder Ueberbelichtung. */
export function clippedShare(px: Pixels): number {
  const d = px.data;
  let clipped = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) clipped++;
  return clipped / (d.length / 4 || 1);
}

/** Hintergrundfarbe des Namensfelds: Median der groesseren Helligkeitsklasse (also ohne die Schrift). */
export function backgroundColor(px: Pixels): [number, number, number] {
  const d = px.data;
  const n = px.width * px.height;
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) gray[j] = luma(d, i);
  const { threshold, darkShare } = otsu(histogram(gray));
  const darkBg = darkShare > 0.5;
  const hists = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  let count = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    if (gray[j] <= threshold !== darkBg) continue;
    hists[0][d[i]]++;
    hists[1][d[i + 1]]++;
    hists[2][d[i + 2]]++;
    count++;
  }
  return [percentile(hists[0], count, 0.5), percentile(hists[1], count, 0.5), percentile(hists[2], count, 0.5)];
}

// ---------- Kartentyp aus der Rahmenfarbe ----------

export const FRAME_GROUPS = ['normal', 'effect', 'ritual', 'fusion', 'synchro', 'xyz', 'link', 'spell', 'trap'] as const;
export type FrameGroup = (typeof FRAME_GROUPS)[number];

/** YGOPRODeck-frameType auf die Farbgruppe des Namensfelds abbilden (Pendel: obere Haelfte = Monsterfarbe). */
export function frameGroup(frameType: string): FrameGroup | null {
  const base = frameType.replace(/_pendulum$/, '');
  if (base === 'token') return 'synchro'; // grau-weiss wie Synchro
  return (FRAME_GROUPS as readonly string[]).includes(base) ? (base as FrameGroup) : null;
}

/** Farbort: Buntheit als Vektor in der Farbtonebene plus (schwaecher gewichtete) Helligkeit. */
function colorPoint([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
  }
  const rad = (hue * Math.PI) / 3;
  return [s * Math.cos(rad), s * Math.sin(rad), 0.6 * v];
}

/** Typische Namensfeld-Hintergruende (RGB), gemessen an YGOPRODeck-Kartenbildern. */
const FRAME_REFERENCE: Record<FrameGroup, [number, number, number]> = {
  normal: [195, 153, 82],
  effect: [184, 99, 55],
  ritual: [83, 120, 186],
  fusion: [138, 65, 157],
  synchro: [225, 225, 223],
  xyz: [34, 35, 36],
  link: [30, 99, 153],
  spell: [11, 147, 128],
  trap: [170, 40, 120],
};
const REFERENCE_POINTS = FRAME_GROUPS.map((g) => colorPoint(FRAME_REFERENCE[g]));
/** Weichheit der Zuordnung: kleiner = entschiedener. Kameralicht verschiebt Farben, daher bewusst weich. */
const FRAME_SOFTNESS = 0.08;

/** Wahrscheinlichkeit je Farbgruppe (Reihenfolge wie FRAME_GROUPS). */
export function frameProbabilities(rgb: [number, number, number]): number[] {
  const p = colorPoint(rgb);
  const w = REFERENCE_POINTS.map((q) => Math.exp(-Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / FRAME_SOFTNESS));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}
