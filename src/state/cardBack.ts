import { del, get, set } from 'idb-keyval';
import { createStore } from '../lib/store';

// Rueckseitenbild der 3D-Karte. Reihenfolge: in der App gewaehltes Bild (IndexedDB),
// dann eine Datei public/card-back.(jpg|png|webp), sonst die eingebaute Rueckseite (null).

const IDB_KEY = 'yugi.cardback';
const FILE_CANDIDATES = ['card-back.jpg', 'card-back.png', 'card-back.webp'];

export const cardBackStore = createStore<{ url: string | null; custom: boolean }>({ url: null, custom: false });

let started = false;

function imageLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function fileFallback(): Promise<string | null> {
  for (const file of FILE_CANDIDATES) {
    const url = `${import.meta.env.BASE_URL}${file}`;
    if (await imageLoads(url)) return url;
  }
  return null;
}

export async function loadCardBack() {
  if (started) return;
  started = true;
  const blob = await get<Blob>(IDB_KEY).catch(() => undefined);
  if (blob) return cardBackStore.set({ url: URL.createObjectURL(blob), custom: true });
  cardBackStore.set({ url: await fileFallback(), custom: false });
}

/** Bild verkleinern (max. 900 px hoch) und speichern. */
export async function setCardBack(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))), 'image/jpeg', 0.9),
  );
  await set(IDB_KEY, blob);
  const prev = cardBackStore.get();
  if (prev.custom && prev.url) URL.revokeObjectURL(prev.url);
  cardBackStore.set({ url: URL.createObjectURL(blob), custom: true });
}

export async function resetCardBack() {
  await del(IDB_KEY);
  const prev = cardBackStore.get();
  if (prev.custom && prev.url) URL.revokeObjectURL(prev.url);
  cardBackStore.set({ url: await fileFallback(), custom: false });
}
