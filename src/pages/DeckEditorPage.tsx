import { useMemo, useState } from 'react';
import type { Card, DeckSection } from '../types';
import { getCard } from '../db/cardDb';
import { useStore } from '../lib/store';
import { countIds, deckStats } from '../lib/deckStats';
import { cardName, download, formatPrice, isExtraDeckCard } from '../lib/format';
import { toYdk } from '../lib/ydk';
import { collectionStore, ownedCounts } from '../state/collection';
import {
  addCardToDeck,
  deckCopies,
  decksStore,
  deleteDeck,
  removeCardFromDeck,
  renameDeck,
  SECTION_LABEL,
} from '../state/decks';
import { settingsStore } from '../state/settings';
import { navigate, openCard, toast } from '../state/ui';
import { CardSearch } from '../components/CardSearch';
import { CardTile } from '../components/CardTile';
import { IconClose, IconPlus, IconTrash } from '../components/Icons';
import { PageHeader } from './PageHeader';

const SECTIONS: DeckSection[] = ['main', 'extra', 'side'];

export function DeckEditorPage({ deckId }: { deckId: string }) {
  const decks = useStore(decksStore);
  const collection = useStore(collectionStore);
  useStore(settingsStore);
  const deck = decks.find((d) => d.id === deckId);
  const owned = useMemo(() => ownedCounts(collection), [collection]);
  const [adding, setAdding] = useState(false);

  if (!deck) {
    return (
      <>
        <PageHeader title="Deck nicht gefunden" back="decks" />
        <p className="hint">Dieses Deck existiert nicht mehr.</p>
      </>
    );
  }

  const st = deckStats(deck, owned);

  const pick = (card: Card) => {
    addCardToDeck(deck.id, card);
    const section: DeckSection = isExtraDeckCard(card) ? 'extra' : 'main';
    toast(`${cardName(card)} im ${SECTION_LABEL[section]}`, {
      label: 'Rückgängig',
      run: () => removeCardFromDeck(deck.id, card.id, section),
    });
  };

  const copyMissing = async () => {
    const text = st.missing.map((m) => `${m.count}x ${cardName(m.card)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Liste der fehlenden Karten kopiert');
    } catch {
      download(`${deck.name} fehlende Karten.txt`, text);
    }
  };

  const remove = () => {
    if (!confirm(`Deck „${deck.name}“ löschen? Die Karten in deiner Sammlung bleiben erhalten.`)) return;
    deleteDeck(deck.id);
    navigate('decks');
  };

  return (
    <>
      <PageHeader
        back="decks"
        title={
          <input
            className="title-input"
            defaultValue={deck.name}
            onBlur={(e) => renameDeck(deck.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Deckname"
          />
        }
        sub={
          st.total === 0
            ? 'Noch keine Karten'
            : st.missing.length === 0
              ? `Alle ${st.total} Karten in deiner Sammlung`
              : `${st.have} von ${st.total} Karten vorhanden`
        }
        actions={
          <button className="icon-btn" onClick={remove} aria-label="Deck löschen">
            <IconTrash />
          </button>
        }
      />

      <div className="btn-row">
        <button className={`btn${adding ? '' : ' primary'}`} onClick={() => setAdding(!adding)}>
          {adding ? <IconClose size={18} /> : <IconPlus size={18} />} {adding ? 'Fertig' : 'Karten hinzufügen'}
        </button>
        <button className="btn" onClick={() => download(`${deck.name}.ydk`, toYdk(deck))} disabled={st.total === 0}>
          Als YDK exportieren
        </button>
      </div>

      {adding && (
        <div className="panel">
          <p className="hint">Tippe auf eine Karte, um sie ins Deck zu legen.</p>
          <CardSearch autoFocus onPick={pick} qtyOf={(c) => deckCopies(deck, c.id) || undefined} />
        </div>
      )}

      {st.problems.length > 0 && st.total > 0 && (
        <ul className="problems">
          {st.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {SECTIONS.map((section) => {
        const ids = countIds(deck[section]);
        if (ids.size === 0 && section !== 'main') return null;
        return (
          <section key={section} className="deck-section">
            <h2>
              {SECTION_LABEL[section]} <span className="count">{deck[section].length}</span>
            </h2>
            {ids.size === 0 ? (
              <p className="hint">Noch leer.</p>
            ) : (
              <div className="grid">
                {[...ids].map(([id, count]) => {
                  const card = getCard(id);
                  if (!card) return null;
                  const missing = Math.max(0, deckCopies(deck, id) - (owned.get(id) ?? 0));
                  return (
                    <CardTile
                      key={id}
                      card={card}
                      qty={count}
                      missing={missing ? Math.min(missing, count) : undefined}
                      onClick={() => openCard({ cardId: id, deckId: deck.id })}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {st.missing.length > 0 && (
        <section className="panel">
          <h3>
            Fehlende Karten <span className="count">{formatPrice(st.missingValue)}</span>
          </h3>
          <ul className="rows">
            {st.missing.map((m) => (
              <li key={m.card.id} className="row">
                <button className="row-main link" onClick={() => openCard({ cardId: m.card.id, deckId: deck.id })}>
                  {m.count}× {cardName(m.card)}
                </button>
                <span className="num muted">{formatPrice(m.card.priceCm * m.count)}</span>
              </li>
            ))}
          </ul>
          <button className="btn" onClick={copyMissing}>
            Liste kopieren
          </button>
        </section>
      )}
    </>
  );
}
