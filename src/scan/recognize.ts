import type { Card, CardSet } from '../types';
import { cardsBySetCode, getCard, getNameEntries } from '../db/cardDb';
import { extractPasscodes, extractSetCodes, matchNames, normalizeName, setCodeKey } from './match';
import type { OcrResult } from './ocr';

export interface Candidate {
  card: Card;
  /** 0..1, ab SURE_SCORE gilt der Treffer als sicher. */
  score: number;
  imageId: number;
  /** Erkannter Druck (Set-Code aus der Datenbank, mit Regionskuerzel der echten Karte). */
  setCode?: string;
  prints: CardSet[];
  reasons: string[];
}

export const SURE_SCORE = 0.88;

/** Wandelt den Datenbank-Code (meist EN) in den Code der gescannten Karte (z. B. DE). */
function scannedCode(dbCode: string, scanned: string): string {
  const region = /-([A-Z]{0,2})\d/.exec(scanned)?.[1];
  return region === undefined ? dbCode : dbCode.replace(/-([A-Z]{0,2})(\d)/, `-${region}$2`);
}

export function rankCandidates(ocr: OcrResult): Candidate[] {
  const found = new Map<number, Candidate>();
  const bump = (card: Card, score: number, reason: string, extra?: Partial<Candidate>) => {
    const c = found.get(card.id) ?? { card, score: 0, imageId: card.imageIds[0], prints: [], reasons: [] };
    c.score = Math.max(c.score, score);
    c.reasons.push(reason);
    Object.assign(c, extra);
    found.set(card.id, c);
  };

  for (const code of extractPasscodes(ocr.codes)) {
    const card = getCard(code);
    if (card) bump(card, 1, 'Passcode', { imageId: card.imageIds.includes(code) ? code : card.imageIds[0] });
  }

  const nameHits = matchNames(ocr.name, getNameEntries(), 6);
  const nameScore = new Map(nameHits.map((h) => [h.id, h.score]));

  for (const code of extractSetCodes(ocr.codes)) {
    const key = setCodeKey(code);
    for (const card of cardsBySetCode(code)) {
      const prints = card.sets.filter((s) => setCodeKey(s.code) === key);
      const ns = nameScore.get(card.id) ?? 0;
      // Set-Code allein ist stark (aber OCR-Fehler moeglich), zusammen mit passendem Namen praktisch eindeutig.
      bump(card, ns > 0.55 ? 0.97 : 0.86, `Set-Code ${code}`, {
        setCode: prints[0] ? scannedCode(prints[0].code, code) : code,
        prints,
      });
    }
  }

  for (const hit of nameHits) {
    const card = getCard(hit.id);
    if (!card) continue;
    const existing = found.get(card.id);
    if (existing) existing.score = Math.min(1, Math.max(existing.score, existing.score + hit.score * 0.05));
    else bump(card, hit.score * 0.92, 'Name');
  }

  // Exakt gelesener Name hebt den Treffer ueber die Sicherheitsschwelle.
  const q = normalizeName(ocr.name);
  for (const c of found.values()) {
    if (q && (normalizeName(c.card.name) === q || (c.card.nameDe && normalizeName(c.card.nameDe) === q))) {
      c.score = Math.max(c.score, 0.95);
    }
  }

  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}
