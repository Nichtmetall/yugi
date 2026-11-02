import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Store, der jeden Stand in localStorage spiegelt. */
export function createPersistedStore<T>(key: string, initial: T): Store<T> {
  let start = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      start = (Array.isArray(initial) ? parsed : { ...initial, ...parsed }) as T;
    }
  } catch {
    // defekter oder fehlender Speicher: mit Startwert weiter
  }
  const store = createStore(start);
  store.subscribe(() => {
    try {
      localStorage.setItem(key, JSON.stringify(store.get()));
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
    }
  });
  return store;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
