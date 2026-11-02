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
    case 'Forbidden':
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
  Forbidden: 'Verboten',
  Limited: 'Limitiert (1)',
  'Semi-Limited': 'Semi-limitiert (2)',
};

export function frameClass(frameType: string): string {
  const base = frameType.split('_')[0] || 'normal';
  return `frame-${base}${frameType.includes('pendulum') ? ' frame-pendulum' : ''}`;
}

const stat = (v?: number) => (v === undefined ? '' : v < 0 ? '?' : String(v));

/** Kartenwerte als Paare aus Bezeichnung und Wert, z. B. [["Stufe", "8"], ["ATK", "3000"], ["DEF", "2500"]]. */
export function statFacts(c: Card): [string, string][] {
  const facts: [string, string][] = [];
  if (c.attribute) facts.push(['Attribut', c.attribute]);
  if (c.level !== undefined) facts.push([c.frameType.startsWith('xyz') ? 'Rang' : 'Stufe', String(c.level)]);
  if (c.linkval !== undefined) facts.push(['Link', String(c.linkval)]);
  if (c.scale !== undefined) facts.push(['Skala', String(c.scale)]);
  if (c.atk !== undefined) facts.push(['ATK', stat(c.atk)]);
  if (c.def !== undefined) facts.push(['DEF', stat(c.def)]);
  return facts;
}

const TEXT_LABEL: Record<string, string> = {
  'Pendulum Effect': 'Pendeleffekt',
  'Monster Effect': 'Monstereffekt',
  'Flavor Text': 'Flavortext',
};

/** Zerlegt den Kartentext an Zeilen wie "[ Pendulum Effect ]" in benannte Abschnitte. */
export function textSections(desc: string): { label?: string; text: string }[] {
  const sections: { label?: string; text: string }[] = [];
  let current: { label?: string; lines: string[] } = { lines: [] };
  const flush = () => {
    const text = current.lines.join('\n').trim();
    if (text) sections.push({ label: current.label, text });
  };
  for (const line of desc.split('\n')) {
    const head = /^\s*\[\s*(.+?)\s*\]\s*$/.exec(line);
    if (head) {
      flush();
      current = { label: TEXT_LABEL[head[1]] ?? head[1], lines: [] };
    } else if (!/^\s*-{6,}\s*$/.test(line)) {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
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
