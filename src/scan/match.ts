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

/** Beste Namenstreffer fuer eine OCR-Zeile. Score 1 = identisch. */
export function matchNames(ocrText: string, entries: NameEntry[], top = 5): NameHit[] {
  const q = normalizeName(ocrText);
  if (q.length < 3) return [];
  const best = new Map<number, number>();
  for (const e of entries) {
    const len = Math.max(q.length, e.key.length);
    const max = Math.floor(len * 0.45);
    let score = 0;
    if (Math.abs(q.length - e.key.length) <= max) {
      const d = levenshtein(q, e.key, max);
      if (d <= max) score = 1 - d / len;
    }
    // OCR liest oft Rahmen- oder Attributsymbole mit; ein vollstaendig enthaltener Name ist trotzdem ein Treffer.
    if (e.key.length >= 6 && q.includes(e.key)) score = Math.max(score, 0.9);
    // Angehaengte Zeichen (z. B. Attributsymbol als "2" gelesen): nur den Anfang vergleichen.
    if (q.length > e.key.length && e.key.length >= 5) {
      const pmax = Math.floor(e.key.length * 0.25);
      const d = levenshtein(q.slice(0, e.key.length), e.key, pmax);
      if (d <= pmax) score = Math.max(score, (1 - d / e.key.length) * 0.97);
    }
    if (score > 0.5 && score > (best.get(e.id) ?? 0)) best.set(e.id, score);
  }
  return [...best.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2', G: '6' };
const fixDigits = (s: string) => s.replace(/[OQDILSBZG|]/g, (ch) => DIGIT_FIX[ch] ?? ch);

/** Set-Codes wie "LOB-DE001", "MP19-EN123" oder "SDY-006" aus OCR-Text. */
export function extractSetCodes(text: string): string[] {
  const t = text.toUpperCase().replace(/[–—_~]/g, '-');
  const re = /([A-Z0-9]{2,5})\s?-\s?([A-Z]{0,2})\s?([0-9OQDILSBZG|]{3})(?![0-9])/g;
  const out = new Set<string>();
  for (const m of t.matchAll(re)) out.add(`${m[1]}-${m[2]}${fixDigits(m[3])}`);
  return [...out];
}

/** Sprachunabhaengiger Schluessel: Regionskuerzel (EN, DE, G, ...) wird entfernt. */
export function setCodeKey(code: string): string | null {
  const m = /^([A-Z0-9]{2,6})-([A-Z]{0,2})(\d{2,4})$/.exec(code.trim().toUpperCase());
  return m ? `${m[1]}-${m[3]}` : null;
}

/** 8-stellige Passcodes (unten links auf der Karte). */
export function extractPasscodes(text: string): number[] {
  const t = text.replace(/[OoQD]/g, '0').replace(/[Il|]/g, '1');
  const out = new Set<number>();
  for (const m of t.matchAll(/(?<!\d)(\d{8})(?!\d)/g)) out.add(Number(m[1]));
  return [...out];
}
