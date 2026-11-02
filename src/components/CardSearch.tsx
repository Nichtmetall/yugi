import { useDeferredValue, useMemo, useState } from 'react';
import type { Card } from '../types';
import { searchCards } from '../db/cardDb';
import { CATEGORY_LABEL, type Category } from '../lib/format';
import { CardTile } from './CardTile';
import { IconSearch } from './Icons';

const FILTERS: (Category | 'all')[] = ['all', 'monster', 'spell', 'trap', 'extra'];

interface Props {
  onPick: (card: Card) => void;
  autoFocus?: boolean;
  /** Optionaler Zusatz pro Treffer, z. B. Anzahl im Deck. */
  qtyOf?: (card: Card) => number | undefined;
}

export function CardSearch({ onPick, autoFocus, qtyOf }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => searchCards(deferredQuery, filter), [deferredQuery, filter]);
  const idle = !deferredQuery.trim() && filter === 'all';

  return (
    <div className="search">
      <label className="field">
        <IconSearch size={18} />
        <input
          className="search-input"
          type="search"
          inputMode="search"
          placeholder="Name, Set-Code oder Passcode"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Karten suchen"
        />
      </label>
      <div className="chips" role="group" aria-label="Kartentyp">
        {FILTERS.map((f) => (
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {f === 'all' ? 'Alle' : CATEGORY_LABEL[f]}
          </button>
        ))}
      </div>
      {idle ? (
        <p className="hint">Tippe einen Kartennamen auf Deutsch oder Englisch, einen Set-Code wie LOB-DE001 oder einen Passcode.</p>
      ) : results.length === 0 ? (
        <p className="hint">Keine Karte gefunden. Prüfe die Schreibweise oder suche nach einem Teil des Namens.</p>
      ) : (
        <div className="grid">
          {results.map((c) => (
            <CardTile key={c.id} card={c} qty={qtyOf?.(c)} onClick={() => onPick(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
