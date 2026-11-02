import { get, set } from 'idb-keyval';
import type { Card } from '../types';
import { fetchAllCards, fetchDbVersion, fetchGermanTexts } from '../api/ygoprodeck';
import { createStore } from '../lib/store';
import { category, type Category } from '../lib/format';
import { normalizeName, setCodeKey, type NameEntry } from '../scan/match';

// Die komplette Datenbank liegt lokal in IndexedDB: Suche und Scan-Abgleich laufen offline
// und die YGOPRODeck-API wird nur fuer Versionspruefung und Updates angefragt.

const DB_KEY = 'yugi.carddb.v1';
const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000;

interface StoredDb {
  version: string;
  savedAt: number;
  hasDe: boolean;
  cards: Card[];
}

export interface DbStatus {
  phase: 'init' | 'empty' | 'downloading' | 'ready' | 'error';
  progress?: string;
  error?: string;
  version?: string;
  savedAt?: number;
  hasDe: boolean;
  count: number;
  updateAvailable: boolean;
}

export const dbStatus = createStore<DbStatus>({ phase: 'init', hasDe: false, count: 0, updateAvailable: false });

let cards: Card[] = [];
let normEn: string[] = [];
let normDe: string[] = [];
let nameEntries: NameEntry[] = [];
const byId = new Map<number, Card>();
const bySet = new Map<string, Card[]>();

function buildIndex(list: Card[]) {
  cards = [...list].sort((a, b) => a.name.localeCompare(b.name));
  byId.clear();
  bySet.clear();
  normEn = cards.map((c) => normalizeName(c.name));
  normDe = cards.map((c) => (c.nameDe ? normalizeName(c.nameDe) : ''));
  nameEntries = [];
  cards.forEach((c, i) => {
    byId.set(c.id, c);
    for (const imageId of c.imageIds) if (!byId.has(imageId)) byId.set(imageId, c);
    for (const s of c.sets) {
      const key = setCodeKey(s.code);
      if (!key) continue;
      const list = bySet.get(key) ?? [];
      if (!list.includes(c)) list.push(c);
      bySet.set(key, list);
    }
    nameEntries.push({ key: normEn[i], id: c.id });
    if (normDe[i] && normDe[i] !== normEn[i]) nameEntries.push({ key: normDe[i], id: c.id });
  });
}

export async function initCardDb() {
  try {
    const stored = await get<StoredDb>(DB_KEY);
    if (!stored?.cards?.length) {
      dbStatus.set((s) => ({ ...s, phase: 'empty' }));
      return;
    }
    buildIndex(stored.cards);
    dbStatus.set({
      phase: 'ready',
      version: stored.version,
      savedAt: stored.savedAt,
      hasDe: stored.hasDe,
      count: cards.length,
      updateAvailable: false,
    });
    if (Date.now() - stored.savedAt > UPDATE_CHECK_INTERVAL) void checkForUpdate();
  } catch (err) {
    dbStatus.set((s) => ({ ...s, phase: 'error', error: `Lokale Datenbank nicht lesbar: ${String(err)}` }));
  }
}

export async function checkForUpdate(): Promise<boolean> {
  try {
    const version = await fetchDbVersion();
    const available = !!version && version !== dbStatus.get().version;
    dbStatus.set((s) => ({ ...s, updateAvailable: available }));
    return available;
  } catch {
    return false; // offline: kein Hinweis noetig
  }
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

export async function downloadCardDb(withGerman: boolean) {
  const before = dbStatus.get();
  dbStatus.set((s) => ({ ...s, phase: 'downloading', progress: 'Verbinde mit YGOPRODeck …', error: undefined }));
  try {
    const version = await fetchDbVersion().catch(() => '');
    const list = await fetchAllCards((b) => dbStatus.set((s) => ({ ...s, progress: `Kartendaten: ${mb(b)} MB` })));
    if (withGerman) {
      const de = await fetchGermanTexts((b) => dbStatus.set((s) => ({ ...s, progress: `Deutsche Texte: ${mb(b)} MB` })));
      for (const c of list) {
        const t = de.get(c.id);
        if (t) {
          c.nameDe = t.name;
          c.descDe = t.desc;
        }
      }
    }
    dbStatus.set((s) => ({ ...s, progress: 'Speichere auf dem Gerät …' }));
    const stored: StoredDb = { version, savedAt: Date.now(), hasDe: withGerman, cards: list };
    await set(DB_KEY, stored);
    buildIndex(list);
    dbStatus.set({
      phase: 'ready',
      version,
      savedAt: stored.savedAt,
      hasDe: withGerman,
      count: cards.length,
      updateAvailable: false,
    });
  } catch (err) {
    // fetch meldet gesperrte oder fehlende Verbindungen nur als TypeError ("Failed to fetch").
    const error =
      err instanceof TypeError
        ? 'YGOPRODeck ist nicht erreichbar. Entweder fehlt die Internetverbindung oder dieses Netzwerk sperrt db.ygoprodeck.com (z. B. Firmen-WLAN). Versuche es in einem anderen Netz, etwa über mobile Daten.'
        : `Download fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}. Versuche es erneut.`;
    // Eine vorhandene Datenbank bleibt nutzbar.
    dbStatus.set({ ...before, phase: cards.length ? 'ready' : 'error', progress: undefined, error });
  }
}

export const getCard = (id: number): Card | undefined => byId.get(id);

export const cardsBySetCode = (code: string): Card[] => {
  const key = setCodeKey(code);
  return key ? (bySet.get(key) ?? []) : [];
};

export const getNameEntries = () => nameEntries;

export function searchCards(query: string, cat: Category | 'all' = 'all', limit = 90): Card[] {
  const trimmed = query.trim();
  if (/^\d{5,9}$/.test(trimmed)) {
    const hit = getCard(Number(trimmed));
    return hit ? [hit] : [];
  }
  const bySetHit = cardsBySetCode(trimmed);
  if (bySetHit.length) return bySetHit;

  const tokens = trimmed.split(/\s+/).map(normalizeName).filter(Boolean);
  if (!tokens.length && cat === 'all') return [];
  const whole = tokens.join('');
  const scored: { c: Card; s: number }[] = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (cat !== 'all' && category(c) !== cat) continue;
    const en = normEn[i];
    const de = normDe[i];
    if (!tokens.every((t) => en.includes(t) || de.includes(t))) continue;
    let s = 2;
    if (whole && (en === whole || de === whole)) s = 0;
    else if (whole && (en.startsWith(whole) || de.startsWith(whole))) s = 1;
    scored.push({ c, s });
  }
  scored.sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length);
  return scored.slice(0, limit).map((x) => x.c);
}
