import type { Card } from '../types';
import { settingsStore } from '../state/settings';

const EXTRA_FRAMES = new Set(['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']);

export const isExtraDeckCard = (c: Card) => EXTRA_FRAMES.has(c.frameType);

export type Category = 'monster' | 'spell' | 'trap' | 'extra' | 'other';

export const CATEGORY_LABEL: Record<Category, string> = {
  monster: 'Monster',
  spell: 'Zauber',
  trap: 'Fallen',
  extra: 'Extra Deck',
  other: 'Sonstige',
};

export function category(c: Card): Category {
  if (c.frameType === 'spell') return 'spell';
  if (c.frameType === 'trap') return 'trap';
  if (isExtraDeckCard(c)) return 'extra';
  if (c.frameType === 'token' || c.frameType === 'skill') return 'other';
  return 'monster';
}

export function cardName(c: Card, lang = settingsStore.get().lang): string {
  return lang === 'de' && c.nameDe ? c.nameDe : c.name;
}

/** Zweitname in der jeweils anderen Sprache, falls vorhanden und abweichend. */
export function altName(c: Card, lang = settingsStore.get().lang): string | undefined {
  const alt = lang === 'de' ? c.name : c.nameDe;
  return alt && alt !== cardName(c, lang) ? alt : undefined;
}

export function cardDesc(c: Card, lang = settingsStore.get().lang): string {
  return lang === 'de' && c.descDe ? c.descDe : c.desc;
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export const formatPrice = (n: number) => (n > 0 ? euro.format(n) : '–');

/** Erlaubte Kopien laut TCG-Banliste. */
export function banLimit(c: Card): number {
  switch (c.banTcg) {
    case 'Banned':
      return 0;
    case 'Limited':
      return 1;
    case 'Semi-Limited':
      return 2;
    default:
      return 3;
  }
}

export const BAN_LABEL: Record<string, string> = {
  Banned: 'Verboten',
  Limited: 'Limitiert (1)',
  'Semi-Limited': 'Semi-limitiert (2)',
};

export function frameClass(frameType: string): string {
  const base = frameType.split('_')[0] || 'normal';
  return `frame-${base}${frameType.includes('pendulum') ? ' frame-pendulum' : ''}`;
}

const stat = (v?: number) => (v === undefined ? '' : v < 0 ? '?' : String(v));

/** Einzelne Werte fuer Tags, z. B. ["Stufe 8", "ATK 3000 / DEF 2500"]. */
export function statParts(c: Card): string[] {
  const parts: string[] = [];
  if (c.frameType.startsWith('xyz') && c.level !== undefined) parts.push(`Rang ${c.level}`);
  else if (c.level !== undefined) parts.push(`Stufe ${c.level}`);
  if (c.linkval !== undefined) parts.push(`Link ${c.linkval}`);
  if (c.scale !== undefined) parts.push(`Skala ${c.scale}`);
  if (c.atk !== undefined) parts.push(c.def !== undefined ? `ATK ${stat(c.atk)} / DEF ${stat(c.def)}` : `ATK ${stat(c.atk)}`);
  return parts;
}

/** Staerke des Holo-Effekts nach Seltenheit (0..1). Auch Commons bekommen einen leichten Glanz. */
export function holoStrength(rarity?: string): number {
  const r = (rarity ?? '').toLowerCase();
  if (/starlight|ghost|quarter century|platinum secret|prismatic/.test(r)) return 1;
  if (/secret|ultimate|collector|ultra/.test(r)) return 0.85;
  if (/super|gold|premium/.test(r)) return 0.65;
  if (/rare/.test(r) && !/short print/.test(r)) return 0.45;
  return 0.3;
}

export function download(filename: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
