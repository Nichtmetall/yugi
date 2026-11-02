import type { Card, Deck, DeckSection } from '../types';
import { createPersistedStore } from '../lib/store';
import { getCard } from '../db/cardDb';
import { isExtraDeckCard } from '../lib/format';
import type { YdkDeck } from '../lib/ydk';

export const decksStore = createPersistedStore<Deck[]>('yugi.decks', []);

export const DECK_LIMITS: Record<DeckSection, [number, number]> = {
  main: [40, 60],
  extra: [0, 15],
  side: [0, 15],
};

export const SECTION_LABEL: Record<DeckSection, string> = {
  main: 'Main Deck',
  extra: 'Extra Deck',
  side: 'Side Deck',
};

const newId = () => Math.random().toString(36).slice(2, 10);

function update(id: string, fn: (d: Deck) => Deck) {
  decksStore.set((list) => list.map((d) => (d.id === id ? { ...fn(d), updatedAt: Date.now() } : d)));
}

export function createDeck(name: string, cards?: YdkDeck): Deck {
  // Alternative Artworks auf die Haupt-ID abbilden, damit Besitz-Abgleich und Limits stimmen.
  const canon = (ids: number[]) => ids.map((id) => getCard(id)?.id ?? id);
  const deck: Deck = {
    id: newId(),
    name: name.trim() || 'Neues Deck',
    main: canon(cards?.main ?? []),
    extra: canon(cards?.extra ?? []),
    side: canon(cards?.side ?? []),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  decksStore.set((list) => [deck, ...list]);
  return deck;
}

export const renameDeck = (id: string, name: string) => update(id, (d) => ({ ...d, name: name.trim() || d.name }));

export const deleteDeck = (id: string) => decksStore.set((list) => list.filter((d) => d.id !== id));

export const defaultSection = (card: Card): DeckSection => (isExtraDeckCard(card) ? 'extra' : 'main');

export function addCardToDeck(deckId: string, card: Card, section: DeckSection = defaultSection(card)) {
  // Extra-Deck-Monster duerfen nicht ins Main Deck und umgekehrt.
  const target: DeckSection = section === 'side' ? 'side' : defaultSection(card);
  update(deckId, (d) => ({ ...d, [target]: [...d[target], card.id] }));
}

export function removeCardFromDeck(deckId: string, cardId: number, section: DeckSection) {
  update(deckId, (d) => {
    const idx = d[section].lastIndexOf(cardId);
    if (idx < 0) return d;
    const next = [...d[section]];
    next.splice(idx, 1);
    return { ...d, [section]: next };
  });
}

export const deckCopies = (d: Deck, cardId: number) =>
  [...d.main, ...d.extra, ...d.side].filter((id) => id === cardId).length;
