import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../api/ygoprodeck';
import { useStore } from '../lib/store';
import { cardName } from '../lib/format';
import { normalizeName } from '../scan/match';
import { frameSignature, getOcrWorker, grabCard, onOcrStatus, readCard, signatureDiff } from '../scan/ocr';
import { rankCandidates, SURE_SCORE, type Candidate } from '../scan/recognize';
import { addToCollection, changeQty } from '../state/collection';
import { addCardToDeck, decksStore, defaultSection, removeCardFromDeck, SECTION_LABEL } from '../state/decks';
import { settingsStore } from '../state/settings';
import { detailStore, openCard } from '../state/ui';
import { IconMinus, IconPlus, IconTorch } from '../components/Icons';

/** Eine erfasste Karte dieser Sitzung (ein Druck, ggf. mehrere Exemplare). */
export interface Entry {
  id: number;
  cand: Candidate;
  /** Weitere Treffer desselben Scans, falls der Auto-Treffer falsch war. */
  others: Candidate[];
  target: string;
  rarity?: string;
  key?: string;
  qty: number;
}

type Dock =
  | { kind: 'idle' }
  | { kind: 'unknown'; read: string }
  | { kind: 'pick'; candidates: Candidate[] }
  | { kind: 'added'; id: number };

const TICK_MS = 150;
/** Mittlere Helligkeitsabweichung zwischen zwei Proben, unter der das Bild als ruhig gilt. */
const STEADY = 8;
/** Darunter liegt noch dieselbe Karte im Rahmen wie beim letzten Lesen. */
const SAME_SCENE = 12;
/** Wackelt das Bild laenger, wird trotzdem gelesen. */
const MAX_WAIT_MS = 1500;
/** Unsichere Treffer so oft neu lesen, solange sich nichts aendert. */
const MAX_TRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rarities = (c: Candidate) => [...new Set(c.prints.map((p) => p.rarity))];
let entrySeq = 0;

function addCopies(e: Entry, n: number): Entry {
  if (e.target === 'collection') {
    const key = addToCollection(e.cand.card.id, { imageId: e.cand.imageId, setCode: e.cand.setCode, rarity: e.rarity }, n);
    return { ...e, key, qty: e.qty + n };
  }
  for (let i = 0; i < n; i++) addCardToDeck(e.target, e.cand.card);
  return { ...e, qty: e.qty + n };
}

function removeCopies(e: Entry, n: number) {
  if (e.target === 'collection') {
    if (e.key) changeQty(e.key, -n);
    return;
  }
  for (let i = 0; i < n; i++) removeCardFromDeck(e.target, e.cand.card.id, defaultSection(e.cand.card));
}

export function ScanPage() {
  const decks = useStore(decksStore);
  const settings = useStore(settingsStore);
  const viewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [camError, setCamError] = useState('');
  const [live, setLive] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = nicht unterstuetzt
  const [ocrStatus, setOcrStatus] = useState('Texterkennung wird geladen …');
  const [ocrReady, setOcrReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [target, setTarget] = useState('collection');
  const [dock, setDockState] = useState<Dock>({ kind: 'idle' });
  const [entries, setEntriesState] = useState<Entry[]>([]);

  // Spiegel fuer die Scan-Schleife, die ausserhalb des Render-Zyklus laeuft.
  const dockRef = useRef(dock);
  const entriesRef = useRef(entries);
  const targetRef = useRef(target);
  targetRef.current = target;
  const lastAutoId = useRef<number | null>(null);
  const forceRef = useRef(false);

  const setDock = (d: Dock) => {
    dockRef.current = d;
    setDockState(d);
  };
  const setEntries = (list: Entry[]) => {
    entriesRef.current = list;
    setEntriesState(list);
  };
  const replaceEntry = (e: Entry) => setEntries(entriesRef.current.map((x) => (x.id === e.id ? e : x)));
  const findEntry = (id: number) => entriesRef.current.find((x) => x.id === id);

  // Kamera starten
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError(
          window.isSecureContext
            ? 'Dieser Browser unterstützt keinen Kamerazugriff.'
            : 'Die Kamera funktioniert nur über HTTPS. Öffne die App mit https:// statt http://.',
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        if (caps.torch) setTorch(false);
        setLive(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setCamError(
          name === 'NotAllowedError'
            ? 'Kamerazugriff wurde verweigert. Erlaube die Kamera in den Browser-Einstellungen für diese Seite und lade neu.'
            : name === 'NotFoundError'
              ? 'Keine Kamera gefunden.'
              : `Kamera konnte nicht gestartet werden (${name || String(err)}).`,
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, []);

  // Texterkennung vorladen
  useEffect(() => {
    onOcrStatus(setOcrStatus);
    getOcrWorker()
      .then(() => setOcrReady(true))
      .catch((err) => setOcrStatus(`Texterkennung konnte nicht geladen werden: ${String(err)}`));
    return () => onOcrStatus(null);
  }, []);

  const add = (cand: Candidate, others: Candidate[]) => {
    const fresh: Entry = { id: ++entrySeq, cand, others, target: targetRef.current, rarity: cand.prints[0]?.rarity, qty: 0 };
    const e = addCopies(fresh, 1);
    setEntries([e, ...entriesRef.current].slice(0, 60));
    setDock({ kind: 'added', id: e.id });
    navigator.vibrate?.(40);
  };

  const more = (id: number) => {
    const e = findEntry(id);
    if (e) replaceEntry(addCopies(e, 1));
  };

  const less = (id: number) => {
    const e = findEntry(id);
    if (!e) return;
    removeCopies(e, 1);
    if (e.qty > 1) return replaceEntry({ ...e, qty: e.qty - 1 });
    setEntries(entriesRef.current.filter((x) => x.id !== id));
    const d = dockRef.current;
    if (d.kind === 'added' && d.id === id) setDock({ kind: 'idle' });
  };

  /** Falscher Treffer: alles zuruecknehmen und die anderen Kandidaten anbieten. */
  const undo = (id: number) => {
    const e = findEntry(id);
    if (!e) return;
    removeCopies(e, e.qty);
    setEntries(entriesRef.current.filter((x) => x.id !== id));
    setDock(e.others.length ? { kind: 'pick', candidates: e.others } : { kind: 'idle' });
  };

  const changeRarity = (id: number, rarity: string) => {
    const e = findEntry(id);
    if (!e || e.rarity === rarity) return;
    removeCopies(e, e.qty);
    replaceEntry(addCopies({ ...e, rarity, qty: 0 }, e.qty));
  };

  // Fortlaufend erkennen: nur ruhige Bilder lesen, und dieselbe Karte nicht immer wieder.
  useEffect(() => {
    if (!live || !ocrReady) return;
    let stop = false;
    let prevSig: Uint8Array | null = null;
    let lastSig: Uint8Array | null = null;
    let settled = false;
    let tries = 0;
    let waitingSince = performance.now();
    lastAutoId.current = null;

    const geometry = () => {
      const view = viewRef.current?.getBoundingClientRect();
      const frame = frameRef.current?.getBoundingClientRect();
      if (!view || !frame) return null;
      return {
        frame: { x: frame.left - view.left, y: frame.top - view.top, w: frame.width, h: frame.height },
        view: { w: view.width, h: view.height },
      };
    };

    const read = async (sig: Uint8Array) => {
      const video = videoRef.current;
      const g = geometry();
      if (!video || !g) return;
      setReading(true);
      try {
        const ocr = await readCard(grabCard(video, g.frame, g.view));
        if (stop) return;
        lastSig = sig;
        const ranked = rankCandidates(ocr);
        const best = ranked[0];
        const empty = !best && normalizeName(ocr.name).length < 4;

        if (!best) {
          lastAutoId.current = null; // Rahmen leer: dieselbe Karte darf danach erneut erfasst werden
          if (empty) {
            settled = true;
            if (dockRef.current.kind !== 'added') setDock({ kind: 'idle' });
          } else {
            settled = ++tries >= MAX_TRIES;
            setDock({ kind: 'unknown', read: [ocr.name, ocr.codes.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' | ') });
          }
          return;
        }

        const sure = best.score >= SURE_SCORE;
        if (sure && settingsStore.get().autoAdd) {
          settled = true;
          if (best.card.id !== lastAutoId.current) {
            lastAutoId.current = best.card.id;
            add(best, ranked.slice(1));
          }
          return;
        }

        settled = sure || ++tries >= MAX_TRIES;
        const shown = dockRef.current;
        // Liegt der gleiche beste Treffer schon im Dock, Liste nicht unter dem Finger austauschen.
        if (shown.kind !== 'pick' || shown.candidates[0]?.card.id !== best.card.id) setDock({ kind: 'pick', candidates: ranked });
      } catch (err) {
        settled = true;
        setDock({ kind: 'unknown', read: `Fehler bei der Texterkennung: ${String(err)}` });
      } finally {
        setReading(false);
      }
    };

    (async () => {
      while (!stop) {
        await sleep(TICK_MS);
        const video = videoRef.current;
        const g = geometry();
        if (document.hidden || detailStore.get() || !video?.videoWidth || !g) continue;

        const sig = frameSignature(video, g.frame, g.view);
        const steady = prevSig !== null && signatureDiff(sig, prevSig) < STEADY;
        prevSig = sig;
        const force = forceRef.current;

        if (!lastSig || signatureDiff(sig, lastSig) >= SAME_SCENE) {
          settled = false;
          tries = 0;
        }
        if (settled && !force) {
          waitingSince = performance.now();
          continue;
        }
        // Auf ein ruhiges Bild warten, aber nicht ewig.
        if (!steady && !force && performance.now() - waitingSince < MAX_WAIT_MS) continue;

        forceRef.current = false;
        if (force) tries = 0;
        await read(sig);
        waitingSince = performance.now();
      }
    })();
    return () => {
      stop = true;
    };
  }, [live, ocrReady]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const targetName = target === 'collection' ? 'die Sammlung' : `Deck „${decks.find((d) => d.id === target)?.name ?? ''}“`;
  const shownEntry = dock.kind === 'added' ? entries.find((e) => e.id === dock.id) : undefined;
  const total = entries.reduce((n, e) => n + e.qty, 0);
  const locked = dock.kind === 'added' && !reading;

  return (
    <>
      <h1 className="sr-only">Scannen</h1>
      <div className="scanner">
        <div className="viewfinder" ref={viewRef}>
          <video ref={videoRef} playsInline muted />
          <button
            className="viewfinder-tap"
            onClick={() => (forceRef.current = true)}
            disabled={!live || !ocrReady}
            aria-label="Karte neu lesen"
          />
          <div className={`scan-frame${reading ? ' reading' : ''}${locked ? ' locked' : ''}`} ref={frameRef}>
            <span className="frame-name" />
            <span className="frame-code" />
          </div>

          <div className="scan-top">
            <label className="scan-target">
              <span className="sr-only">Hinzufügen zu</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="collection">Sammlung</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    Deck: {d.name}
                  </option>
                ))}
              </select>
            </label>
            {torch !== null && (
              <button className={`scan-torch${torch ? ' on' : ''}`} onClick={toggleTorch} aria-pressed={torch} aria-label="Licht">
                <IconTorch />
              </button>
            )}
          </div>

          {!live && <div className="viewfinder-msg">{camError || 'Kamera wird gestartet …'}</div>}
        </div>

        <div className="scan-dock" aria-live="polite">
          {camError ? (
            <p className="dock-msg error">Ohne Kamera kein Scan. Karten lassen sich über die Suche hinzufügen.</p>
          ) : !ocrReady ? (
            <p className="dock-msg">{ocrStatus}</p>
          ) : dock.kind === 'added' && shownEntry ? (
            <AddedCard key={shownEntry.id} entry={shownEntry} onMore={more} onUndo={undo} onRarity={changeRarity} />
          ) : dock.kind === 'pick' ? (
            <PickCard key={dock.candidates[0].card.id} candidates={dock.candidates} onAdd={add} />
          ) : dock.kind === 'unknown' ? (
            <div className="dock-msg dock-in" key="unknown">
              <strong>Nicht erkannt</strong>
              <span>Karte flach und ohne Spiegelung in den Rahmen legen, oder ins Bild tippen, um neu zu lesen.</span>
              {dock.read && <small className="dock-read">Gelesen: {dock.read}</small>}
            </div>
          ) : (
            <div className="dock-msg" key="idle">
              <strong>{reading ? 'Lese Karte …' : 'Karte in den Rahmen legen'}</strong>
              <span>
                {settings.autoAdd
                  ? `Erkannte Karten kommen direkt in ${targetName}.`
                  : 'Treffer erscheinen hier, ein Tipp übernimmt sie.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {entries.length > 0 && (
        <section className="panel scan-session">
          <h3>
            Diese Sitzung <span className="count num">{total}</span>
          </h3>
          <ul className="rows">
            {entries.map((e) => (
              <li key={e.id} className="row">
                <button className="session-thumb" onClick={() => openCard({ cardId: e.cand.card.id, imageId: e.cand.imageId, rarity: e.rarity })} aria-label={`${cardName(e.cand.card)} ansehen`}>
                  <img src={imageUrl(e.cand.imageId, 'small')} alt="" />
                </button>
                <span className="row-main">
                  {cardName(e.cand.card)}
                  <small>{entryMeta(e, decks)}</small>
                </span>
                <span className="session-qty num">×{e.qty}</span>
                <button className="icon-btn small" onClick={() => less(e.id)} aria-label={`Ein Exemplar ${cardName(e.cand.card)} entfernen`}>
                  <IconMinus size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function entryMeta(e: Entry, decks: { id: string; name: string }[]): string {
  if (e.target === 'collection') return [e.cand.setCode, e.rarity].filter(Boolean).join(' · ') || 'Sammlung';
  const deck = decks.find((d) => d.id === e.target)?.name ?? 'Deck';
  return `${deck} · ${SECTION_LABEL[defaultSection(e.cand.card)]}`;
}

function Thumb({ cand, rarity }: { cand: Candidate; rarity?: string }) {
  return (
    <button className="dock-thumb" onClick={() => openCard({ cardId: cand.card.id, imageId: cand.imageId, rarity })} aria-label={`${cardName(cand.card)} ansehen`}>
      <img src={imageUrl(cand.imageId, 'small')} alt="" />
    </button>
  );
}

export function AddedCard({
  entry,
  onMore,
  onUndo,
  onRarity,
}: {
  entry: Entry;
  onMore: (id: number) => void;
  onUndo: (id: number) => void;
  onRarity: (id: number, rarity: string) => void;
}) {
  const decks = useStore(decksStore);
  const opts = entry.target === 'collection' ? rarities(entry.cand) : [];
  return (
    <div className="dock-card dock-in">
      <Thumb cand={entry.cand} rarity={entry.rarity} />
      <div className="dock-body">
        <p className="dock-name">
          {cardName(entry.cand.card)}
          {entry.qty > 1 && <span className="dock-qty num"> ×{entry.qty}</span>}
        </p>
        <p className="dock-meta">
          <span className="dock-ok">Hinzugefügt</span>
          {opts.length > 1 ? (
            <>
              {entry.cand.setCode && <span>{entry.cand.setCode}</span>}
              <select value={entry.rarity} onChange={(e) => onRarity(entry.id, e.target.value)} aria-label="Seltenheit">
                {opts.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </>
          ) : (
            <span>{entryMeta(entry, decks)}</span>
          )}
        </p>
        <div className="dock-actions">
          <button className="btn small" onClick={() => onMore(entry.id)}>
            <IconPlus size={16} /> Noch eine
          </button>
          <button className="btn small ghost" onClick={() => onUndo(entry.id)}>
            Rückgängig
          </button>
        </div>
      </div>
    </div>
  );
}

export function PickCard({ candidates, onAdd }: { candidates: Candidate[]; onAdd: (c: Candidate, others: Candidate[]) => void }) {
  const [best, ...others] = candidates;
  const sure = best.score >= SURE_SCORE;
  return (
    <div className="dock-card dock-in">
      <Thumb cand={best} />
      <div className="dock-body">
        <p className="dock-name">{cardName(best.card)}</p>
        <p className="dock-meta">
          <span className={sure ? 'dock-ok' : 'dock-unsure'}>{sure ? 'Erkannt' : 'Unsicher'}</span>
          {best.setCode && <span>{best.setCode}</span>}
        </p>
        <div className="dock-actions">
          <button className="btn small primary" onClick={() => onAdd(best, others)}>
            <IconPlus size={16} /> Hinzufügen
          </button>
          {others.slice(0, 3).map((c) => (
            <button
              key={c.card.id}
              className="btn small ghost dock-alt"
              onClick={() => onAdd(c, candidates.filter((x) => x !== c))}
              title={`Stattdessen ${cardName(c.card)}`}
            >
              {cardName(c.card)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
