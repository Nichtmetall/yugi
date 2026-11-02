import { useEffect, useMemo, useState } from 'react';
import type { DeckSection } from '../types';
import { imageUrl } from '../api/ygoprodeck';
import { getCard } from '../db/cardDb';
import { useStore } from '../lib/store';
import {
  BAN_LABEL,
  banLimit,
  altName,
  cardDesc,
  cardName,
  formatPrice,
  frameClass,
  isExtraDeckCard,
  statParts,
} from '../lib/format';
import { addToCollection, changeQty, collectionStore } from '../state/collection';
import { addCardToDeck, deckCopies, decksStore, removeCardFromDeck, SECTION_LABEL } from '../state/decks';
import { closeCard, detailStore, toast } from '../state/ui';
import { settingsStore } from '../state/settings';
import { Card3D } from './Card3D';
import { IconClose, IconMinus, IconPlus } from './Icons';

export function CardDetail() {
  const detail = useStore(detailStore);
  if (!detail) return null;
  const card = getCard(detail.cardId);
  if (!card) return null;
  return <DetailSheet key={card.id} cardId={card.id} initialImage={detail.imageId} initialRarity={detail.rarity} deckId={detail.deckId} />;
}

function DetailSheet({
  cardId,
  initialImage,
  initialRarity,
  deckId,
}: {
  cardId: number;
  initialImage?: number;
  initialRarity?: string;
  deckId?: string;
}) {
  const card = getCard(cardId)!;
  useStore(settingsStore); // Sprache
  const collection = useStore(collectionStore);
  const decks = useStore(decksStore);
  const entries = collection.filter((e) => e.cardId === card.id);
  const owned = entries.reduce((n, e) => n + e.qty, 0);

  const [imageId, setImageId] = useState(initialImage && card.imageIds.includes(initialImage) ? initialImage : card.imageIds[0]);
  const [printIdx, setPrintIdx] = useState(() => (initialRarity ? card.sets.findIndex((s) => s.rarity === initialRarity) : -1));
  const print = printIdx >= 0 ? card.sets[printIdx] : undefined;
  // Ohne gewaehlten Druck zeigt der Schimmer die Seltenheit des ersten Drucks.
  const shownRarity = print?.rarity ?? initialRarity ?? card.sets[0]?.rarity;
  const mainSection: DeckSection = isExtraDeckCard(card) ? 'extra' : 'main';
  const [targetDeck, setTargetDeck] = useState(deckId ?? decks[0]?.id ?? '');
  const deck = decks.find((d) => d.id === targetDeck);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeCard();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, []);

  const name = cardName(card);
  const alt = altName(card);
  const typeText = card.typeline?.join(' / ') ?? (card.frameType === 'spell' || card.frameType === 'trap' ? `${card.race} ${card.type}` : card.type);
  const stats = statParts(card);
  const sortedSets = useMemo(() => [...card.sets].sort((a, b) => a.code.localeCompare(b.code)), [card]);

  const add = () => {
    const key = addToCollection(card.id, { imageId, setCode: print?.code, rarity: print?.rarity });
    toast(`${name} zur Sammlung hinzugefügt`, { label: 'Rückgängig', run: () => changeQty(key, -1) });
  };

  const deckCount = (section: DeckSection) => (deck ? deck[section].filter((id) => id === card.id).length : 0);

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={name}>
      <button className="detail-close icon-btn" onClick={closeCard} aria-label="Schließen">
        <IconClose />
      </button>
      <div className="detail-body">
        <div className="detail-stage">
          <Card3D imageId={imageId} alt={name} rarity={shownRarity} />
          {card.imageIds.length > 1 && (
            <div className="arts" role="group" aria-label="Artworks">
              {card.imageIds.map((id, i) => (
                <button key={id} className={`art${id === imageId ? ' on' : ''}`} onClick={() => setImageId(id)} aria-label={`Artwork ${i + 1}`}>
                  <img src={imageUrl(id, 'cropped')} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          <h2 className="detail-name">{name}</h2>
          {alt && <p className="detail-alt">{alt}</p>}
          <div className="tags">
            <span className={`tag frame ${frameClass(card.frameType)}`}>{typeText}</span>
            {card.attribute && <span className="tag">{card.attribute}</span>}
            {stats.map((s) => (
              <span key={s} className="tag num">
                {s}
              </span>
            ))}
            {card.banTcg && <span className="tag ban">{BAN_LABEL[card.banTcg] ?? card.banTcg}</span>}
          </div>
          <p className="detail-desc">{cardDesc(card)}</p>

          <section className="panel">
            <h3>
              In deiner Sammlung <span className="count">{owned}</span>
            </h3>
            {entries.length > 0 && (
              <ul className="rows">
                {entries.map((e) => (
                  <li key={e.key} className="row">
                    <span className="row-main">
                      {e.setCode ?? 'Ohne Set'}
                      <small>{e.rarity ?? (e.imageId !== card.imageIds[0] ? 'Alternatives Artwork' : '')}</small>
                    </span>
                    <span className="stepper">
                      <button className="icon-btn small" onClick={() => changeQty(e.key, -1)} aria-label="Eins weniger">
                        <IconMinus size={16} />
                      </button>
                      <span className="num">{e.qty}</span>
                      <button className="icon-btn small" onClick={() => changeQty(e.key, 1)} aria-label="Eins mehr">
                        <IconPlus size={16} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="add-row">
              <select value={printIdx} onChange={(e) => setPrintIdx(Number(e.target.value))} aria-label="Druck">
                <option value={-1}>Ohne Set-Angabe</option>
                {card.sets.map((s, i) => (
                  <option key={`${s.code}-${s.rarity}-${i}`} value={i}>
                    {s.code} · {s.rarity}
                  </option>
                ))}
              </select>
              <button className="btn primary" onClick={add}>
                <IconPlus size={18} /> Hinzufügen
              </button>
            </div>
          </section>

          <section className="panel">
            <h3>Deck</h3>
            {decks.length === 0 ? (
              <p className="hint">Lege unter „Decks“ ein Deck an, um Karten zuzuordnen.</p>
            ) : (
              <>
                <select value={targetDeck} onChange={(e) => setTargetDeck(e.target.value)} aria-label="Deck wählen">
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {deck && (
                  <ul className="rows">
                    {([mainSection, 'side'] as DeckSection[]).map((section) => (
                      <li key={section} className="row">
                        <span className="row-main">{SECTION_LABEL[section]}</span>
                        <span className="stepper">
                          <button
                            className="icon-btn small"
                            onClick={() => removeCardFromDeck(deck.id, card.id, section)}
                            disabled={deckCount(section) === 0}
                            aria-label={`Eins weniger im ${SECTION_LABEL[section]}`}
                          >
                            <IconMinus size={16} />
                          </button>
                          <span className="num">{deckCount(section)}</span>
                          <button
                            className="icon-btn small"
                            onClick={() => addCardToDeck(deck.id, card, section)}
                            aria-label={`Eins mehr im ${SECTION_LABEL[section]}`}
                          >
                            <IconPlus size={16} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {deck && deckCopies(deck, card.id) > banLimit(card) && (
                  <p className="error">Mehr Exemplare als erlaubt (max. {banLimit(card)}).</p>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h3>Drucke und Preise</h3>
            <p className="price-line">
              Cardmarket <strong>{formatPrice(card.priceCm)}</strong>
              <span className="muted">TCGplayer {card.priceTcg > 0 ? `$${card.priceTcg.toFixed(2)}` : '–'}</span>
            </p>
            {sortedSets.length === 0 ? (
              <p className="hint">Keine TCG-Drucke bekannt.</p>
            ) : (
              <ul className="rows sets">
                {sortedSets.map((s, i) => (
                  <li key={`${s.code}-${s.rarity}-${i}`} className="row">
                    <span className="row-main">
                      {s.code}
                      <small>
                        {s.name}, {s.rarity}
                      </small>
                    </span>
                    <span className="num muted">{s.price > 0 ? `$${s.price.toFixed(2)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {card.url && (
              <a className="ext" href={card.url} target="_blank" rel="noreferrer">
                Auf YGOPRODeck ansehen
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
