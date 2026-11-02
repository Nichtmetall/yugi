import { useEffect, type ReactNode } from 'react';
import { useStore } from './lib/store';
import { dbStatus, downloadCardDb, initCardDb } from './db/cardDb';
import { settingsStore } from './state/settings';
import { navigate, useRoute } from './state/ui';
import { CardDetail } from './components/CardDetail';
import { DbSetup } from './components/DbSetup';
import { Toasts } from './components/Toasts';
import { IconBinder, IconCamera, IconDecks, IconSearch } from './components/Icons';
import { CollectionPage } from './pages/CollectionPage';
import { DecksPage } from './pages/DecksPage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { ScanPage } from './pages/ScanPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS: { path: string; label: string; icon: ReactNode }[] = [
  { path: 'collection', label: 'Sammlung', icon: <IconBinder /> },
  { path: 'decks', label: 'Decks', icon: <IconDecks /> },
  { path: 'scan', label: 'Scannen', icon: <IconCamera /> },
  { path: 'search', label: 'Suche', icon: <IconSearch /> },
];

export function App() {
  const status = useStore(dbStatus);
  const [page = 'collection', param] = useRoute();

  useEffect(() => {
    void initCardDb();
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, param]);

  if (status.phase === 'init') return <div className="splash" aria-label="Lädt" />;
  if (status.count === 0) return <DbSetup />;

  let content: ReactNode;
  if (page === 'decks' && param) content = <DeckEditorPage deckId={param} />;
  else if (page === 'decks') content = <DecksPage />;
  else if (page === 'scan') content = <ScanPage />;
  else if (page === 'search') content = <SearchPage />;
  else if (page === 'settings') content = <SettingsPage />;
  else content = <CollectionPage />;

  return (
    <>
      {status.updateAvailable && status.phase === 'ready' && (
        <div className="banner">
          <span>Neue Kartendaten verfügbar.</span>
          <button className="btn small" onClick={() => downloadCardDb(status.hasDe || settingsStore.get().lang === 'de')}>
            Aktualisieren
          </button>
        </div>
      )}
      {status.phase === 'downloading' && <div className="banner">{status.progress}</div>}
      <main className="page" key={`${page}/${param ?? ''}`}>
        {content}
      </main>
      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map((t) => (
          <button
            key={t.path}
            className={`tab${t.path === 'scan' ? ' tab-scan' : ''}${page === t.path ? ' on' : ''}`}
            onClick={() => navigate(t.path)}
            aria-current={page === t.path ? 'page' : undefined}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <CardDetail />
      <Toasts />
    </>
  );
}
