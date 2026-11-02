// Reine Hilfsfunktionen fuer den Abgleich von OCR-Text mit der Kartendatenbank (ohne DOM, testbar mit node --test).

export interface NameEntry {
  key: string;
  id: number;
}

export interface NameHit {
  id: number;
  score: number;
}

/** Kleinbuchstaben, ohne Akzente/Umlaut-Punkte und Sonderzeichen: "Blauäugiger" -> "blauaugiger". */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Levenshtein-Distanz mit Abbruch, sobald `max` sicher ueberschritten ist (liefert dann max + 1). */
export function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Zeichen, die Tesseract auf Karten haeufig verwechselt. Solche Fehler kosten weniger als ein beliebiger Tippfehler,
// damit der richtige Name klar vor aehnlichen Namen landet.
const CONFUSION_COST = 0.4;
const MERGE_COST = 0.5;
const confusable = new Uint8Array(128 * 128);
const confuse = ([a, b]: string) => {
  confusable[a.charCodeAt(0) * 128 + b.charCodeAt(0)] = 1;
  confusable[b.charCodeAt(0) * 128 + a.charCodeAt(0)] = 1;
};
for (const p of ['o0', 'l1', 'i1', 'il', 's5', 'b8', 'z2', 'g6', 'g9', 'ce', 'uv']) {
  confuse(p); // Namen (normalisiert, klein)
  confuse(p.toUpperCase()); // Set-Codes (gross)
}
for (const p of ['OQ', 'OD', 'QD', 'IT']) confuse(p);
// Zwei Zeichen, die als eines gelesen werden (oder umgekehrt): "rn" <-> "m" usw. Index = das einzelne Zeichen.
const mergeFirst = new Uint8Array(128);
const mergeSecond = new Uint8Array(128);
for (const [one, [first, second]] of [
  ['m', 'rn'],
  ['d', 'cl'],
  ['w', 'vv'],
  ['u', 'ii'],
]) {
  mergeFirst[one.charCodeAt(0)] = first.charCodeAt(0);
  mergeSecond[one.charCodeAt(0)] = second.charCodeAt(0);
}

const substCost = (a: string, b: string) => {
  if (a === b) return 0;
  const i = a.charCodeAt(0) * 128 + b.charCodeAt(0);
  return i < confusable.length && confusable[i] ? CONFUSION_COST : 1;
};

let rowA = new Float64Array(64);
let rowB = new Float64Array(64);
let rowC = new Float64Array(64);
const NO_MATCH = 1e9;

/**
 * Editierdistanz (Zeilen = a, Spalten = b), in der typische OCR-Verwechslungen guenstiger sind. Liefert zugleich die
 * Distanz des Anfangs a[0..prefixRow) zu b, das spart beim Namensabgleich einen zweiten Durchlauf. Bricht ab, sobald
 * beide Grenzen sicher ueberschritten sind; Werte darueber sind dann NO_MATCH.
 */
function ocrDp(a: string, b: string, max: number, prefixRow: number, prefixMax: number): [number, number] {
  const n = b.length;
  // Jeder Laengenunterschied kostet mindestens eine Verschmelzung.
  const fullPossible = Math.abs(a.length - n) * MERGE_COST <= max;
  const lastRow = fullPossible ? a.length : Math.min(prefixRow, a.length);
  if (lastRow <= 0) return [fullPossible && n <= max ? n : NO_MATCH, NO_MATCH];
  if (rowA.length < n + 1) [rowA, rowB, rowC] = [0, 1, 2].map(() => new Float64Array(n + 32));
  let p2 = rowA;
  let p1 = rowB;
  let cur = rowC;
  for (let j = 0; j <= n; j++) p1[j] = j;
  let prevMin = 0;
  let prefix = NO_MATCH;
  for (let i = 1; i <= lastRow; i++) {
    const ca = a.charCodeAt(i - 1);
    const caPrev = i >= 2 ? a.charCodeAt(i - 2) : -1;
    const conf = ca < 128 ? ca * 128 : -1;
    const intoA = ca < 128 ? mergeFirst[ca] : 0;
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = p1[j - 1] + (ca === cb ? 0 : conf >= 0 && cb < 128 && confusable[conf + cb] ? CONFUSION_COST : 1);
      const del = p1[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      // zwei Zeichen in a, eines in b ("rn" gegen "m")
      if (cb < 128 && mergeFirst[cb] === caPrev && mergeSecond[cb] === ca && p2[j - 1] + MERGE_COST < v) v = p2[j - 1] + MERGE_COST;
      // ein Zeichen in a, zwei in b
      if (intoA && j >= 2 && intoA === b.charCodeAt(j - 2) && mergeSecond[ca] === cb && p1[j - 2] + MERGE_COST < v) {
        v = p1[j - 2] + MERGE_COST;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (i === prefixRow) prefix = cur[n];
    // Die naechste Zeile haengt von den letzten beiden ab.
    const bound = i < prefixRow ? Math.max(max, prefixMax) : max;
    if (rowMin > bound && prevMin > bound) return [NO_MATCH, prefix];
    prevMin = rowMin;
    [p2, p1, cur] = [p1, cur, p2];
  }
  return [fullPossible ? p1[n] : NO_MATCH, prefix];
}

/**
 * Editierdistanz, in der typische OCR-Verwechslungen (l/1/I, O/0, rn/m ...) guenstiger sind.
 * Bricht ab, sobald `max` sicher ueberschritten ist (liefert dann max + 1).
 */
export function ocrDistance(a: string, b: string, max: number): number {
  const d = ocrDp(a, b, max, -1, 0)[0];
  return d <= max ? d : max + 1;
}

interface NameScore {
  score: number;
  /** Nur Anfang oder Teil der gelesenen Zeile passt (Rest: Symbole, Rauschen oder ein laengerer Name). */
  partial: boolean;
}

/** `floor`: Treffer darunter interessieren nicht; je hoeher, desto frueher bricht die Distanzberechnung ab. */
function scoreKey(q: string, key: string, floor = 0.5): NameScore {
  const len = Math.max(q.length, key.length);
  const max = Math.min(0.45, 1 - floor) * len;
  // Angehaengte Zeichen (z. B. Attributsymbol als "2" gelesen): zusaetzlich nur den Anfang vergleichen.
  const prefixRow = q.length > key.length && key.length >= 5 ? key.length : -1;
  const prefixMax = key.length * 0.25;
  const [d, pd] = ocrDp(q, key, max, prefixRow, prefixMax);
  let score = d <= max ? 1 - d / len : 0;
  let partial = false;
  // OCR liest oft Rahmen- oder Attributsymbole mit; ein vollstaendig enthaltener Name ist trotzdem ein Treffer.
  if (key.length >= 6 && score < 0.9 && q.includes(key)) [score, partial] = [0.9, true];
  if (pd <= prefixMax) {
    const ps = (1 - pd / key.length) * 0.97;
    if (ps > score) [score, partial] = [ps, true];
  }
  return { score, partial };
}

/** Aehnlichkeit einer OCR-Zeile (normalisiert) mit einem Namensschluessel, 0..1. */
export const nameScore = (q: string, key: string): number => (q.length < 3 ? 0 : scoreKey(q, key).score);

/** Beste Namenstreffer fuer eine OCR-Zeile. Score 1 = identisch. */
export function matchNames(ocrText: string, entries: NameEntry[], top = 5): NameHit[] {
  const q = normalizeName(ocrText);
  if (q.length < 3) return [];
  const best = new Map<number, NameScore & { key: string }>();
  // Namen weit hinter dem bisher besten spielen fuer die Auswahl keine Rolle mehr: frueher abbrechen.
  let floor = 0.5;
  for (const e of entries) {
    const s = scoreKey(q, e.key, floor);
    if (s.score <= floor || s.score <= (best.get(e.id)?.score ?? 0)) continue;
    best.set(e.id, { ...s, key: e.key });
    floor = Math.max(floor, s.score - 0.3);
  }
  // "Dark Magician" erklaert von "Dark Magician Gir1" nur den Anfang. Gibt es einen laengeren Namen, der den Rest
  // ebenfalls erklaert ("Dark Magician Girl"), gewinnt dieser. Kurzer Rest (Symbol-Rauschen) zaehlt nicht.
  const all = [...best.values()];
  for (const a of all) {
    if (!a.partial) continue;
    const rest = q.length - a.key.length;
    for (const b of all) {
      if (b === a || b.score < 0.8 || b.key.length <= a.key.length || !b.key.includes(a.key)) continue;
      if (rest >= b.key.length - a.key.length - 1) a.score = Math.min(a.score, b.score - 0.1);
    }
  }
  return [...best.entries()]
    .map(([id, s]) => ({ id, score: s.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2', G: '6' };
const fixDigits = (s: string) => s.replace(/[OQDILSBZG|]/g, (ch) => DIGIT_FIX[ch] ?? ch);

/**
 * Set-Codes wie "LOB-DE001", "MP19-EN123", "LEDD-DEB01" oder "SDY-006" aus OCR-Text. Die Nummer hat drei Stellen, davor
 * steht die Region (auch verlesen wie "0E"). Buchstaben in der Nummer werden zu Ziffern, setCodeVariants stellt sie wieder her.
 */
export function extractSetCodes(text: string): string[] {
  const t = text.toUpperCase().replace(/[–—_~]/g, '-');
  const re = /([A-Z0-9]{2,5})\s?-\s?([A-Z0-9]{0,2})\s?([A-Z0-9|]{3})(?![A-Z0-9|])/g;
  const out = new Set<string>();
  for (const m of t.matchAll(re)) out.add(`${m[1]}-${m[2]}${fixDigits(m[3])}`);
  return [...out];
}

/**
 * Set-Codes auch aus unsauber gelesenem Text: Leerzeichen im Code ("YSY R-DEOO4", "YSYR-DEO1 1"), ein zusaetzliches
 * Zeichen in der Region ("SDWD-DEO026") oder Rauschen direkt davor ("NNSDWD-DE022"). Verankert am Bindestrich; davor
 * muss ein bekanntes Set-Kuerzel stehen (`isPrefix`), das laengste gewinnt. Die Nummer sind die letzten drei Zeichen
 * des Worts nach dem Bindestrich. Die Region faellt weg ("SDWD-026"), sie zaehlt fuer den Abgleich nicht.
 */
export function findSetCodes(text: string, isPrefix: (prefix: string) => boolean): string[] {
  const out = new Set<string>();
  for (const line of text.toUpperCase().replace(/[–—_~]/g, '-').split('\n')) {
    const words = line.replace(/\s*-\s*/g, '-').split(/[^A-Z0-9|-]+/);
    words.forEach((word, i) => {
      const [left, ...right] = word.split('-');
      if (!right.length) return;
      // Abgetrennte Einzelzeichen gehoeren noch zum Code: "YSY R-" bzw. "-DEO1 1".
      const before = left.length < 4 && words[i - 1] && !words[i - 1].includes('-') ? words[i - 1] + left : left;
      let tail = right.join('');
      if (tail.length < 5 && (words[i + 1]?.length ?? 3) <= 2) tail += words[i + 1];
      const region = tail.length - 3;
      if (region < 0 || region > 3) return;
      for (let len = Math.min(6, before.length); len >= 2; len--) {
        const prefix = prefixVariants(before.slice(-len)).find(isPrefix);
        if (prefix) {
          out.add(`${prefix}-${fixDigits(tail.slice(region))}`);
          break;
        }
      }
    });
  }
  return [...out];
}

/**
 * Set-Kuerzel, Region (EN, E, DE, G, ...; so kurz wie moeglich) und Nummer. Die Nummer endet immer auf eine Ziffer:
 * "001", "B01" (LEDD-ENB01) oder "SE1" (SOI-ENSE1).
 */
const SET_CODE = /^([A-Z0-9]{2,6})-([A-Z0-9]{0,2}?)(\d{2,4}|[A-Z]\d{2}|[A-Z]{2}\d)$/;

/**
 * Sprachunabhaengiger Schluessel: Das Regionskuerzel wird entfernt, damit deutsche Codes die englischen der Datenbank
 * finden ("LEDD-DEB01" und "LEDD-ENB01" ergeben beide "LEDD-B01").
 */
export function setCodeKey(code: string): string | null {
  const m = SET_CODE.exec(code.trim().toUpperCase());
  return m ? `${m[1]}-${m[3]}` : null;
}

/** 8-stellige Passcodes (unten links auf der Karte). */
export function extractPasscodes(text: string): number[] {
  const t = text.replace(/[OoQD]/g, '0').replace(/[Il|]/g, '1');
  const out = new Set<number>();
  for (const m of t.matchAll(/(?<!\d)(\d{8})(?!\d)/g)) out.add(Number(m[1]));
  return [...out];
}

const LETTER_FOR: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' };
const DIGIT_FOR: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6' };
/** Alle Buchstaben, die extractSetCodes zu dieser Ziffer macht. */
const LETTERS_FOR: Record<string, string> = {};
for (const [letter, digit] of Object.entries(DIGIT_FIX)) if (letter !== '|') LETTERS_FOR[digit] = (LETTERS_FOR[digit] ?? '') + letter;
const NUMBER_SHAPE = /^(\d{3}|[A-Z]\d{2}|[A-Z]{2}\d)$/;

/** Ein Set-Kuerzel mit vertauschten Buchstaben/Ziffern ("L0B" -> "L0B", "LOB"), hoechstens 16 Lesarten. */
function prefixVariants(prefix: string): string[] {
  let out = [''];
  for (const ch of prefix) {
    const alt = LETTER_FOR[ch] ?? DIGIT_FOR[ch];
    out = out.flatMap((p) => (alt && out.length < 16 ? [p + ch, p + alt] : [p + ch]));
  }
  return out;
}

/**
 * Set-Kuerzel mischen Buchstaben und Ziffern ("MP19", "RA01"): "L0B-DE005" kann auch "LOB-DE005" sein. In der Nummer
 * koennen die ersten beiden Stellen Buchstaben sein: "LEDD-DE801" kann auch "LEDD-DEB01" sein.
 */
export function setCodeVariants(code: string): string[] {
  const m = /^([A-Z0-9]{2,6})(-.*)$/.exec(code);
  if (!m) return [code];
  const prefixes = prefixVariants(m[1]);
  const rest = m[2];
  const head = rest.slice(0, -3);
  const num = rest.slice(-3);
  const options = (ch: string) => [ch, ...(LETTERS_FOR[ch] ?? '')];
  const nums = [num];
  if (rest.length >= 4) {
    for (const a of options(num[0]))
      for (const b of options(num[1])) if ((a !== num[0] || b !== num[1]) && NUMBER_SHAPE.test(a + b + num[2])) nums.push(a + b + num[2]);
  }
  return nums.flatMap((n) => prefixes.map((p) => `${p}${head}${n}`));
}

/** Zeichenweiser Vergleich ab Position `at`; Verwechslungen kosten weniger. */
function windowCost(want: string, text: string, at: number, limit: number): number {
  let cost = 0;
  for (let k = 0; k < want.length && cost <= limit; k++) cost += substCost(want[k], text[at + k]);
  return cost;
}

/** Wie windowCost fuer die Nummer: Wo eine Ziffer stehen muss, gilt ein verlesenes "O" als "0". */
function numberCost(want: string, text: string, at: number, limit: number): number {
  let cost = 0;
  for (let k = 0; k < want.length && cost <= limit; k++) {
    const ch = text[at + k];
    cost += substCost(want[k], /\d/.test(want[k]) ? fixDigits(ch) : ch);
  }
  return cost;
}

export interface PrintHit {
  /** Index in der uebergebenen Code-Liste. */
  index: number;
  /** Gelesenes Regionskuerzel (DE, EN, G, ..., auch verlesen wie "0E"), leer bei Codes ohne Region. */
  region: string;
  /** 0 = exakt, < 0.5 = eine typische Verwechslung, bis 1 = ein Zeichen falsch. */
  dist: number;
}

/**
 * Sucht die Drucke einer Kandidatenkarte unscharf im OCR-Text der Code-Bereiche. Anders als extractSetCodes
 * braucht das kein sauberes Muster: "L0B-DE0O5", "LOBDE005" oder "LOB-0E005" passen trotzdem zu "LOB-EN005".
 * Bei gleicher Naehe gewinnt der Druck mit der gelesenen Region.
 */
export function printMatch(text: string, codes: string[]): PrintHit | null {
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let best: PrintHit | null = null;
  let bestSameRegion = false;
  codes.forEach((code, index) => {
    const m = SET_CODE.exec(code.toUpperCase());
    if (!m) return;
    const [, prefix, codeRegion, num] = m;
    for (let i = 0; i + prefix.length + num.length <= t.length; i++) {
      const dp = windowCost(prefix, t, i, 1);
      if (dp > 1) continue;
      for (let r = 0; r <= 2; r++) {
        const at = i + prefix.length + r;
        if (at + num.length > t.length) break;
        const region = t.slice(i + prefix.length, at);
        const dist = dp + numberCost(num, t, at, 1);
        const sameRegion = region === codeRegion;
        if (dist <= 1 && (!best || dist < best.dist || (dist === best.dist && sameRegion && !bestSameRegion))) {
          best = { index, region, dist };
          bestSameRegion = sameRegion;
        }
      }
    }
  });
  return best;
}

/** Kleinste Abweichung (0, 1 oder 2 = keine Naehe) zwischen den gelesenen Ziffernfolgen und einem Passcode. */
export function passcodeDistance(text: string, id: number): number {
  const target = String(id).padStart(8, '0');
  let best = 2;
  for (const m of text.toUpperCase().matchAll(/[0-9OQDILSBZG|]+/g)) {
    if (m[0].length < 7 || m[0].length > 9) continue;
    best = Math.min(best, levenshtein(fixDigits(m[0]), target, 1));
  }
  return best;
}

export interface Stats {
  atk?: number;
  def?: number;
}

/** "ATK/2500 DEF/2100" (auch ohne Leerzeichen). Den LINK-Wert liest Tesseract in der Kartenschrift unzuverlaessig. */
export function extractStats(text: string): Stats {
  const t = text.toUpperCase().replace(/D[E3]F/g, ' DEF ').replace(/L[I1]NK/g, ' LINK ');
  const pick = (re: RegExp): number | undefined => {
    let best: string | undefined;
    // Mehrfach gelesen (Bereiche ueberlappen): die vollstaendigste Zahl gewinnt.
    for (const m of t.matchAll(re)) if (!best || m[1].length > best.length) best = m[1];
    const v = best === undefined ? NaN : Number(fixDigits(best));
    return Number.isInteger(v) ? v : undefined;
  };
  return { atk: pick(/A[T7I]K[ \t]*\/?[ \t]*([0-9OQDILSBZG|]{1,4})/g), def: pick(/DEF[ \t]*\/?[ \t]*([0-9OQDILSBZG|]{1,4})/g) };
}
