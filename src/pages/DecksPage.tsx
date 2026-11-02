import { useMemo, useRef, useState } from 'react';
import { imageUrl } from '../api/ygoprodeck';
import { useStore } from '../lib/store';
import { deckStats } from '../lib/deckStats';
import { parseYdk } from '../lib/ydk';
import { collectionStore, ownedCounts } from '../state/collection';
import { createDeck, decksStore } from '../state/decks';
import { navigate, toast } from '../state/ui';
import { IconDecks, IconPlus } from '../components/Icons';
import { PageHeader } from './PageHeader';

export function DecksPage() {
  const decks = useStore(decksStore);
  const collection = useStore(collectionStore);
  const owned = useMemo(() => ownedCounts(collection), [collection]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const create = () => {
    const deck = createDeck(name);
    setName('');
    setNaming(false);
    navigate(`decks/${deck.id}`);
  };

  const importYdk = async (file: File) => {
    const parsed = parseYdk(await file.text());
    const count = parsed.main.length + parsed.extra.length + parsed.side.length;
    if (!count) return toast('In der Datei wurden keine Karten gefunden. Erwartet wird eine .ydk-Datei.');
    const deck = createDeck(file.name.replace(/\.ydk$/i, ''), parsed);
    toast(`${deck.name} mit ${count} Karten importiert`);
  };

  return (
    <>
      <PageHeader title="Decks" />
      {naming ? (
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input autoFocus placeholder="Name des Decks" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name des Decks" />
          <button className="btn primary" type="submit">
            Anlegen
          </button>
          <button className="btn ghost" type="button" onClick={() => setNaming(false)}>
            Abbrechen
          </button>
        </form>
      ) : (
        <div className="btn-row">
          <button className="btn primary" onClick={() => setNaming(true)}>
            <IconPlus size={18} /> Neues Deck
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            YDK importieren
          </button>
          <input
            ref={fileRef}
            type="file"
            // Kein accept: iOS kennt keinen Dateityp fuer .ydk und graut solche Dateien sonst aus.
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importYdk(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {decks.length === 0 ? (
        <p className="hint">
          Lege ein Deck an oder importiere eine .ydk-Datei. Die App zeigt dir dann, welche Karten du schon besitzt und welche
          noch fehlen.
        </p>
      ) : (
        <ul className="deck-list">
          {decks.map((d) => {
            const st = deckStats(d, owned);
            const cover = d.main[0] ?? d.extra[0];
            const pct = st.total ? Math.round((st.have / st.total) * 100) : 0;
            const complete = st.total > 0 && st.missing.length === 0;
            return (
              <li key={d.id}>
                <button className="deck-item" onClick={() => navigate(`decks/${d.id}`)}>
                  <span className="deck-cover">
                    {cover ? <img src={imageUrl(cover, 'cropped')} alt="" loading="lazy" /> : <IconDecks />}
                  </span>
                  <span className="deck-meta">
                    <span className="deck-name">{d.name}</span>
                    <span className="deck-counts num">
                      Main {st.counts.main} · Extra {st.counts.extra} · Side {st.counts.side}
                    </span>
                  </span>
                  <span className="deck-own">
                    {st.total === 0 ? (
                      <span className="deck-own-label none">Leer</span>
                    ) : (
                      <>
                        <span className={`deck-own-label${complete ? ' done' : ''}`} aria-hidden="true">
                          {complete ? 'Komplett' : `${st.have}/${st.total}`}
                        </span>
                        <span className="sr-only">
                          {complete ? 'Alle Karten vorhanden' : `${st.have} von ${st.total} Karten vorhanden`}
                        </span>
                        <span className={`meter${complete ? ' done' : ''}`} aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
