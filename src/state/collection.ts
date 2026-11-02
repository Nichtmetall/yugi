import type { CollectionEntry } from '../types';
import { createPersistedStore } from '../lib/store';

export const collectionStore = createPersistedStore<CollectionEntry[]>('yugi.collection', []);

export interface PrintInfo {
  imageId: number;
  setCode?: string;
  rarity?: string;
}

const entryKey = (cardId: number, p: PrintInfo) => `${cardId}:${p.imageId}:${p.setCode ?? ''}:${p.rarity ?? ''}`;

/** Fuegt `qty` Exemplare eines Drucks hinzu und liefert den Eintragsschluessel. */
export function addToCollection(cardId: number, print: PrintInfo, qty = 1): string {
  const key = entryKey(cardId, print);
  collectionStore.set((list) => {
    const existing = list.find((e) => e.key === key);
    if (existing) return list.map((e) => (e.key === key ? { ...e, qty: e.qty + qty, addedAt: Date.now() } : e));
    return [...list, { key, cardId, ...print, qty, addedAt: Date.now() }];
  });
  return key;
}

/** Aendert die Anzahl; bei 0 verschwindet der Eintrag. */
export function changeQty(key: string, delta: number) {
  collectionStore.set((list) =>
    list.flatMap((e) => {
      if (e.key !== key) return [e];
      const qty = e.qty + delta;
      return qty > 0 ? [{ ...e, qty }] : [];
    }),
  );
}

export function ownedCounts(list: CollectionEntry[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const e of list) map.set(e.cardId, (map.get(e.cardId) ?? 0) + e.qty);
  return map;
}
