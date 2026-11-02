import { useEffect, useRef, useState, type UIEvent } from 'react';
import type { CardSet, CollectionEntry, DeckSection } from '../types';
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
  statFacts,
  textSections,
} from '../lib/format';
import { addToCollection, changeQty, collectionStore } from '../state/collection';
import { addCardToDeck, deckCopies, decksStore, removeCardFromDeck, SECTION_LABEL } from '../state/decks';
import { closeCard, detailStore, toast } from '../state/ui';
import { settingsStore } from '../state/settings';
import { Card3D } from './Card3D';
import { IconBinder, IconClose, IconDecks, IconMinus, IconPlus, IconSearch } from './Icons';

export function CardDetail() {
  const detail = useStore(detailStore);
  if (!detail) return null;
  const card = getCard(detail.cardId);
  if (!card) return null;
  return <DetailSheet key={card.id} cardId={card.id} initialImage={detail.imageId} initialRarity={detail.rarity} deckId={detail.deckId} />;
}

/** Ab so vielen Drucken gibt es ein Filterfeld und die Liste startet eingeklappt. */
const MANY_PRINTS = 8;
/** Eingeklappt sichtbare Drucke, die noch nicht in der Sammlung sind. */
const COLLAPSED_PRINTS = 5;

const printKey = (code?: string, rarity?: string) => `${code ?? ''}|${rarity ?? ''}`;
const usd = (n: number) => (n > 0 ? `$${n.toFixed(2)}` : '');

/** Eine Zeile der Druckliste: ein bekannter Druck, "ohne Set" oder ein Eintrag mit unbekanntem Druck. */
interface PrintRow {
  id: string;
  code?: string;
  rarity?: string;
  set?: CardSet;
  entries: CollectionEntry[];
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
  // Der Schimmer folgt der Seltenheit des zuletzt hinzugefuegten Drucks.
  const [foil, setFoil] = useState(initialRarity ?? entries.find((e) => e.rarity)?.rarity ?? card.sets[0]?.rarity);
  const mainSection: DeckSection = isExtraDeckCard(card) ? 'extra' : 'main';
  const [targetDeck, setTargetDeck] = useState(deckId ?? decks.find((d) => deckCopies(d, card.id) > 0)?.id ?? decks[0]?.id ?? '');
  const deck = decks.find((d) => d.id === targetDeck);
  const decksWithCard = decks.filter((d) => deckCopies(d, card.id) > 0).length;

  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(false);
  const collectionRef = useRef<HTMLElement>(null);
  const deckRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  // Kopfleiste: oben durchsichtig, beim Scrollen mit Flaeche, ab dem verschwundenen Namen mit Titel.
  const [bar, setBar] = useState<'top' | 'scrolled' | 'titled'>('top');
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const barBottom = e.currentTarget.firstElementChild!.getBoundingClientRect().bottom;
    const nameBottom = nameRef.current?.getBoundingClientRect().bottom ?? Infinity;
    setBar(nameBottom < barBottom ? 'titled' : e.currentTarget.scrollTop > 4 ? 'scrolled' : 'top');
  };

  // Reihenfolge einmal beim Oeffnen festlegen: Besessenes zuerst, dann der gescannte Druck, dann nach Code.
  // Danach bleibt sie stehen, damit Zeilen beim Hinzufuegen nicht unter dem Finger wegspringen.
  const [order] = useState(() => {
    const ownedKeys = new Set(entries.map((e) => printKey(e.setCode, e.rarity)));
    const rank = (s: CardSet) => (ownedKeys.has(printKey(s.code, s.rarity)) ? 0 : s.rarity === initialRarity ? 1 : 2);
    const sets = [...card.sets].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
    // "Ohne Set" steht vorn, wenn besessen, sonst direkt hinter den besessenen Drucken.
    const ownedSets = sets.filter((s) => rank(s) === 0).length;
    return { sets, ownedSets, genericAt: ownedKeys.has(printKey()) ? 0 : ownedSets };
  });

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
  const facts = statFacts(card);
  const sections = textSections(cardDesc(card));
  const flavor = card.frameType === 'normal' || card.frameType === 'normal_pendulum';

  // Druckliste aufbauen. Eintraege ohne passenden Druck (z. B. aeltere Scans) erscheinen als eigene Zeilen.
  const known = new Set(card.sets.map((s) => printKey(s.code, s.rarity)));
  const byPrint = (code?: string, rarity?: string) => entries.filter((e) => printKey(e.setCode, e.rarity) === printKey(code, rarity));
  const orphans: PrintRow[] = entries
    .filter((e) => e.setCode && !known.has(printKey(e.setCode, e.rarity)))
    .map((e) => ({ id: e.key, code: e.setCode, rarity: e.rarity, entries: [e] }));
  const generic: PrintRow = { id: 'generic', entries: byPrint() };
  const setRows: PrintRow[] = order.sets.map((s, i) => ({ id: `${s.code}-${s.rarity}-${i}`, code: s.code, rarity: s.rarity, set: s, entries: byPrint(s.code, s.rarity) }));
  setRows.splice(order.genericAt, 0, generic);
  const rows = [...orphans, ...setRows];

  const many = card.sets.length > MANY_PRINTS;
  const q = filter.trim().toLowerCase();
  const matches = (r: PrintRow) =>
    !q || [r.code, r.rarity, r.set?.name, r.id === 'generic' ? 'ohne set' : ''].some((v) => v?.toLowerCase().includes(q));
  const filtered = rows.filter(matches);
  // Eingeklappt: alles bis einschliesslich "Ohne Set" (also alles Besessene beim Oeffnen) plus ein paar weitere Drucke.
  const collapsed = many && !expanded && !q;
  const visible = collapsed ? filtered.slice(0, orphans.length + order.ownedSets + 1 + COLLAPSED_PRINTS) : filtered;

  // Ein Druck mit mehreren Artworks in der Sammlung bekommt je Artwork eine eigene Zeile.
  const lines = visible.flatMap((r): { r: PrintRow; e?: CollectionEntry }[] => (r.entries.length > 0 ? r.entries.map((e) => ({ r, e })) : [{ r }]));

  const add = (r: PrintRow) => {
    const key = addToCollection(card.id, { imageId, setCode: r.code, rarity: r.rarity });
    if (r.rarity) setFoil(r.rarity);
    toast(`${name} zur Sammlung hinzugefügt`, { label: 'Rückgängig', run: () => changeQty(key, -1) });
  };

  const artworkNote = (e: CollectionEntry) => {
    const i = card.imageIds.indexOf(e.imageId);
    return card.imageIds.length > 1 && i > 0 ? `Artwork ${i + 1}` : '';
  };

  const jump = (el: HTMLElement | null) =>
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  const deckCount = (section: DeckSection) => (deck ? deck[section].filter((id) => id === card.id).length : 0);

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={name} onScroll={onScroll}>
      <div className={`detail-bar${bar !== 'top' ? ' scrolled' : ''}${bar === 'titled' ? ' titled' : ''}`}>
        <div className="detail-bar-inner">
          <span className="detail-bar-title" aria-hidden="true">
            {name}
          </span>
          <button className="detail-close icon-btn" onClick={closeCard} aria-label="Schließen">
            <IconClose />
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-stage">
          <Card3D imageId={imageId} alt={name} rarity={foil} />
          {card.imageIds.length > 1 && (
            <div className="arts" role="group" aria-label="Artworks">
              {card.imageIds.map((id, i) => (
                <button
                  key={id}
                  className={`art${id === imageId ? ' on' : ''}`}
                  onClick={() => setImageId(id)}
                  aria-label={`Artwork ${i + 1}`}
                  aria-pressed={id === imageId}
                >
                  <img src={imageUrl(id, 'cropped')} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          <header className="detail-head">
            <h2 className="detail-name" ref={nameRef}>
              {name}
            </h2>
            {alt && <p className="detail-alt">{alt}</p>}
            <p className="detail-type">
              <span className={`type-swatch ${frameClass(card.frameType)}`} aria-hidden="true" />
              {typeText}
              {card.banTcg && <span className="ban-flag">{BAN_LABEL[card.banTcg] ?? card.banTcg}</span>}
            </p>
          </header>

          {facts.length > 0 && (
            <dl className="detail-stats">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="detail-status">
            <button className={`status-item${owned > 0 ? ' on' : ''}`} onClick={() => jump(collectionRef.current)}>
              <IconBinder size={18} />
              {owned > 0 ? `${owned} im Besitz` : 'Nicht in der Sammlung'}
            </button>
            {decksWithCard > 0 && (
              <button className="status-item" onClick={() => jump(deckRef.current)}>
                <IconDecks size={18} />
                {decksWithCard === 1 ? 'In 1 Deck' : `In ${decksWithCard} Decks`}
              </button>
            )}
            {card.priceCm > 0 && (
              <span className="status-item static">
                Cardmarket <strong className="num">{formatPrice(card.priceCm)}</strong>
              </span>
            )}
          </div>

          <div className={`detail-text${flavor ? ' flavor' : ''}`}>
            {sections.map((s, i) => (
              <div key={i}>
                {s.label && <h4>{s.label}</h4>}
                <p>{s.text}</p>
              </div>
            ))}
          </div>

          <section className="detail-section" ref={collectionRef} aria-labelledby="detail-collection">
            <div className="section-head">
              <h3 id="detail-collection">Sammlung</h3>
              <span className="section-meta num">
                {owned === 1 ? '1 Exemplar' : `${owned} Exemplare`}
              </span>
            </div>
            <p className="section-sub">
              {card.sets.length === 0
                ? 'Keine TCG-Drucke bekannt. Du kannst die Karte ohne Set-Angabe erfassen.'
                : `Preise je Druck von TCGplayer${card.priceTcg > 0 ? `, Marktpreis der Karte ${usd(card.priceTcg)}` : ''}.`}
            </p>
            {many && (
              <label className="field print-filter">
                <IconSearch size={18} />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Druck suchen: Code, Set oder Seltenheit"
                  aria-label="Drucke filtern"
                />
              </label>
            )}
            <div className="sheet">
              {visible.length === 0 ? (
                <p className="sheet-empty">Kein Druck passt zu „{filter.trim()}“.</p>
              ) : (
                <ul className="prints">
                  {lines.map(({ r, e }) => {
                    const label = r.code ?? 'Ohne Set-Angabe';
                    const note = e ? artworkNote(e) : '';
                    const detail = r.set?.name ?? (r.id === 'generic' ? 'Druck nicht bekannt' : 'Druck nicht in der Datenbank');
                    return (
                      <li key={e?.key ?? r.id} className={`print${e ? ' owned' : ''}`}>
                        <span className="print-main">
                          <span className="print-id">
                            <span className="print-code">{label}</span>
                            {r.rarity && <span className="print-rarity">{r.rarity}</span>}
                          </span>
                          <small>{note ? `${detail} · ${note}` : detail}</small>
                        </span>
                        <span className="print-price num">{r.set ? usd(r.set.price) : ''}</span>
                        {e ? (
                          <span className="stepper">
                            <button className="icon-btn small" onClick={() => changeQty(e.key, -1)} aria-label={`${label}: eins weniger`}>
                              <IconMinus size={16} />
                            </button>
                            <span className="num" aria-label={`${e.qty} Exemplare`}>
                              {e.qty}
                            </span>
                            <button className="icon-btn small" onClick={() => changeQty(e.key, 1)} aria-label={`${label}: eins mehr`}>
                              <IconPlus size={16} />
                            </button>
                          </span>
                        ) : (
                          <button className="icon-btn small print-add" onClick={() => add(r)} aria-label={`${label}${r.rarity ? ` ${r.rarity}` : ''} hinzufügen`}>
                            <IconPlus size={18} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {collapsed && filtered.length > visible.length && (
                <button className="sheet-more" onClick={() => setExpanded(true)}>
                  Alle {card.sets.length} Drucke zeigen
                </button>
              )}
            </div>
          </section>

          <section className="detail-section" ref={deckRef} aria-labelledby="detail-deck">
            <div className="section-head">
              <h3 id="detail-deck">Deck</h3>
              {card.banTcg && (
                <span className="section-meta">{banLimit(card) === 0 ? 'Im Deck nicht erlaubt' : `max. ${banLimit(card)} pro Deck`}</span>
              )}
            </div>
            {decks.length === 0 ? (
              <p className="section-sub">Lege unter „Decks“ ein Deck an, um Karten zuzuordnen.</p>
            ) : (
              <div className="sheet deck-sheet">
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
                        <span className={`stepper${deckCount(section) > 0 ? ' on' : ''}`}>
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
              </div>
            )}
          </section>

          {card.url && (
            <a className="ext detail-ext" href={card.url} target="_blank" rel="noreferrer">
              Auf YGOPRODeck ansehen
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
