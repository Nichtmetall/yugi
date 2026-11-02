// Karte im Kamerabild finden und perspektivisch entzerren (ohne DOM, testbar mit node --test).
//
// Ablauf: Kanten (Sobel je Farbkanal, ausgeduennt) -> Geraden per Hough-Transformation -> aus je zwei fast parallelen
// Geradenpaaren Vierecke bilden -> das Viereck im Kartenformat mit den am besten belegten Seiten nehmen -> Seiten an
// die Kantenpunkte anpassen. Koordinaten sind kontinuierlich: Pixel (x, y) deckt [x, x + 1) x [y, y + 1) ab.
import type { Pixels } from './image';

export interface Point {
  x: number;
  y: number;
}

/** Ecken oben links, oben rechts, unten rechts, unten links (Karte aufrecht). */
export type Quad = [Point, Point, Point, Point];

/** Projektive Abbildung [a, b, c, d, e, f, g, h]: x' = (a x + b y + c) / (g x + h y + 1), y' = (d x + e y + f) / (g x + h y + 1). */
export type Homography = number[];

/** Hochkant-Seitenverhaeltnis der Karte (59 x 86 mm, wie CARD_RATIO in image.ts). */
const ASPECT = 86 / 59;

/** Abbildung, die die vier Punkte `from` auf `to` legt. */
export function homography(from: readonly Point[], to: readonly Point[]): Homography {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 9; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[8] / row[i]);
}

export function project(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Rechteck als Viereck (z. B. der feste Rahmen). */
export const rectQuad = (x: number, y: number, w: number, h: number): Quad => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Mittlere Verschiebung der Ecken. */
export const quadShift = (a: Quad, b: Quad) => a.reduce((s, p, i) => s + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / 4;

// ---------- Kanten ----------

/** Sobel-Schwelle: Stufe von etwa 12 Helligkeitswerten. */
const EDGE_MIN = 48;

interface Edges {
  w: number;
  h: number;
  /** Richtung der Kantennormale in 0..pi, -1 = kein Kantenpixel. */
  dir: Float32Array;
  /** Koordinaten der Kantenpixel (x, y abwechselnd). */
  list: Int32Array;
}

/**
 * Sobel je Farbkanal (der staerkste zaehlt, so trennt sich auch eine orange Karte von einem gleich hellen Holztisch),
 * dann nur Maxima quer zur Kante behalten: duenne Kanten geben scharfe Hough-Spitzen.
 */
function edgeMap(px: Pixels): Edges {
  const { width: w, height: h, data: d } = px;
  const n = w * h;
  const mag = new Float32Array(n);
  const gxs = new Float32Array(n);
  const gys = new Float32Array(n);
  const s = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      let best = 0;
      let bx = 0;
      let by = 0;
      for (let c = 0; c < 3; c++) {
        const i = k * 4 + c;
        const tl = d[i - s - 4];
        const tr = d[i - s + 4];
        const bl = d[i + s - 4];
        const br = d[i + s + 4];
        const gx = tr + 2 * d[i + 4] + br - tl - 2 * d[i - 4] - bl;
        const gy = bl + 2 * d[i + s] + br - tl - 2 * d[i - s] - tr;
        const m = gx * gx + gy * gy;
        if (m > best) [best, bx, by] = [m, gx, gy];
      }
      mag[k] = Math.sqrt(best);
      gxs[k] = bx;
      gys[k] = by;
    }
  }
  const dir = new Float32Array(n).fill(-1);
  const list: number[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const k = y * w + x;
      const m = mag[k];
      if (m < EDGE_MIN) continue;
      const gx = gxs[k];
      const gy = gys[k];
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      // Nachbarn in Gradientenrichtung (auf 45 Grad gerundet)
      const o = ay <= ax * 0.4142 ? 1 : ax <= ay * 0.4142 ? w : gx * gy > 0 ? w + 1 : w - 1;
      if (m < mag[k - o] || m <= mag[k + o]) continue;
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI) a -= Math.PI;
      dir[k] = a;
      list.push(x, y);
    }
  }
  return { w, h, dir, list: Int32Array.from(list) };
}

/** Winkelabstand zweier Richtungen modulo pi. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

// ---------- Geraden ----------

/** Gerade in Normalform: x cos(t) + y sin(t) = r. */
interface Line {
  t: number;
  r: number;
}

const THETA_BINS = 180;
/** Ein Kantenpixel stimmt nur fuer Winkel nahe seiner Gradientenrichtung (das spart Zeit und Fehlstimmen). */
const THETA_SPREAD = 3;
const MAX_LINES = 40;

function houghLines(e: Edges, minVotes: number): Line[] {
  const { w, h, list } = e;
  const dmax = Math.ceil(Math.hypot(w, h));
  const nr = 2 * dmax + 1;
  const acc = new Uint16Array(THETA_BINS * nr);
  const cos = new Float64Array(THETA_BINS);
  const sin = new Float64Array(THETA_BINS);
  for (let t = 0; t < THETA_BINS; t++) {
    cos[t] = Math.cos((t * Math.PI) / THETA_BINS);
    sin[t] = Math.sin((t * Math.PI) / THETA_BINS);
  }
  for (let i = 0; i < list.length; i += 2) {
    const x = list[i] + 0.5;
    const y = list[i + 1] + 0.5;
    const t0 = Math.round((e.dir[list[i + 1] * w + list[i]] / Math.PI) * THETA_BINS);
    for (let dt = -THETA_SPREAD; dt <= THETA_SPREAD; dt++) {
      const t = (t0 + dt + THETA_BINS) % THETA_BINS;
      acc[t * nr + Math.round(x * cos[t] + y * sin[t]) + dmax]++;
    }
  }
  const peaks: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < nr; r++) {
      const v = acc[t * nr + r];
      if (v < minVotes) continue;
      let max = true;
      for (let dt = -2; dt <= 2 && max; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= THETA_BINS) continue;
        for (let dr = -3; dr <= 3; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= nr || (dt === 0 && dr === 0)) continue;
          const u = acc[tt * nr + rr];
          // Bei gleichen Stimmen gewinnt die erste Zelle.
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            max = false;
            break;
          }
        }
      }
      if (max) peaks.push({ t, r, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const lines: Line[] = [];
  for (const p of peaks) {
    const line = { t: (p.t * Math.PI) / THETA_BINS, r: p.r - dmax };
    // Doppelte verwerfen; ueber den Winkelumbruch hinweg ist (t, r) dieselbe Gerade wie (t - pi, -r).
    const same = (l: Line) =>
      Math.abs(l.t - line.t) < 0.06 ? Math.abs(l.r - line.r) < 5 : Math.PI - Math.abs(l.t - line.t) < 0.06 && Math.abs(l.r + line.r) < 5;
    if (lines.some(same)) continue;
    lines.push(line);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

function intersect(a: Line, b: Line): Point | null {
  const ca = Math.cos(a.t);
  const sa = Math.sin(a.t);
  const cb = Math.cos(b.t);
  const sb = Math.sin(b.t);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.r * sb - b.r * sa) / det, y: (ca * b.r - cb * a.r) / det };
}

// ---------- Vierecke ----------

/** Kuerzeste Kartenseite als Anteil der kurzen Bildseite: kleiner liest die Texterkennung ohnehin nicht mehr. */
const MIN_SIDE = 0.2;
/** Erlaubtes Seitenverhaeltnis (lang / kurz); Schraeglage staucht eine Richtung. */
const MIN_ASPECT = 1.15;
const MAX_ASPECT = 1.85;
/** Anteil jeder Seite, der durch Kantenpunkte belegt sein muss (Finger duerfen einen Teil verdecken). */
const MIN_SIDE_SUPPORT = 0.4;
const MIN_MEAN_SUPPORT = 0.6;
/** Abgerundete Ecken liegen nicht auf den Geraden: Seitenenden beim Pruefen auslassen. */
const SIDE_INSET = 0.07;
/** Seitenabschnitt nahe einer Ecke, der fuer sich belegt sein soll. */
const END_SPAN = 0.22;
/** An jeder Ecke muss mindestens eine der beiden Seiten so gut belegt sein (ein Finger darf die andere verdecken). */
const MIN_CORNER_SUPPORT = 0.3;
/** Umschliesst ein Viereck das beste und liegt hoechstens so weit dahinter, ist das beste ein innerer Kartenrahmen. */
const NEST_MARGIN = 0.15;
/** Nach grober Bewertung werden nur so viele Vierecke genau bewertet. */
const SHORTLIST = 12;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Richtung der Normale (0..pi) zu einer Seite mit Einheitsvektor (ux, uy). */
function normalAngle(ux: number, uy: number): number {
  const t = Math.atan2(ux, -uy);
  return t < 0 ? t + Math.PI : t;
}

/** Ecken im Uhrzeigersinn ab oben links; null, wenn das Viereck nicht konvex oder nicht aufrecht ist. */
function orderQuad(p: Point[]): Quad | null {
  let signed = 0;
  for (let i = 0; i < 4; i++) signed += p[i].x * p[(i + 1) % 4].y - p[(i + 1) % 4].x * p[i].y;
  if (Math.abs(signed) < 1) return null;
  const q = signed > 0 ? p : [p[0], p[3], p[2], p[1]];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    // Konvex und keine extremen Winkel (Eckwinkel 50..130 Grad).
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const cosA = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (dist(a, b) * dist(b, c));
    if (cross <= 0 || Math.abs(cosA) > 0.643) return null;
  }
  const len = q.map((a, i) => dist(a, q[(i + 1) % 4]));
  // Kurze Seiten sind oben und unten; die obere ist die mit dem kleineren y.
  const first = len[0] + len[2] < len[1] + len[3] ? 0 : 1;
  const mid = (i: number) => (q[i].y + q[(i + 1) % 4].y) / 2;
  const top = mid(first) <= mid(first + 2) ? first : first + 2;
  const out = [0, 1, 2, 3].map((i) => q[(top + i) % 4]) as Quad;
  // Karte liegt quer: oben ist nicht bestimmbar.
  if (Math.abs(out[1].y - out[0].y) > Math.abs(out[1].x - out[0].x)) return null;
  return out;
}

/**
 * Anteil der Seite a-b (nur der Abschnitt t0..t1), an dem ein Kantenpixel passender Richtung hoechstens `band` px
 * neben der Seite liegt. Geprueft wird alle `step` px.
 */
function sideSupport(e: Edges, a: Point, b: Point, band = 2, t0 = SIDE_INSET, t1 = 1 - SIDE_INSET, step = 1): number {
  const len = dist(a, b);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const normal = normalAngle(ux, uy);
  const steps = Math.max(8, Math.floor((len * (t1 - t0)) / step));
  let hits = 0;
  for (let i = 0; i < steps; i++) {
    const t = t0 + ((t1 - t0) * (i + 0.5)) / steps;
    const cx = a.x + (b.x - a.x) * t - 0.5;
    const cy = a.y + (b.y - a.y) * t - 0.5;
    for (let k = -band; k <= band; k++) {
      const x = Math.round(cx - uy * k);
      const y = Math.round(cy + ux * k);
      if (x < 0 || y < 0 || x >= e.w || y >= e.h) continue;
      const d = e.dir[y * e.w + x];
      if (d >= 0 && angleDiff(d, normal) < 0.35) {
        hits++;
        break;
      }
    }
  }
  return hits / steps;
}

/**
 * Parallel zu ihren Seiten hat die Karte weitere starke Kanten (Rand, Unterkante des Textfelds), oft genauso gut
 * belegt wie die Aussenkante, und der Hintergrund kann parallele Linien haben (Maserung, andere Karten). Jede Seite
 * darf daher auf eine Kante in der Naehe wandern. Anteile der Kartenausdehnung quer zur Seite.
 */
const SHIFT_REACH = 0.08;
const SHIFT_SUPPORT = 0.5;
/** Hoechstens so weit liegt die naechste Kante beim Weg nach aussen (etwa die Breite des Kartenrands). */
const STEP_GAP = 0.038;
/** Farbabstand (colorDiff), ab dem die Farbe innerhalb einer Seite nicht mehr zu den anderen passt. */
const INSIDE_TOLERANCE = 22;
/** Abzug je Farbabstand ueber der halben Toleranz. */
const SPREAD_PENALTY = 0.01;

interface SideOption {
  a: Point;
  b: Point;
  /** Verschiebung nach aussen als Anteil der Kartenausdehnung. */
  shift: number;
  support: number;
  /** Mittlere Farbe knapp innerhalb der Seite. */
  inside: [number, number, number];
}

/** Mittlere Farbe entlang der Seite a-b, `inset` px nach innen versetzt, alle `step` px. */
function insideColor(px: Pixels, a: Point, b: Point, inset: number, step = 2): [number, number, number] {
  const len = dist(a, b);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const { width: w, height: h, data: d } = px;
  const sum = [0, 0, 0];
  let n = 0;
  for (let s = 0.1 * len; s < 0.9 * len; s += step) {
    const x = Math.floor(a.x + ((b.x - a.x) / len) * s + nx * inset);
    const y = Math.floor(a.y + ((b.y - a.y) / len) * s + ny * inset);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    sum[0] += d[i];
    sum[1] += d[i + 1];
    sum[2] += d[i + 2];
    n++;
  }
  return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [0, 0, 0];
}

/** Kanten parallel zur Seite a-b in ihrer Naehe, von innen nach aussen. */
function sideOptions(e: Edges, px: Pixels, a: Point, b: Point, size: number): SideOption[] {
  const len = dist(a, b);
  // Bei Ecken im Uhrzeigersinn zeigt (uy, -ux) nach aussen.
  const nx = (b.y - a.y) / len;
  const ny = -(b.x - a.x) / len;
  const r = Math.max(3, Math.round(SHIFT_REACH * size));
  const shifted = (o: number): [Point, Point] => [
    { x: a.x + nx * o, y: a.y + ny * o },
    { x: b.x + nx * o, y: b.y + ny * o },
  ];
  const exact: number[] = [];
  const near: number[] = [];
  for (let o = -r; o <= r; o++) {
    const [a2, b2] = shifted(o);
    exact.push(sideSupport(e, a2, b2, 0));
    near.push(sideSupport(e, a2, b2, 1));
  }
  const options: SideOption[] = [];
  // Kanten: lokale Maxima der genauen Belegung, die mit 1 px Toleranz gut belegt sind.
  for (let i = 0; i < exact.length; i++) {
    if (near[i] < SHIFT_SUPPORT) continue;
    if ((i > 0 && exact[i] < exact[i - 1]) || (i < exact.length - 1 && exact[i] <= exact[i + 1])) continue;
    const [a2, b2] = shifted(i - r);
    // Innen 1,5 px: liegt bei einer Karte auch aus der Ferne noch im Rand.
    options.push({ a: a2, b: b2, shift: (i - r) / size, support: near[i], inside: insideColor(px, a2, b2, 1.5) });
  }
  if (!options.length) {
    const [a2, b2] = shifted(0);
    return [{ a: a2, b: b2, shift: 0, support: near[r], inside: insideColor(px, a2, b2, 1.5) }];
  }
  return options;
}

/**
 * Farbabstand, der vor allem den Farbton vergleicht: Licht faellt oft schraeg, dann ist derselbe Kartenrand auf einer
 * Seite deutlich heller als auf der anderen. Helligkeit zaehlt nur schwach.
 */
function colorDiff(a: number[], b: number[]): number {
  const sa = a[0] + a[1] + a[2] + 30;
  const sb = b[0] + b[1] + b[2] + 30;
  let chroma = 0;
  for (let k = 0; k < 3; k++) chroma += Math.abs((a[k] + 10) / sa - (b[k] + 10) / sb);
  return (chroma / 2) * 255 + (0.25 * Math.abs(sa - sb)) / 3;
}
/** Kanalweiser Median von drei Farben. */
const median3 = (c: number[][]) => [0, 1, 2].map((k) => c.map((x) => x[k]).sort((p, q) => p - q)[1]);

/**
 * Lage der Aussenkante je Seite: von der Kante nahe der gefundenen Seite schrittweise nach aussen, solange die naechste
 * hoechstens STEP_GAP entfernt ist. Danach muss knapp innerhalb jeder Seite dieselbe Farbe liegen wie bei den anderen
 * drei (der Kartenrand); eine Seite auf einer Hintergrundlinie hat innen Tisch und wandert auf die aeusserste Kante
 * zurueck, die passt.
 */
function outerSides(options: SideOption[][]): SideOption[] {
  const sides = options.map((opts) => {
    let cur = opts.reduce((p, o) => (Math.abs(o.shift) < Math.abs(p.shift) ? o : p));
    for (;;) {
      const next = opts.filter((o) => o.shift > cur.shift && o.shift - cur.shift <= STEP_GAP).pop();
      if (!next) return cur;
      cur = next;
    }
  });
  for (let k = 0; k < 4; k++) {
    const ref = median3(sides.filter((_, i) => i !== k).map((o) => o.inside));
    if (colorDiff(sides[k].inside, ref) <= INSIDE_TOLERANCE) continue;
    const fit = options[k].filter((o) => colorDiff(o.inside, ref) <= INSIDE_TOLERANCE).pop();
    if (fit) sides[k] = fit;
  }
  return sides;
}

// ---------- Huelle ----------

/** Breite des grauen Aussenrands bis zur gedruckten Rahmenkante je Seite (oben, rechts, unten, links). */
const BORDER = [0.021, 0.029, 0.021, 0.029];
/**
 * Abstand der beiden Kanten des Bildfelds (Fase) von der oberen Rahmenkante. Wie BORDER Anteile der Kartenausdehnung,
 * gemessen an Scans echter Karten aller Rahmenarten: Zur Rahmenkante streut der Abstand kaum, zur Schnittkante um 1 %
 * (Fehlschnitt), so viel wie der Rand einer Huelle breit ist.
 */
const TOP_ART = [0.151, 0.16];
/** So weit darf die Rahmenkante innerhalb der Aussenkante liegen: Huelle plus Rand. */
const FRAME_REACH = 0.08;
/** Mittlere Belegung der beiden Bildfeldkanten, ab der eine Rahmenkante als gefunden gilt. */
const ART_MIN = 0.5;
/**
 * Rahmenkanten, deren Bildfeldkanten kaum schlechter belegt sind als bei der besten, gelten als gleich gut: Die Fase
 * hat mehrere Linien in gleichem Abstand, das Muster passt daher auch um eine Linie versetzt.
 */
const ART_TIE = 0.15;
/** Erlaubte Abweichung der Schnittkante vom Sollabstand zur Rahmenkante (Fehlschnitt, Messfehler). */
const BORDER_TOLERANCE = 0.012;
/** Seitlicher Rand einer Huelle: schmaler verschmilzt er mit der Kartenkante, breiter ist er nicht. */
const SLEEVE_MIN = 0.008;
const SLEEVE_MAX = 0.045;
/** Mindestbelegung der Kartenkante in der Huelle relativ zum Huellenrand. */
const SLEEVE_SUPPORT = 0.75;

/** Mittlere Belegung der Bildfeldkanten, wenn die obere Seite von `quad` die Rahmenkante ist. */
function artSupport(e: Edges, quad: Quad): number {
  const hm = homography(rectQuad(0, 0, 1, 1), quad);
  let sum = 0;
  for (const d of TOP_ART) {
    // Das Viereck reicht von der Rahmenkante bis zur unteren Schnittkante.
    const t = d / (1 - BORDER[0]);
    sum += sideSupport(e, project(hm, 0.2, t), project(hm, 0.8, t), 1, 0, 1);
  }
  return sum / TOP_ART.length;
}

/**
 * Liegt die Karte in einer Huelle, ist deren Rand so breit wie der graue Aussenrand der Karte, und die Suche nach der
 * Aussenkante landet auf der Huelle. Oben ist das sicher zu erkennen: Dort liegt das Bildfeld in festem Abstand zur
 * gedruckten Rahmenkante, und die Kartenkante ist die Kante um den Rand davor. Seitlich ist das Muster zu dicht fuer
 * das kleine Suchbild; steckt die Karte oben in einer Huelle, ruecken die Seiten auf die naechste Kante nach innen,
 * hinter der im Abstand des Rands die Rahmenkante liegt. Unten bleibt die Aussenkante: Rahmen, Textfeld und ATK/DEF-
 * Linie haben dort gleiche Abstaende, und die Karte liegt meist unten in der Huelle.
 */
function unsleeve(e: Edges, options: SideOption[][], sides: SideOption[]): SideOption[] {
  const out = [...sides];
  const top = out[0];
  const frames = options[0]
    .filter((o) => o.shift <= top.shift && top.shift - o.shift <= FRAME_REACH)
    .map((o) => {
      const quad = cornersOf(out.map((s, i) => (i === 0 ? o : s)).map((s) => lineThrough(s.a, s.b)));
      return { o, s: quad ? artSupport(e, quad) : 0 };
    });
  const best = Math.max(0, ...frames.map((f) => f.s));
  if (best < ART_MIN) return out;
  /** Kante im Abstand des Rands vor der Rahmenkante f. */
  const edgeFor = (k: number, f: SideOption) =>
    options[k]
      .filter((o) => o.shift <= out[k].shift && Math.abs(o.shift - f.shift - BORDER[k]) <= BORDER_TOLERANCE)
      .sort((p, q) => Math.abs(p.shift - f.shift - BORDER[k]) - Math.abs(q.shift - f.shift - BORDER[k]))[0];
  // Von aussen nach innen; ohne Huelle passt die Aussenkante schon zu einer davon.
  const near = frames.filter((f) => f.s >= best - ART_TIE).reverse();
  if (near.some((f) => edgeFor(0, f.o) === top)) return out;
  const edge = near.map((f) => edgeFor(0, f.o)).find((o) => o);
  if (!edge) return out;
  out[0] = edge;
  for (const k of [1, 3]) {
    const cur = out[k];
    // Optionen sind von innen nach aussen sortiert.
    const inner = options[k]
      .filter(
        (o) =>
          cur.shift - o.shift >= SLEEVE_MIN &&
          cur.shift - o.shift <= SLEEVE_MAX &&
          o.support >= SLEEVE_SUPPORT * cur.support &&
          options[k].some((f) => Math.abs(o.shift - f.shift - BORDER[k]) <= BORDER_TOLERANCE),
      )
      .pop();
    if (inner) out[k] = inner;
  }
  return out;
}

const lineThrough = (a: Point, b: Point): Line => {
  const len = dist(a, b);
  const t = normalAngle((b.x - a.x) / len, (b.y - a.y) / len);
  return { t, r: a.x * Math.cos(t) + a.y * Math.sin(t) };
};

/** Ecken aus den Seiten oben, rechts, unten, links. */
function cornersOf([top, right, bottom, left]: Line[]): Quad | null {
  const c = [intersect(left, top), intersect(top, right), intersect(right, bottom), intersect(bottom, left)];
  return c.every((p): p is Point => !!p) ? (c as Quad) : null;
}

/** Gerade durch die Kantenpixel entlang der Seite a-b (kleinste Quadrate senkrecht zur Geraden). */
function fitSide(e: Edges, a: Point, b: Point, band: number): Line | null {
  const len = dist(a, b);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const normal = normalAngle(ux, uy);
  const seen = new Set<number>();
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let s = len * SIDE_INSET; s < len * (1 - SIDE_INSET); s += 0.5) {
    for (let k = -band; k <= band; k++) {
      const x = Math.round(a.x + ux * s - uy * k - 0.5);
      const y = Math.round(a.y + uy * s + ux * k - 0.5);
      if (x < 0 || y < 0 || x >= e.w || y >= e.h) continue;
      const i = y * e.w + x;
      const d = e.dir[i];
      if (d < 0 || seen.has(i) || angleDiff(d, normal) >= 0.35) continue;
      seen.add(i);
      const px = x + 0.5;
      const py = y + 0.5;
      n++;
      sx += px;
      sy += py;
      sxx += px * px;
      syy += py * py;
      sxy += px * py;
    }
  }
  if (n < 10) return null;
  const mx = sx / n;
  const my = sy / n;
  const cxx = sxx / n - mx * mx;
  const cyy = syy / n - my * my;
  const cxy = sxy / n - mx * my;
  // Normale = Eigenvektor zum kleineren Eigenwert der Kovarianz.
  const t = 0.5 * Math.atan2(2 * cxy, cxx - cyy) + Math.PI / 2;
  return { t, r: mx * Math.cos(t) + my * Math.sin(t) };
}

interface Candidate {
  quad: Quad;
  score: number;
  /** Groesste Abweichung der Farbe knapp innerhalb einer Seite von den anderen drei (colorDiff). */
  spread: number;
}

/** Wie stark die Farbe knapp innerhalb einer Seite von den anderen abweicht (Kartenrand ist ringsum gleich). */
function insideSpread(colors: number[][]): number {
  return Math.max(...colors.map((c, k) => colorDiff(c, median3(colors.filter((_, i) => i !== k)))));
}

/** Flaeche (Ecken im Uhrzeigersinn). */
export const quadArea = (q: Quad) => q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0) / 2;

/** Liegt `inner` (bis auf 1 px) in `outer`? Beide konvex, Ecken im Uhrzeigersinn. */
function contains(outer: Quad, inner: Quad): boolean {
  return outer.every((a, k) => {
    const b = outer[(k + 1) % 4];
    const len = dist(a, b);
    return inner.every((p) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len >= -1);
  });
}

function sideLengths(q: Quad) {
  return {
    width: (dist(q[0], q[1]) + dist(q[2], q[3])) / 2,
    height: (dist(q[1], q[2]) + dist(q[3], q[0])) / 2,
  };
}

/**
 * Sucht die Karte (aufrecht, hoechstens etwa 45 Grad gedreht, vollstaendig im Bild). `prev` ist die Karte aus dem
 * letzten Bild: Vierecke in ihrer Naehe werden bevorzugt, damit der Rahmen nicht zwischen aehnlichen springt.
 */
export function detectCard(px: Pixels, prev?: Quad | null): Quad | null {
  const e = edgeMap(px);
  const { w, h } = e;
  const minSide = MIN_SIDE * Math.min(w, h);
  const lines = houghLines(e, Math.round(minSide * 0.6));

  // Fast parallele Paare (Perspektive laesst gegenueberliegende Seiten etwas zusammenlaufen).
  const pairs: { a: Line; b: Line; t: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (angleDiff(a.t, b.t) > 0.4) continue;
      // Abstand in der Bildmitte
      const da = a.r - (w / 2) * Math.cos(a.t) - (h / 2) * Math.sin(a.t);
      let db = b.r - (w / 2) * Math.cos(b.t) - (h / 2) * Math.sin(b.t);
      if (Math.abs(a.t - b.t) > Math.PI / 2) db = -db; // Normalen zeigen entgegengesetzt
      if (Math.abs(da - db) < minSide) continue;
      // Mittlere Richtung ueber doppelte Winkel (wegen des Umbruchs bei pi)
      const t = Math.atan2(Math.sin(2 * a.t) + Math.sin(2 * b.t), Math.cos(2 * a.t) + Math.cos(2 * b.t)) / 2;
      pairs.push({ a, b, t });
    }
  }

  /** Nah am Kartenformat (Schraeglage verzerrt es), gross und nah an der Karte aus dem letzten Bild. */
  const shape = (quad: Quad) => {
    const { width, height } = sideLengths(quad);
    const near = prev && quadShift(quad, prev) < 0.05 * Math.min(w, h) ? 0.15 : 0;
    return near - 0.6 * Math.abs(Math.log(height / width / ASPECT)) + 0.6 * Math.sqrt((width * height) / (w * h));
  };

  /**
   * Bewertung eines Vierecks; `step` ist der Abstand der Pruefpunkte in px. null, wenn eine Seite oder Ecke kaum belegt
   * ist.
   */
  const evaluate = (quad: Quad, step: number): Candidate | null => {
    const support: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = sideSupport(e, quad[k], quad[(k + 1) % 4], 2, SIDE_INSET, 1 - SIDE_INSET, step);
      if (v < MIN_SIDE_SUPPORT) return null;
      support.push(v);
    }
    const mean = support.reduce((s, v) => s + v, 0) / 4;
    if (mean < MIN_MEAN_SUPPORT) return null;
    // Auch an den Ecken belegt: Eine Hintergrundlinie neben der Karte bildet mit den verlaengerten Kartenseiten sonst
    // ein ebenso gut belegtes Viereck, dessen Seiten nur an einem Ende leer sind.
    const ends = quad.flatMap((c, k) => {
      const d = quad[(k + 1) % 4];
      return [sideSupport(e, c, d, 2, SIDE_INSET, END_SPAN, step), sideSupport(e, c, d, 2, 1 - END_SPAN, 1 - SIDE_INSET, step)];
    });
    // Ecke k beginnt Seite k und beendet Seite k - 1.
    if (quad.some((_, k) => Math.max(ends[2 * k], ends[(2 * k + 7) % 8]) < MIN_CORNER_SUPPORT)) return null;
    // Innen ringsum dieselbe Farbe: Bei einer Seite auf einer Hintergrundlinie oder einem inneren Rahmen liegt
    // innen Tisch, Bild oder Textfeld statt Kartenrand.
    const spread = insideSpread(quad.map((c, k) => insideColor(px, c, quad[(k + 1) % 4], 1.5, 2 * step)));
    const score =
      mean + 0.5 * Math.min(...support) + 0.5 * Math.min(...ends) + shape(quad) - SPREAD_PENALTY * Math.max(0, spread - INSIDE_TOLERANCE / 2);
    return { quad, score, spread };
  };

  // Grob bewerten (jeder dritte Pixel), dann die besten, untereinander verschiedenen genau.
  const rough: Candidate[] = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const p = pairs[i];
      const q = pairs[j];
      if (angleDiff(p.t, q.t) < 0.95) continue; // etwa 55..125 Grad zueinander
      const corners = [intersect(p.a, q.a), intersect(p.a, q.b), intersect(p.b, q.b), intersect(p.b, q.a)];
      if (corners.some((c) => !c || c.x < -1 || c.y < -1 || c.x > w + 1 || c.y > h + 1)) continue;
      const quad = orderQuad(corners as Point[]);
      if (!quad) continue;
      const { width, height } = sideLengths(quad);
      if (width < minSide || height / width < MIN_ASPECT || height / width > MAX_ASPECT) continue;
      const c = evaluate(quad, 3);
      if (c) rough.push(c);
    }
  }
  rough.sort((a, b) => b.score - a.score);
  const found: Candidate[] = [];
  const checked: Quad[] = [];
  for (const { quad } of rough) {
    if (checked.length >= SHORTLIST) break;
    if (checked.some((c) => quadShift(c, quad) < 1)) continue;
    checked.push(quad);
    const c = evaluate(quad, 1);
    if (c) found.push(c);
  }
  if (!found.length) return null;
  // Rand, Bild- und Textfeld bilden innere Vierecke, die oft etwas besser belegt sind als die Aussenkante.
  found.sort((a, b) => b.score - a.score);
  let best = found[0];
  for (const c of found) {
    if (c.score < found[0].score - NEST_MARGIN) break;
    if (c.spread <= INSIDE_TOLERANCE && quadArea(c.quad) > quadArea(best.quad) && contains(c.quad, best.quad)) best = c;
  }

  // Jede Seite auf die Aussenkante bringen.
  const q = best.quad;
  const { width, height } = sideLengths(q);
  const size = [height, width, height, width];
  const options = q.map((c, k) => sideOptions(e, px, c, q[(k + 1) % 4], size[k]));
  const sides = unsleeve(e, options, outerSides(options));
  const coarse = cornersOf(sides.map((s) => lineThrough(s.a, s.b)));
  if (!coarse) return q;
  const { width: cw, height: ch } = sideLengths(coarse);
  if (cw < minSide || ch / cw < MIN_ASPECT || ch / cw > MAX_ASPECT) return q;
  // Feinlage aus den Kantenpixeln; Hough-Raster (1 Grad, 1 px) und Verschiebung in ganzen Pixeln sind zu grob.
  const fitted = cornersOf(sides.map((s) => fitSide(e, s.a, s.b, 1) ?? lineThrough(s.a, s.b)));
  if (!fitted || fitted.some((c, k) => dist(c, coarse[k]) > 3)) return coarse;
  return fitted;
}

// ---------- Entzerren ----------

/** Entzerrt das Viereck `quad` (Koordinaten in `src`) bilinear auf das ganze Bild `dest`. */
export function warpQuad(src: Pixels, quad: Quad, dest: Pixels): void {
  const { width, height, data: out } = dest;
  const hm = homography(rectQuad(0, 0, width, height), quad);
  const [a, b, c, d, e, f, g, h] = hm;
  const { width: sw, height: sh, data: s } = src;
  for (let v = 0; v < height; v++) {
    const yv = v + 0.5;
    for (let u = 0; u < width; u++) {
      const xu = u + 0.5;
      const wq = g * xu + h * yv + 1;
      // Pixelmitten: Quellpixel i liegt bei i + 0.5
      let x = (a * xu + b * yv + c) / wq - 0.5;
      let y = (d * xu + e * yv + f) / wq - 0.5;
      x = x < 0 ? 0 : x > sw - 1 ? sw - 1 : x;
      y = y < 0 ? 0 : y > sh - 1 ? sh - 1 : y;
      const x0 = Math.min(sw - 2, x | 0);
      const y0 = Math.min(sh - 2, y | 0);
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (v * width + u) * 4;
      for (let k = 0; k < 3; k++) {
        const top = s[i00 + k] + (s[i10 + k] - s[i00 + k]) * fx;
        const bot = s[i01 + k] + (s[i11 + k] - s[i01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
}

const SIG_W = 24;
const SIG_H = 35;
/** Abtastpunkte je Signaturzelle und Achse: mittelt Schrift und Rauschen weg wie ein verkleinertes Bild. */
const SIG_SUB = 3;

/** Winziges Graustufenbild der Karte im Viereck, um Bewegung und Kartenwechsel billig zu erkennen. */
export function quadSignature(px: Pixels, quad: Quad): Uint8Array {
  const hm = homography(rectQuad(0, 0, SIG_W, SIG_H), quad);
  const { width: w, height: h, data: d } = px;
  const out = new Uint8Array(SIG_W * SIG_H);
  for (let j = 0; j < SIG_H; j++) {
    for (let i = 0; i < SIG_W; i++) {
      let sum = 0;
      for (let sj = 0; sj < SIG_SUB; sj++) {
        for (let si = 0; si < SIG_SUB; si++) {
          const p = project(hm, i + (si + 0.5) / SIG_SUB, j + (sj + 0.5) / SIG_SUB);
          const x = Math.min(w - 1, Math.max(0, Math.floor(p.x)));
          const y = Math.min(h - 1, Math.max(0, Math.floor(p.y)));
          const k = (y * w + x) * 4;
          sum += (d[k] * 77 + d[k + 1] * 150 + d[k + 2] * 29) >> 8;
        }
      }
      out[j * SIG_W + i] = Math.round(sum / (SIG_SUB * SIG_SUB));
    }
  }
  return out;
}
