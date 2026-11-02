import { useState } from 'react';
import { useStore } from '../lib/store';
import { dbStatus, downloadCardDb } from '../db/cardDb';
import { settingsStore } from '../state/settings';

/** Erststart: Kartendatenbank einmalig auf das Geraet laden. */
export function DbSetup() {
  const status = useStore(dbStatus);
  const [withGerman, setWithGerman] = useState(settingsStore.get().lang === 'de');
  const busy = status.phase === 'downloading';

  return (
    <div className="setup">
      <div className="setup-mark" aria-hidden="true" />
      <h1>Kartenbinder</h1>
      <p className="setup-lead">
        Für Suche und Kamera-Scan lädt die App einmalig alle Karten aus der öffentlichen YGOPRODeck-Datenbank auf dein
        Gerät. Danach funktioniert die Suche auch offline.
      </p>
      <label className="check">
        <input type="checkbox" checked={withGerman} disabled={busy} onChange={(e) => setWithGerman(e.target.checked)} />
        <span>
          Deutsche Kartennamen und Texte mitladen
          <small>Nötig, um deutsche Karten am Namen zu erkennen. Etwa doppelte Datenmenge.</small>
        </span>
      </label>
      <button
        className="btn primary wide"
        disabled={busy}
        onClick={() => {
          settingsStore.set((s) => ({ ...s, lang: withGerman ? 'de' : 'en' }));
          void downloadCardDb(withGerman);
        }}
      >
        {busy ? status.progress : 'Kartendatenbank laden'}
      </button>
      {status.error && <p className="error">{status.error}</p>}
      <p className="setup-note">Etwa 15–40 MB, am besten im WLAN. Kartendaten und Bilder: db.ygoprodeck.com</p>
    </div>
  );
}
