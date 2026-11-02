import { useDeferredValue, useMemo, useState } from 'react';
import type { Card } from '../types';
import { getCard } from '../db/cardDb';
import { useStore } from '../lib/store';
import { CATEGORY_LABEL, cardName, category, formatPrice, type Category } from '../lib/format';
import { normalizeName } from '../scan/match';
import { collectionStore } from '../state/collection';
import { settingsStore } from '../state/settings';
import { navigate, openCard } from '../state/ui';
import { CardTile } from '../components/CardTile';
import { IconCamera, IconSearch } from '../components/Icons';
import { PageHeader } from './PageHeader';

type Sort = 'recent' | 'name' | 'value' | 'qty';

const SORT_LABEL: Record<Sort, string> = {
  recent: 'Zuletzt hinzugefügt',
  name: 'Name',
  value: 'Wert',
  qty: 'Anzahl',
};

interface Group {
  card: Card;
  qty: number;
  imageId: number;
  rarity?: string;
  addedAt: number;
}

export function CollectionPage() {
  const collection = useStore(collectionStore);
  const { lang } = useStore(settingsStore);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const q = normalizeName(useDeferredValue(query));

  const groups = useMemo(() => {
    const map = new Map<number, Group>();
    for (const e of collection) {
      const card = getCard(e.cardId);
      if (!card) continue;
      const g = map.get(card.id);
      if (!g) map.set(card.id, { card, qty: e.qty, imageId: e.imageId, rarity: e.rarity, addedAt: e.addedAt });
      else {
        g.qty += e.qty;
        if (e.addedAt > g.addedAt) Object.assign(g, { imageId: e.imageId, rarity: e.rarity, addedAt: e.addedAt });
      }
    }
    return [...map.values()];
  }, [collection]);

  const total = groups.reduce((n, g) => n + g.qty, 0);
  const value = groups.reduce((n, g) => n + g.qty * g.card.priceCm, 0);

  const shown = useMemo(() => {
    const list = groups.filter(
      (g) =>
        (filter === 'all' || category(g.card) === filter) &&
        (!q || normalizeName(g.card.name).includes(q) || (g.card.nameDe && normalizeName(g.card.nameDe).includes(q))),
    );
    const byName = (a: Group, b: Group) => cardName(a.card, lang).localeCompare(cardName(b.card, lang), 'de');
    const cmp: Record<Sort, (a: Group, b: Group) => number> = {
      recent: (a, b) => b.addedAt - a.addedAt,
      name: byName,
      value: (a, b) => b.card.priceCm - a.card.priceCm || byName(a, b),
      qty: (a, b) => b.qty - a.qty || byName(a, b),
    };
    return list.sort(cmp[sort]);
  }, [groups, filter, q, sort, lang]);

  if (groups.length === 0) {
    return (
      <>
        <PageHeader title="Sammlung" />
        <div className="empty">
          <div className="empty-pockets" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <p>Dein Binder ist noch leer. Scanne deine erste Karte mit der Kamera oder füge sie über die Suche hinzu.</p>
          <div className="btn-row center">
            <button className="btn primary" onClick={() => navigate('scan')}>
              <IconCamera size={18} /> Karte scannen
            </button>
            <button className="btn" onClick={() => navigate('search')}>
              <IconSearch size={18} /> Karte suchen
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sammlung"
        sub={
          <>
            {total} Karten, {groups.length} verschiedene, Cardmarket-Wert <strong>{formatPrice(value)}</strong>
          </>
        }
      />
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="In der Sammlung suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="In der Sammlung suchen"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sortierung">
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="chips" role="group" aria-label="Kartentyp">
        {(['all', 'monster', 'spell', 'trap', 'extra'] as const).map((f) => (
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {f === 'all' ? 'Alle' : CATEGORY_LABEL[f]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="hint">Keine Karte in deiner Sammlung passt zu diesem Filter.</p>
      ) : (
        <div className="grid binder">
          {shown.map((g) => (
            <CardTile
              key={g.card.id}
              card={g.card}
              imageId={g.imageId}
              qty={g.qty}
              onClick={() => openCard({ cardId: g.card.id, imageId: g.imageId, rarity: g.rarity })}
            />
          ))}
        </div>
      )}
    </>
  );
}
