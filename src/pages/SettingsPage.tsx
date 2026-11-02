import { useEffect, useRef } from 'react';
import type { CollectionEntry, Deck } from '../types';
import { checkForUpdate, dbStatus, downloadCardDb } from '../db/cardDb';
import { useStore } from '../lib/store';
import { download } from '../lib/format';
import { cardBackStore, loadCardBack, resetCardBack, setCardBack } from '../state/cardBack';
import { collectionStore } from '../state/collection';
import { decksStore } from '../state/decks';
import { settingsStore } from '../state/settings';
import { toast } from '../state/ui';
import { PageHeader } from './PageHeader';

export function SettingsPage() {
  const settings = useStore(settingsStore);
  const status = useStore(dbStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  const cardBack = useStore(cardBackStore);

  useEffect(() => {
    void loadCardBack();
  }, []);
  const busy = status.phase === 'downloading';
  const wantGerman = settings.lang === 'de';

  const exportBackup = () => {
    const data = { app: 'kartenbinder', exportedAt: new Date().toISOString(), collection: collectionStore.get(), decks: decksStore.get() };
    download(`kartenbinder-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  };

  const importBackup = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { collection?: CollectionEntry[]; decks?: Deck[] };
      if (!Array.isArray(data.collection) || !Array.isArray(data.decks)) throw new Error('kein Kartenbinder-Backup');
      if (!confirm(`Backup mit ${data.collection.length} Sammlungseinträgen und ${data.decks.length} Decks laden? Der aktuelle Stand wird ersetzt.`)) return;
      collectionStore.set(data.collection);
      decksStore.set(data.decks);
      toast('Backup geladen');
    } catch (err) {
      toast(`Backup konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <PageHeader title="Einstellungen" back="collection" />

      <section className="panel">
        <h3>Kartensprache</h3>
        <div className="segmented" role="radiogroup" aria-label="Kartensprache">
          {(['de', 'en'] as const).map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={settings.lang === l}
              className={settings.lang === l ? 'on' : ''}
              onClick={() => settingsStore.set((s) => ({ ...s, lang: l }))}
            >
              {l === 'de' ? 'Deutsch' : 'Englisch'}
            </button>
          ))}
        </div>
        {wantGerman && !status.hasDe && (
          <p className="hint">
            Deutsche Namen sind noch nicht geladen. Bis dahin erscheinen englische Namen und deutsche Karten werden nur über
            Set-Code und Passcode erkannt.{' '}
            <button className="btn small" disabled={busy} onClick={() => downloadCardDb(true)}>
              Deutsche Texte laden
            </button>
          </p>
        )}
      </section>

      <section className="panel">
        <h3>Kartendatenbank</h3>
        <p>
          {status.count.toLocaleString('de-DE')} Karten
          {status.savedAt ? `, Stand ${new Date(status.savedAt).toLocaleDateString('de-DE')}` : ''}
          {status.hasDe ? ', mit deutschen Texten' : ''}.
        </p>
        {busy && <p className="hint">{status.progress}</p>}
        {status.error && <p className="error">{status.error}</p>}
        <div className="btn-row">
          <button
            className="btn"
            disabled={busy}
            onClick={async () => toast((await checkForUpdate()) ? 'Neue Kartendaten verfügbar' : 'Kartendaten sind aktuell')}
          >
            Auf Updates prüfen
          </button>
          <button className={`btn${status.updateAvailable ? ' primary' : ''}`} disabled={busy} onClick={() => downloadCardDb(status.hasDe || wantGerman)}>
            Jetzt aktualisieren
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Scannen</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoAdd}
            onChange={(e) => settingsStore.set((s) => ({ ...s, autoAdd: e.target.checked }))}
          />
          <span>
            Sichere Treffer direkt hinzufügen
            <small>Aus: Treffer werden nur angezeigt und per Tipp übernommen. Rückgängig geht in beiden Fällen.</small>
          </span>
        </label>
      </section>

      <section className="panel">
        <h3>Kartenrückseite</h3>
        <div className="back-setting">
          <span className={`back-preview${cardBack.url ? '' : ' builtin'}`}>{cardBack.url && <img src={cardBack.url} alt="Aktuelle Rückseite" />}</span>
          <div>
            <p className="hint">
              Fotografiere die Rückseite einer deiner Karten oder wähle ein Bild. Schneide es möglichst knapp auf die Karte
              zu, es erscheint in der 3D-Ansicht beim Umdrehen.
            </p>
            <div className="btn-row">
              <button className="btn" onClick={() => backRef.current?.click()}>
                Bild wählen
              </button>
              {cardBack.custom && (
                <button className="btn ghost" onClick={() => void resetCardBack().then(() => toast('Eingebaute Rückseite wiederhergestellt'))}>
                  Zurücksetzen
                </button>
              )}
            </div>
          </div>
          <input
            ref={backRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                setCardBack(f)
                  .then(() => toast('Rückseite gespeichert'))
                  .catch((err) => toast(`Bild konnte nicht gespeichert werden: ${String(err)}`));
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="panel">
        <h3>Sicherung</h3>
        <p className="hint">Sammlung und Decks liegen nur in diesem Browser. Exportiere regelmäßig ein Backup, um sie auf ein anderes Gerät zu übertragen.</p>
        <div className="btn-row">
          <button className="btn" onClick={exportBackup}>
            Backup exportieren
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Backup importieren
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <p className="setup-note">
        Kartendaten, Bilder und Preise stammen aus der öffentlichen API von db.ygoprodeck.com. Yu-Gi-Oh! ist eine Marke von
        Konami. Diese App ist ein privates Fanprojekt.
      </p>
    </>
  );
}
