import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { imageUrl } from '../api/ygoprodeck';
import { holoStrength } from '../lib/format';
import { useStore } from '../lib/store';
import { cardBackStore, loadCardBack } from '../state/cardBack';
import { IconFlip, IconTilt } from './Icons';

interface Props {
  imageId: number;
  alt: string;
  rarity?: string;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function useCardBackImage(): string | null {
  useEffect(() => {
    void loadCardBack();
  }, []);
  return useStore(cardBackStore).url;
}

/**
 * Frei drehbare Karte mit Holo-Schimmer.
 * Ziehen dreht die Karte (mit Schwung), langsames Loslassen rastet auf Vorder- oder Rueckseite ein.
 * Winkel werden direkt per Style gesetzt, damit React nicht pro Frame rendert.
 */
export function Card3D({ imageId, alt, rarity }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const motion = useRef({
    rx: -4,
    ry: -16,
    vx: 0,
    vy: 0.9,
    dragging: false,
    lastX: 0,
    lastY: 0,
    idleMix: 1,
    tiltX: 0,
    tiltY: 0,
    targetTiltX: 0,
    targetTiltY: 0,
  });
  const backImage = useCardBackImage();
  const [gyro, setGyro] = useState<'off' | 'on' | 'denied'>('off');
  const gyroRef = useRef(gyro);
  gyroRef.current = gyro;
  const gyroSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const tick = (t: number) => {
      const s = motion.current;
      const el = cardRef.current;
      if (!s.dragging) {
        s.ry += s.vy;
        s.rx += s.vx;
        const friction = reduced ? 0.7 : 0.94;
        s.vy *= friction;
        s.vx *= friction;
        if (Math.abs(s.vx) < 0.05) s.rx += (0 - s.rx) * 0.05;
        if (Math.abs(s.vy) < 0.2) s.ry += (Math.round(s.ry / 180) * 180 - s.ry) * 0.06;
      }
      const resting = !s.dragging && Math.abs(s.vy) < 0.2 && gyroRef.current !== 'on' && !reduced;
      s.idleMix += ((resting ? 1 : 0) - s.idleMix) * 0.03;
      s.tiltX += (s.targetTiltX - s.tiltX) * 0.15;
      s.tiltY += (s.targetTiltY - s.tiltY) * 0.15;

      const rx = s.rx + Math.cos(t / 2300) * 4 * s.idleMix + s.tiltX;
      const ry = s.ry + Math.sin(t / 1700) * 7 * s.idleMix + s.tiltY;

      if (el) {
        el.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
        // Winkel relativ zur gerade sichtbaren Seite, -1..1
        const wrapped = ((((ry + 180) % 360) + 360) % 360) - 180;
        const facing = Math.abs(wrapped) <= 90 ? wrapped : wrapped - Math.sign(wrapped) * 180;
        const fx = clamp(facing / 60, -1, 1);
        const fy = clamp(rx / 40, -1, 1);
        el.style.setProperty('--px', `${50 + fx * 50}%`);
        el.style.setProperty('--py', `${50 + fy * 50}%`);
        el.style.setProperty('--gx', `${50 - fx * 65}%`);
        el.style.setProperty('--gy', `${50 + fy * 65}%`);
        el.style.setProperty('--sx', `${fx * 40}px`);
        el.style.setProperty('--sy', `${fy * 40}px`);
        el.style.setProperty('--hyp', clamp(Math.hypot(fx, fy), 0, 1).toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (gyro !== 'on') return;
    let base: number | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      base ??= e.beta;
      motion.current.targetTiltX = clamp(-(e.beta - base) * 0.9, -28, 28);
      motion.current.targetTiltY = clamp(e.gamma * 0.9, -28, 28);
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      motion.current.targetTiltX = 0;
      motion.current.targetTiltY = 0;
    };
  }, [gyro]);

  const toggleGyro = async () => {
    if (gyro === 'on') return setGyro('off');
    const DOE = DeviceOrientationEvent as DeviceOrientationEventWithPermission;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return setGyro('denied');
      } catch {
        return setGyro('denied');
      }
    }
    setGyro('on');
  };

  const flip = () => {
    motion.current.vy = 11.3; // Schwung fuer ca. eine halbe Drehung, Einrasten erledigt den Rest
  };

  const onPointerDown = (e: PointerEvent) => {
    const s = motion.current;
    s.dragging = true;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.vx = s.vy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = motion.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const dy = e.clientY - s.lastY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.ry += dx * 0.5;
    s.rx = clamp(s.rx - dy * 0.35, -55, 55);
    s.vy = clamp(dx * 0.5, -24, 24);
    s.vx = clamp(-dy * 0.2, -8, 8);
  };
  const onPointerUp = () => {
    motion.current.dragging = false;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const s = motion.current;
    if (e.key === 'ArrowLeft') s.vy -= 4;
    else if (e.key === 'ArrowRight') s.vy += 4;
    else if (e.key === 'ArrowUp') s.vx += 2;
    else if (e.key === 'ArrowDown') s.vx -= 2;
    else if (e.key === 'Enter' || e.key === ' ') flip();
    else return;
    e.preventDefault();
  };

  const style = { '--holo': holoStrength(rarity) } as CSSProperties;

  return (
    <div className="card3d">
      <div
        className="card3d-scene"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={flip}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="img"
        aria-label={`${alt}. Ziehen oder Pfeiltasten zum Drehen, Doppeltippen zum Umdrehen.`}
      >
        <div className="card3d-card" ref={cardRef} style={style}>
          <div className="card3d-face card3d-front">
            <img
              src={imageUrl(imageId, 'full')}
              style={{ backgroundImage: `url(${imageUrl(imageId, 'small')})` }}
              alt=""
              draggable={false}
            />
            <div className="card3d-holo" />
            <div className="card3d-sparkle" />
            <div className="card3d-glare" />
          </div>
          <div className={`card3d-face card3d-back${backImage ? ' has-image' : ''}`}>
            {backImage && <img src={backImage} alt="" draggable={false} />}
            <div className="card3d-glare" />
          </div>
        </div>
        <div className="card3d-shadow" />
      </div>
      <div className="card3d-controls">
        <button className="btn ghost" onClick={flip}>
          <IconFlip size={18} /> Umdrehen
        </button>
        {gyroSupported && (
          <button className={`btn ghost${gyro === 'on' ? ' active' : ''}`} onClick={toggleGyro} aria-pressed={gyro === 'on'}>
            <IconTilt size={18} /> {gyro === 'denied' ? 'Bewegungssensor gesperrt' : 'Neigen'}
          </button>
        )}
      </div>
    </div>
  );
}
