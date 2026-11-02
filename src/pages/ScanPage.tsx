import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../api/ygoprodeck';
import { useStore } from '../lib/store';
import { cardName } from '../lib/format';
import { getOcrWorker, grabCard, onOcrStatus, readCard } from '../scan/ocr';
import { rankCandidates, SURE_SCORE, type Candidate } from '../scan/recognize';
import { addToCollection, changeQty } from '../state/collection';
import { addCardToDeck, decksStore, defaultSection, removeCardFromDeck } from '../state/decks';
import { settingsStore } from '../state/settings';
import { openCard, toast } from '../state/ui';
import { IconCamera, IconTorch } from '../components/Icons';
import { PageHeader } from './PageHeader';

interface Added {
  id: number;
  cardId: number;
  imageId: number;
  label: string;
  undo: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ScanPage() {
  const decks = useStore(decksStore);
  const settings = useStore(settingsStore);
  const viewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  const [camError, setCamError] = useState('');
  const [live, setLive] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = nicht unterstuetzt
  const [ocrStatus, setOcrStatus] = useState('Texterkennung wird geladen …');
  const [ocrReady, setOcrReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [readText, setReadText] = useState('');
  const [rarityPick, setRarityPick] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Added[]>([]);
  const [target, setTarget] = useState('collection');

  const busyRef = useRef(false);
  const lastAutoId = useRef<number | null>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const stateRef = useRef({ target, settings, rarityPick });
  stateRef.current = { target, settings, rarityPick };

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

  const addCandidate = (c: Candidate) => {
    const { target, rarityPick } = stateRef.current;
    const name = cardName(c.card);
    let undo: () => void;
    if (target === 'collection') {
      const rarity = rarityPick[c.card.id] ?? (c.prints.length >= 1 ? c.prints[0].rarity : undefined);
      const key = addToCollection(c.card.id, { imageId: c.imageId, setCode: c.setCode, rarity });
      undo = () => changeQty(key, -1);
    } else {
      const section = defaultSection(c.card);
      addCardToDeck(target, c.card, section);
      undo = () => removeCardFromDeck(target, c.card.id, section);
    }
    const entry: Added = { id: Date.now() + Math.random(), cardId: c.card.id, imageId: c.imageId, label: name, undo };
    setAdded((list) => [entry, ...list].slice(0, 30));
    navigator.vibrate?.(40);
    toast(`${name} hinzugefügt`, {
      label: 'Rückgängig',
      run: () => {
        undo();
        setAdded((list) => list.filter((a) => a.id !== entry.id));
      },
    });
  };

  const scan = async () => {
    const video = videoRef.current;
    const view = viewRef.current?.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (busyRef.current || !video || !view || !frame || !video.videoWidth) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const canvas = grabCard(
        video,
        { x: frame.left - view.left, y: frame.top - view.top, w: frame.width, h: frame.height },
        { w: view.width, h: view.height },
      );
      const ocr = await readCard(canvas);
      const ranked = rankCandidates(ocr);
      setReadText([ocr.name, ocr.codes.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' | '));
      setCandidates(ranked);
      // Beim manuellen Ausloesen Treffer ins Bild holen; im Auto-Scan bleibt die Kamera sichtbar.
      if (!autoRef.current) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      const best = ranked[0];
      if (!best) lastAutoId.current = null; // Rahmen leer: dieselbe Karte darf danach erneut erfasst werden
      if (autoRef.current && stateRef.current.settings.autoAdd && best && best.score >= SURE_SCORE) {
        if (best.card.id !== lastAutoId.current) {
          lastAutoId.current = best.card.id;
          addCandidate(best);
        }
      }
    } catch (err) {
      setReadText(`Fehler bei der Texterkennung: ${String(err)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Auto-Scan: fortlaufend erkennen, solange aktiv
  useEffect(() => {
    if (!auto || !live || !ocrReady) return;
    let stop = false;
    lastAutoId.current = null;
    (async () => {
      while (!stop) {
        await scan();
        await sleep(600);
      }
    })();
    return () => {
      stop = true;
    };
  }, [auto, live, ocrReady]);

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

  const best = candidates?.[0];

  return (
    <>
      <PageHeader title="Scannen" />
      <div className="scan-target">
        <label htmlFor="scan-target">Hinzufügen zu</label>
        <select id="scan-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="collection">Sammlung</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              Deck: {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="viewfinder" ref={viewRef}>
        <video ref={videoRef} playsInline muted />
        <div className={`scan-frame${busy ? ' reading' : ''}${best && best.score >= SURE_SCORE ? ' locked' : ''}`} ref={frameRef}>
          <span className="frame-name" />
          <span className="frame-code" />
        </div>
        {!live && <div className="viewfinder-msg">{camError || 'Kamera wird gestartet …'}</div>}
      </div>

      <div className="scan-controls">
        <button
          className={`icon-btn${torch ? ' active' : ''}`}
          onClick={toggleTorch}
          disabled={torch === null}
          aria-pressed={!!torch}
          aria-label="Licht"
          title={torch === null ? 'Licht wird von dieser Kamera nicht unterstützt' : 'Licht'}
        >
          <IconTorch />
        </button>
        <button className="shutter" onClick={scan} disabled={!live || !ocrReady || busy || auto} aria-label="Karte erkennen">
          <IconCamera size={28} />
        </button>
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!live || !ocrReady} />
          <span>Auto</span>
        </label>
      </div>
      <p className="scan-hint">
        {!ocrReady
          ? ocrStatus
          : auto
            ? settings.autoAdd
              ? 'Auto-Scan läuft. Sichere Treffer werden direkt hinzugefügt, leg einfach die nächste Karte in den Rahmen.'
              : 'Auto-Scan läuft. Tippe auf einen Treffer, um ihn hinzuzufügen.'
            : 'Karte flach in den Rahmen legen, Name oben, ohne Spiegelung. Dann auslösen.'}
      </p>

      {candidates && (
        <section className="panel results" aria-live="polite" ref={resultsRef}>
          {candidates.length === 0 ? (
            <p className="hint">
              Keine Karte erkannt. Halte die Karte ruhig und vollständig im Rahmen und vermeide Spiegelungen auf der Folie.
            </p>
          ) : (
            <ul className="rows">
              {candidates.map((c, i) => (
                <li key={c.card.id} className={`row cand${i === 0 ? ' top' : ''}`}>
                  <button className="cand-thumb" onClick={() => openCard({ cardId: c.card.id, imageId: c.imageId })} aria-label={`${cardName(c.card)} ansehen`}>
                    <img src={imageUrl(c.imageId, 'small')} alt="" />
                  </button>
                  <span className="row-main">
                    {cardName(c.card)}
                    <small>
                      {c.score >= SURE_SCORE ? 'Sicher' : 'Möglich'}: {c.reasons.join(', ')}
                      {c.setCode ? `, ${c.setCode}` : ''}
                    </small>
                    {target === 'collection' && new Set(c.prints.map((p) => p.rarity)).size > 1 && (
                      <select
                        value={rarityPick[c.card.id] ?? c.prints[0].rarity}
                        onChange={(e) => setRarityPick((r) => ({ ...r, [c.card.id]: e.target.value }))}
                        aria-label="Seltenheit"
                      >
                        {[...new Set(c.prints.map((p) => p.rarity))].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    )}
                  </span>
                  <button className={`btn${i === 0 ? ' primary' : ''}`} onClick={() => addCandidate(c)}>
                    Hinzufügen
                  </button>
                </li>
              ))}
            </ul>
          )}
          {readText && <p className="read-text">Gelesen: {readText}</p>}
        </section>
      )}

      {added.length > 0 && (
        <section className="panel">
          <h3>
            In diesem Scan hinzugefügt <span className="count">{added.length}</span>
          </h3>
          <ul className="rows">
            {added.map((a) => (
              <li key={a.id} className="row">
                <button className="row-main link" onClick={() => openCard({ cardId: a.cardId, imageId: a.imageId })}>
                  {a.label}
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    a.undo();
                    setAdded((list) => list.filter((x) => x.id !== a.id));
                  }}
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
