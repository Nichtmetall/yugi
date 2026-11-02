import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { AddedCard, PickCard, ScanPage, type Entry } from '../src/pages/ScanPage';
import type { Card } from '../src/types';
import type { Candidate } from '../src/scan/recognize';

const card = (id: number, name: string): Card => ({ id, name, type: 'Effect Monster', frameType: 'effect', desc: '', race: 'Dragon', imageIds: [id], sets: [], priceCm: 0, priceTcg: 0 });
const cand = (id: number, name: string, score: number, setCode?: string, rarities: string[] = []): Candidate => ({
  card: card(id, name), score, imageId: id, setCode, reasons: ['Name'],
  prints: rarities.map((r) => ({ code: setCode ?? '', name: 'Set', rarity: r, rarityCode: '', price: 0 })),
});
const state = new URLSearchParams(location.search).get('state') ?? 'live';
const noop = () => {};
const entry: Entry = { id: 1, cand: cand(89631139, 'Blauäugiger w. Drache', 0.97, 'LOB-DE001', ['Ultra Rare', 'Secret Rare']), others: [], target: 'collection', rarity: 'Ultra Rare', key: 'k', qty: 2 };
const pick = [cand(46986414, 'Dunkler Magier', 0.8, 'SDY-DE006'), cand(38033121, 'Dunkles Magier-Mädchen', 0.7), cand(1, 'Magier des schwarzen Chaos', 0.6)];

const dock = state === 'added' ? <AddedCard entry={entry} onMore={noop} onUndo={noop} onRarity={noop} />
  : state === 'pick' ? <PickCard candidates={pick} onAdd={noop} /> : null;

createRoot(document.getElementById('root')!).render(
  <>
    <main className="page">
      {dock ? (
        <div className="scanner">
          <div className="viewfinder" style={{ background: 'linear-gradient(160deg,#3b3326,#14110c)' }}>
            <div className="scan-frame locked"><span className="frame-name" /><span className="frame-code" /></div>
            <div className="scan-top"><label className="scan-target"><select><option>Sammlung</option></select></label>
              <button className="scan-torch"><svg width="22" height="22" /></button></div>
          </div>
          <div className="scan-dock">{dock}</div>
        </div>
      ) : <ScanPage />}
    </main>
    <nav className="tabbar">{['Sammlung', 'Decks', 'Scannen', 'Suche'].map((t) => <button key={t} className={`tab${t === 'Scannen' ? ' tab-scan on' : ''}`}><span className="tab-icon" /><span className="tab-label">{t}</span></button>)}</nav>
  </>,
);
