import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../api/ygoprodeck';
import { useStore } from '../lib/store';
import { cardName } from '../lib/format';
import { findCard, getOcrWorker, grabCard, grabQuad, inspectCard, onOcrStatus, readCard, signatureDiff, snapshot } from '../scan/ocr';
import { homography, project, quadArea, quadShift, quadSignature, rectQuad, type Point, type Quad } from '../scan/detect';
import { observe, rankCandidates, verdict, type Candidate, type Observation } from '../scan/recognize';
import { addToCollection, changeQty } from '../state/collection';
import { addCardToDeck, decksStore, defaultSection, removeCardFromDeck, SECTION_LABEL } from '../state/decks';
import { settingsStore } from '../state/settings';
import { detailStore, openCard } from '../state/ui';
import { IconCheck, IconMinus, IconPlus, IconTorch } from '../components/Icons';

/** Eine erfasste Karte dieser Sitzung (ein Druck, ggf. mehrere Exemplare). */
interface Entry {
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
  | { kind: 'unknown'; read: string; glare: boolean }
  | { kind: 'pick'; candidates: Candidate[]; sure: boolean }
  | { kind: 'added'; id: number };

/** Pause zwischen zwei Kartensuchen; die Suche selbst dauert auf dem Handy etwa 50 bis 150 ms. */
const TICK_MS = 60;
/** Mittlere Helligkeitsabweichung zwischen zwei Proben, unter der das Bild als ruhig gilt. */
const STEADY = 8;
/** Darunter liegt noch dieselbe Karte im Rahmen wie beim letzten Lesen. */
const SAME_SCENE = 12;
/** Wackelt das Bild laenger, wird trotzdem gelesen. */
const MAX_WAIT_MS = 1500;
/** Unsichere Treffer so oft neu lesen, solange sich nichts aendert. */
const MAX_TRIES = 4;
/** Ein Bild, das unschaerfer ist als dieser Anteil des schaerfsten der Szene, wird uebersprungen (Fokus pumpt noch). */
const SHARP_KEEP = 0.7;
/** Ab diesem Anteil ausgebrannter Pixel in Textfeld oder Set-Code-Bereich gilt das Bild als spiegelnd. */
const GLARE = 0.04;
/** Dauer der Haken-Animation nach dem Hinzufuegen. */
const CHECK_MS = 900;
/**
 * Geschwindigkeit der Ecken (Kartengroessen je Sekunde), unter der eine erkannte Karte als ruhig gilt: Bei 1/30 s
 * Belichtung verwischt das um weniger als 0,3 % der Karte. Wo sie liegt, ist egal, gelesen wird aus demselben Bild.
 */
const STEADY_SPEED = 0.08;
/** So lange ohne Karte, bis der Rahmen in die Mitte zurueckkehrt: Aussetzer (Bewegungsunschaerfe) lassen ihn nicht flackern. */
const LOST_MS = 600;
/**
 * Aendert sich die Flaeche der erkannten Karte von einem Bild zum naechsten um mehr als diesen Faktor (log), zaehlt das
 * erst, wenn das naechste Bild es bestaetigt: Ein einzelnes Bild mit einem inneren Rechteck (Bildfeld, waehrend die
 * Karte halb aus dem Bild ragt) laesst den Rahmen nicht springen.
 */
const JUMP = Math.log(1.25);
/** Zeitkonstante, mit der der Rahmen der Karte nachgleitet. */
const FOLLOW_MS = 70;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Umriss eines Rechtecks mit abgerundeten Ecken (im Uhrzeigersinn), fuer die Aussparung in der Abdunklung. */
function roundedOutline(w: number, h: number, r: number): Point[] {
  const pts: Point[] = [];
  for (const [cx, cy, start] of [
    [w - r, r, -90],
    [w - r, h - r, 0],
    [r, h - r, 90],
    [r, r, 180],
  ]) {
    for (let i = 0; i <= 4; i++) {
      const a = ((start + i * 22.5) * Math.PI) / 180;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return pts;
}
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
  const maskRef = useRef<SVGPathElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  /** Erkannte Karte in Sucher-Koordinaten (CSS-Pixel); null = Rahmen ruht in der Mitte. */
  const cardQuadRef = useRef<Quad | null>(null);

  const [camError, setCamError] = useState('');
  const [live, setLive] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = nicht unterstuetzt
  const [ocrStatus, setOcrStatus] = useState('Texterkennung wird geladen …');
  const [ocrReady, setOcrReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [locked, setLocked] = useState(false);
  /** Zaehler fuer die Haken-Animation; jeder neue Wert spielt sie erneut ab, 0 = aus. */
  const [check, setCheck] = useState(0);
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
          // Mehr Pixel fuer die kleine Set-Code- und Passcode-Schrift; Geraete ohne 1440p liefern das Naechstkleinere.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (caps.torch) setTorch(false);
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        }
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

  // Haken nach dem Abspielen wieder entfernen (auch bei reduzierter Bewegung, dort ohne Animation).
  useEffect(() => {
    if (!check) return;
    const t = setTimeout(() => setCheck(0), CHECK_MS);
    return () => clearTimeout(t);
  }, [check]);

  // Rahmen und Abdunklung folgen der erkannten Karte perspektivisch (matrix3d); ohne Karte ruhen sie in der Mitte.
  useEffect(() => {
    let raf = 0;
    let shown: Quad | null = null;
    let last = performance.now();
    let radius: number | null = null;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const el = frameRef.current;
      const mask = maskRef.current;
      const view = viewRef.current;
      if (!el || !mask || !view) return;
      const { offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h } = el;
      const target = cardQuadRef.current ?? rectQuad(x, y, w, h);
      const k = 1 - Math.exp(-(now - last) / FOLLOW_MS);
      last = now;
      const next = shown ? (shown.map((p, i) => ({ x: p.x + (target[i].x - p.x) * k, y: p.y + (target[i].y - p.y) * k })) as Quad) : target;
      if (shown && quadShift(next, target) < 0.05 && quadShift(shown, target) < 0.05) return; // steht still
      shown = next;
      if (cardQuadRef.current) el.dataset.tracking = '';
      else delete el.dataset.tracking;
      const m = homography(
        rectQuad(0, 0, w, h),
        shown.map((p) => ({ x: p.x - x, y: p.y - y })),
      );
      el.style.transform = `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,1)`;
      radius ??= parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const hole = roundedOutline(w, h, radius).map((p) => project(m, p.x, p.y));
      mask.setAttribute(
        'd',
        `M0 0H${view.clientWidth}V${view.clientHeight}H0Z M${hole.map((p) => `${(p.x + x).toFixed(1)} ${(p.y + y).toFixed(1)}`).join('L')}Z`,
      );
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const confirmAdded = () => {
    setCheck((n) => n + 1);
    navigator.vibrate?.(40);
  };

  const add = (cand: Candidate, others: Candidate[]) => {
    const fresh: Entry = { id: ++entrySeq, cand, others, target: targetRef.current, rarity: cand.prints[0]?.rarity, qty: 0 };
    const e = addCopies(fresh, 1);
    setEntries([e, ...entriesRef.current].slice(0, 60));
    setDock({ kind: 'added', id: e.id });
    setLocked(true);
    confirmAdded();
  };

  const more = (id: number) => {
    const e = findEntry(id);
    if (!e) return;
    replaceEntry(addCopies(e, 1));
    confirmAdded();
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
    setDock(e.others.length ? { kind: 'pick', candidates: e.others, sure: false } : { kind: 'idle' });
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
    /** Lesungen der aktuellen Szene; sie werden gemeinsam ausgewertet. */
    let obs: Observation[] = [];
    let bestSharp = 0;
    lastAutoId.current = null;

    const geometry = () => {
      const view = viewRef.current;
      const frame = frameRef.current;
      if (!view || !frame) return null;
      // Ruhelage des Rahmens: die Layout-Box, nicht die (der Karte folgende) transformierte.
      return {
        frame: { x: frame.offsetLeft, y: frame.offsetTop, w: frame.offsetWidth, h: frame.offsetHeight },
        view: { w: view.clientWidth, h: view.clientHeight },
      };
    };

    const read = async (sig: Uint8Array, card: HTMLCanvasElement, glare: boolean) => {
      setReading(true);
      setLocked(false);
      // Bei einer Bestaetigungslesung bleibt der Rahmen im Lesezustand, statt kurz zu flackern.
      let again = false;
      try {
        const ocr = await readCard(card);
        if (stop) return;
        lastSig = sig;
        const o = observe(ocr);
        obs = [...obs, o].slice(-MAX_TRIES);
        const ranked = rankCandidates(obs);
        const best = ranked[0];
        const empty = !best && o.q.length < 4;

        if (!best) {
          lastAutoId.current = null; // Rahmen leer: dieselbe Karte darf danach erneut erfasst werden
          if (empty) {
            settled = true;
            if (dockRef.current.kind !== 'added') setDock({ kind: 'idle' });
          } else {
            settled = ++tries >= MAX_TRIES;
            setDock({ kind: 'unknown', read: [ocr.name, ocr.codes.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' | '), glare });
          }
          return;
        }

        const v = verdict(ranked);
        const auto = settingsStore.get().autoAdd;
        if (v === 'sure' && auto) {
          settled = true;
          if (best.card.id !== lastAutoId.current) {
            lastAutoId.current = best.card.id;
            add(best, ranked.slice(1));
          }
          return;
        }

        tries++;
        // Nur ueber den Namen belegt: erst eine weitere Lesung derselben Karte abwarten, dann automatisch uebernehmen.
        if (v === 'confirm' && auto && tries < MAX_TRIES) {
          again = true;
          return;
        }
        const sure = v !== 'unsure';
        settled = (sure && !auto) || tries >= MAX_TRIES;
        const shown = dockRef.current;
        // Liegt der gleiche beste Treffer schon im Dock, Liste nicht unter dem Finger austauschen.
        if (shown.kind !== 'pick' || shown.candidates[0]?.card.id !== best.card.id || shown.sure !== sure) {
          setDock({ kind: 'pick', candidates: ranked, sure });
        }
      } catch (err) {
        settled = true;
        setDock({ kind: 'unknown', read: `Fehler bei der Texterkennung: ${String(err)}`, glare: false });
      } finally {
        if (!again) setReading(false);
      }
    };

    let prevQuad: Quad | null = null;
    let prevAt = 0;
    let seenAt = 0;
    /** Laeuft gerade eine Texterkennung? Der Rahmen folgt der Karte trotzdem weiter. */
    let busy = false;

    (async () => {
      while (!stop) {
        await sleep(TICK_MS);
        const video = videoRef.current;
        const g = geometry();
        if (document.hidden || detailStore.get() || !video?.videoWidth || !g) continue;

        const at = performance.now();
        const snap = snapshot(video, g.view);
        let quad = await findCard(snap.px, prevQuad);
        if (stop) break;
        if (quad && prevQuad && Math.abs(Math.log(quadArea(quad) / quadArea(prevQuad))) > JUMP) quad = null;
        if (quad) {
          seenAt = at;
          cardQuadRef.current = quad.map((p) => ({ x: p.x * snap.scale, y: p.y * snap.scale })) as Quad;
        } else if (at - seenAt > LOST_MS) cardQuadRef.current = null;

        // Bei erkannter Karte die entzerrte Karte vergleichen: Verschieben im Bild ist dann kein Kartenwechsel.
        const s = 1 / snap.scale;
        const sig = quadSignature(snap.px, quad ?? rectQuad(g.frame.x * s, g.frame.y * s, g.frame.w * s, g.frame.h * s));
        const speed =
          quad && prevQuad
            ? (quadShift(quad, prevQuad) / Math.sqrt(quadArea(quad)) / Math.max(1, at - prevAt)) * 1000
            : quad || prevQuad
              ? Infinity
              : 0;
        const steady = prevSig !== null && signatureDiff(sig, prevSig) < STEADY && speed < STEADY_SPEED;
        prevSig = sig;
        prevQuad = quad;
        prevAt = at;
        if (busy) continue;
        const force = forceRef.current;

        if (!lastSig || signatureDiff(sig, lastSig) >= SAME_SCENE) {
          settled = false;
          tries = 0;
          obs = [];
          bestSharp = 0;
        }
        if (settled && !force) {
          waitingSince = performance.now();
          continue;
        }
        // Auf ein ruhiges Bild warten, aber nicht ewig.
        const patient = !force && performance.now() - waitingSince < MAX_WAIT_MS;
        if (!steady && patient) continue;

        const card = quad ? grabQuad(snap, quad) : grabCard(snap, g.frame, g.view);
        const quality = inspectCard(card);
        // Ruhig, aber deutlich unschaerfer als schon gesehen (Fokus sucht noch): auf ein besseres Bild warten.
        if (patient && quality.sharpness < bestSharp * SHARP_KEEP) continue;
        bestSharp = Math.max(bestSharp, quality.sharpness);

        forceRef.current = false;
        if (force) {
          tries = 0;
          obs = [];
        }
        busy = true;
        void read(sig, card, quality.glare >= GLARE).finally(() => {
          busy = false;
          waitingSince = performance.now();
        });
      }
    })();
    return () => {
      stop = true;
      cardQuadRef.current = null;
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
          <svg className="scan-mask" aria-hidden="true">
            <path ref={maskRef} fillRule="evenodd" />
          </svg>
          <div className={`scan-frame${reading ? ' reading' : ''}${locked ? ' locked' : ''}`} ref={frameRef}>
            <span className="frame-name" />
            <span className="frame-code" />
            {check > 0 && (
              <span className="scan-check" key={check} aria-hidden="true">
                <svg viewBox="0 0 52 52">
                  <path d="M15 27l7.5 7.5L37 19" pathLength={1} />
                </svg>
              </span>
            )}
          </div>

          {!live && <div className="viewfinder-msg">{camError || 'Kamera wird gestartet …'}</div>}

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

        </div>

        <div className="scan-dock" aria-live="polite">
          {camError ? (
            <p className="dock-msg error">Ohne Kamera kein Scan. Karten lassen sich über die Suche hinzufügen.</p>
          ) : !ocrReady ? (
            <p className="dock-msg">{ocrStatus}</p>
          ) : dock.kind === 'added' && shownEntry ? (
            <AddedCard key={shownEntry.id} entry={shownEntry} onMore={more} onUndo={undo} onRarity={changeRarity} />
          ) : dock.kind === 'pick' ? (
            <PickCard key={dock.candidates[0].card.id} candidates={dock.candidates} sure={dock.sure} onAdd={add} />
          ) : dock.kind === 'unknown' ? (
            <div className="dock-msg dock-in" key="unknown">
              <strong>Nicht erkannt</strong>
              <span>
                {dock.glare
                  ? 'Die Karte spiegelt. Kippe sie leicht oder ändere das Licht, dann ins Bild tippen, um neu zu lesen.'
                  : 'Karte flach und ohne Spiegelung in den Rahmen legen, oder ins Bild tippen, um neu zu lesen.'}
              </span>
              {dock.read && <small className="dock-read">Gelesen: {dock.read}</small>}
            </div>
          ) : (
            <div className="dock-msg" key="idle">
              <strong>{reading ? 'Lese Karte …' : 'Karte ins Bild halten'}</strong>
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

function AddedCard({
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
          <span className="dock-ok" title="Hinzugefügt">
            <IconCheck size={18} />
            <span className="sr-only">Hinzugefügt</span>
          </span>
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

function PickCard({
  candidates,
  sure,
  onAdd,
}: {
  candidates: Candidate[];
  sure: boolean;
  onAdd: (c: Candidate, others: Candidate[]) => void;
}) {
  const [best, ...others] = candidates;
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
