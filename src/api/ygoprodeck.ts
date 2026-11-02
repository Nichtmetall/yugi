import type { Card } from '../types';

const API = 'https://db.ygoprodeck.com/api/v7';
const IMAGES = 'https://images.ygoprodeck.com/images';

export type ImageSize = 'full' | 'small' | 'cropped';

const IMAGE_DIR: Record<ImageSize, string> = {
  full: 'cards',
  small: 'cards_small',
  cropped: 'cards_cropped',
};

export function imageUrl(imageId: number, size: ImageSize = 'small'): string {
  return `${IMAGES}/${IMAGE_DIR[size]}/${imageId}.jpg`;
}

export async function fetchDbVersion(): Promise<string> {
  const res = await fetch(`${API}/checkDBVer.php`);
  if (!res.ok) throw new Error(`Versionsabfrage fehlgeschlagen (HTTP ${res.status})`);
  const json = await res.json();
  const info = Array.isArray(json) ? json[0] : json;
  return `${info?.database_version ?? ''}|${info?.last_update ?? ''}`;
}

/** Laedt JSON und meldet die bisher empfangenen Bytes (Content-Length fehlt bei gzip oft). */
async function fetchJson(url: string, onBytes?: (bytes: number) => void): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  if (!res.body || !onBytes) return res.json();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(received);
  }
  const all = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

function mapCard(r: any): Card {
  const prices = r.card_prices?.[0] ?? {};
  return {
    id: r.id,
    name: r.name,
    type: r.type ?? '',
    frameType: r.frameType ?? '',
    desc: r.desc ?? '',
    race: r.race ?? '',
    atk: r.atk ?? undefined,
    def: r.def ?? undefined,
    level: r.level ?? undefined,
    attribute: r.attribute ?? undefined,
    archetype: r.archetype ?? undefined,
    linkval: r.linkval ?? undefined,
    linkmarkers: r.linkmarkers ?? undefined,
    scale: r.scale ?? undefined,
    typeline: r.typeline ?? undefined,
    imageIds: (r.card_images ?? []).map((i: any) => i.id as number),
    sets: (r.card_sets ?? []).map((s: any) => ({
      code: s.set_code ?? '',
      name: s.set_name ?? '',
      rarity: s.set_rarity ?? '',
      rarityCode: s.set_rarity_code ?? '',
      price: num(s.set_price),
    })),
    priceCm: num(prices.cardmarket_price),
    priceTcg: num(prices.tcgplayer_price),
    banTcg: r.banlist_info?.ban_tcg ?? undefined,
    banOcg: r.banlist_info?.ban_ocg ?? undefined,
    url: r.ygoprodeck_url ?? undefined,
  };
}

export async function fetchAllCards(onBytes?: (bytes: number) => void): Promise<Card[]> {
  const json = await fetchJson(`${API}/cardinfo.php`, onBytes);
  const data: any[] = json?.data ?? [];
  if (!data.length) throw new Error('Die Datenbank hat keine Karten geliefert.');
  return data.map(mapCard).filter((c) => c.imageIds.length > 0);
}

export async function fetchGermanTexts(
  onBytes?: (bytes: number) => void,
): Promise<Map<number, { name: string; desc: string }>> {
  const json = await fetchJson(`${API}/cardinfo.php?language=de`, onBytes);
  const map = new Map<number, { name: string; desc: string }>();
  for (const r of json?.data ?? []) map.set(r.id, { name: r.name, desc: r.desc ?? '' });
  return map;
}
