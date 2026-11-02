import { useEffect, useState } from 'react';
import { createStore } from '../lib/store';

// --- Routing ueber den Hash, damit die App auf jedem statischen Host und in Unterordnern laeuft.

export function parseHash(): string[] {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (path: string) => {
  location.hash = `#/${path}`;
};

// --- Kartendetail als Overlay ueber jeder Seite.

export interface DetailState {
  cardId: number;
  imageId?: number;
  rarity?: string;
  /** Deck, aus dem die Karte geoeffnet wurde (fuer Deck-Aktionen). */
  deckId?: string;
}

export const detailStore = createStore<DetailState | null>(null);

export const openCard = (state: DetailState) => detailStore.set(state);
export const closeCard = () => detailStore.set(null);

// --- Kurze Rueckmeldungen mit optionaler Rueckgaengig-Aktion.

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const toastStore = createStore<Toast[]>([]);
let toastSeq = 0;

export function toast(text: string, action?: Toast['action'], ms = 4000) {
  const id = ++toastSeq;
  toastStore.set((list) => [...list.slice(-2), { id, text, action }]);
  setTimeout(() => dismissToast(id), ms);
}

export const dismissToast = (id: number) => toastStore.set((list) => list.filter((t) => t.id !== id));
