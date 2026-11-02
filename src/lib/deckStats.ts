import type { Card, Deck, DeckSection } from '../types';
import { getCard } from '../db/cardDb';
import { DECK_LIMITS, SECTION_LABEL } from '../state/decks';
import { banLimit, cardName } from './format';

export interface DeckStats {
  counts: Record<DeckSection, number>;
  /** Karten, die durch die Sammlung abgedeckt sind. */
  have: number;
  total: number;
  missing: { card: Card; count: number }[];
  missingValue: number;
  problems: string[];
}

export function countIds(ids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
  return map;
}

export function deckStats(deck: Deck, owned: Map<number, number>): DeckStats {
  const sections: DeckSection[] = ['main', 'extra', 'side'];
  const counts = { main: deck.main.length, extra: deck.extra.length, side: deck.side.length };
  const needed = countIds([...deck.main, ...deck.extra, ...deck.side]);

  let have = 0;
  let missingValue = 0;
  const missing: DeckStats['missing'] = [];
  const problems: string[] = [];

  for (const [id, count] of needed) {
    const card = getCard(id);
    const own = owned.get(id) ?? 0;
    have += Math.min(count, own);
    if (!card) continue;
    if (count > own) {
      missing.push({ card, count: count - own });
      missingValue += (count - own) * card.priceCm;
    }
    const limit = banLimit(card);
    if (count > limit) {
      problems.push(
        limit === 0
          ? `${cardName(card)} ist auf der Banliste verboten.`
          : `${cardName(card)}: ${count} Exemplare, erlaubt sind ${limit}.`,
      );
    }
  }

  for (const s of sections) {
    const [min, max] = DECK_LIMITS[s];
    if (counts[s] < min) problems.push(`${SECTION_LABEL[s]} hat ${counts[s]} Karten, mindestens ${min} nötig.`);
    if (counts[s] > max) problems.push(`${SECTION_LABEL[s]} hat ${counts[s]} Karten, höchstens ${max} erlaubt.`);
  }

  missing.sort((a, b) => cardName(a.card).localeCompare(cardName(b.card), 'de'));
  return { counts, have, total: counts.main + counts.extra + counts.side, missing, missingValue, problems };
}
