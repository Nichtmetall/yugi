import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCard, homography, project, quadShift, quadSignature, rectQuad, warpQuad, type Quad } from '../src/scan/detect.ts';
import type { Pixels } from '../src/scan/image.ts';

type Rgb = [number, number, number];

/** Reproduzierbares Rauschen. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Grobes Kartenlayout in Kartenkoordinaten 0..1: Rand, Rahmen, Namensfeld, Bild, Textfeld. */
function cardColor(u: number, v: number, seed: number): Rgb {
  if (u < 0.03 || u > 0.97 || v < 0.022 || v > 0.978) return [55, 58, 80];
  if (v > 0.04 && v < 0.098 && u > 0.06 && u < 0.94) return Math.floor(v * 400) % 3 === 0 && u < 0.7 ? [40, 30, 20] : [205, 150, 85];
  if (u > 0.11 && u < 0.89 && v > 0.18 && v < 0.73) {
    // Artwork: weiche Formen ohne lange gerade Kanten
    const a = Math.sin(u * 11 + seed) + Math.cos(v * 13 - seed * 0.7) + Math.sin((u + v) * 7 * (1 + (seed % 3)));
    return [120 + a * 40, 90 + a * 25, 140 - a * 35];
  }
  if (u > 0.07 && u < 0.93 && v > 0.745 && v < 0.945) return Math.floor(v * 300) % 4 === 0 && u < 0.85 ? [70, 60, 50] : [228, 218, 192];
  return [190, 110, 60];
}

/** Szene: Hintergrund mit Rauschen, Karte in `quad` (4 x 4 Unterabtastung fuer weiche Kanten wie bei einer Kamera). */
function scene(w: number, h: number, quad: Quad | null, bg: (x: number, y: number) => Rgb, seed = 1): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const toCard = quad ? homography(quad, rectQuad(0, 0, 1, 1)) : null;
  const noise = rng(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let s = 0; s < 16; s++) {
        const p = toCard && project(toCard, x + ((s % 4) + 0.5) / 4, y + ((s >> 2) + 0.5) / 4);
        const c = p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? cardColor(p.x, p.y, seed) : bg(x, y);
        for (let k = 0; k < 3; k++) acc[k] += c[k] / 16;
      }
      const n = (noise() - 0.5) * 12;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = acc[k] + n;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const table = (): Rgb => [120, 122, 128];
/** Holzartige Streifen, schraeg zur Karte. */
const wood = (x: number, y: number): Rgb => {
  const s = Math.floor((y + x * 0.17) / 9) % 2 ? 18 : -18;
  return [150 + s, 100 + s, 60 + s];
};

/** Groesster Eckenfehler relativ zur Kartenbreite. */
function cornerError(found: Quad, truth: Quad): number {
  const width = Math.hypot(truth[1].x - truth[0].x, truth[1].y - truth[0].y);
  return Math.max(...found.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y))) / width;
}

test('homography legt die Ecken aufeinander', () => {
  const to: Quad = [
    { x: 10, y: 20 },
    { x: 200, y: 35 },
    { x: 180, y: 300 },
    { x: 5, y: 260 },
  ];
  const h = homography(rectQuad(0, 0, 59, 86), to);
  rectQuad(0, 0, 59, 86).forEach((p, i) => {
    const q = project(h, p.x, p.y);
    assert.ok(Math.hypot(q.x - to[i].x, q.y - to[i].y) < 1e-6);
  });
});

test('detectCard findet eine gerade liegende Karte', () => {
  const truth = rectQuad(80, 90, 160, 233);
  const found = detectCard(scene(320, 420, truth, table));
  assert.ok(found, 'keine Karte gefunden');
  assert.ok(cornerError(found, truth) < 0.012, `Ecken zu ungenau: ${cornerError(found, truth)}`);
});

test('detectCard findet eine gedrehte, perspektivisch verzerrte Karte (Aussenkante, nicht innerer Rand)', () => {
  const truth: Quad = [
    { x: 92, y: 70 },
    { x: 236, y: 92 },
    { x: 222, y: 330 },
    { x: 58, y: 302 },
  ];
  const found = detectCard(scene(320, 420, truth, table, 3));
  assert.ok(found, 'keine Karte gefunden');
  assert.ok(cornerError(found, truth) < 0.015, `Ecken zu ungenau: ${cornerError(found, truth)}`);
});

test('detectCard bleibt auf Holzmaserung an der Kartenkante', () => {
  const truth: Quad = [
    { x: 70, y: 80 },
    { x: 230, y: 70 },
    { x: 245, y: 305 },
    { x: 78, y: 318 },
  ];
  const found = detectCard(scene(320, 420, truth, wood, 5));
  assert.ok(found, 'keine Karte gefunden');
  assert.ok(cornerError(found, truth) < 0.02, `Ecken zu ungenau: ${cornerError(found, truth)}`);
});

test('detectCard meldet nichts ohne Karte und bei angeschnittener Karte', () => {
  assert.equal(detectCard(scene(320, 420, null, wood)), null);
  const cut = rectQuad(200, 90, 160, 233); // ragt rechts aus dem Bild
  assert.equal(detectCard(scene(320, 420, cut, table)), null);
});

test('warpQuad richtet die Karte auf: Rand, Bild und Textfeld liegen an ihrer Stelle', () => {
  const truth: Quad = [
    { x: 92, y: 70 },
    { x: 236, y: 92 },
    { x: 222, y: 330 },
    { x: 58, y: 302 },
  ];
  const src = scene(320, 420, truth, table, 3);
  const out: Pixels = { data: new Uint8ClampedArray(118 * 172 * 4), width: 118, height: 172 };
  warpQuad(src, truth, out);
  const at = (u: number, v: number) => {
    const i = (Math.floor(v * out.height) * out.width + Math.floor(u * out.width)) * 4;
    return [out.data[i], out.data[i + 1], out.data[i + 2]];
  };
  const near = (c: number[], want: Rgb) => Math.max(...c.map((x, k) => Math.abs(x - want[k]))) < 25;
  assert.ok(near(at(0.5, 0.15), [190, 110, 60]), 'Rahmen zwischen Namensfeld und Bild');
  assert.ok(near(at(0.95, 0.85), [190, 110, 60]), 'Rahmen rechts vom Textfeld');
  assert.ok(near(at(0.5, 0.99), [55, 58, 80]), 'Rand unten');
  assert.ok(near(at(0.9, 0.93), [228, 218, 192]), 'Textfeld');
});

test('quadSignature: dieselbe Karte an anderer Stelle sieht gleich aus, eine andere Karte nicht', () => {
  const a = rectQuad(40, 60, 150, 219);
  const b = rectQuad(130, 150, 150, 219);
  const sigA = quadSignature(scene(320, 420, a, table, 7), a);
  const sigB = quadSignature(scene(320, 420, b, table, 7), b);
  const sigOther = quadSignature(scene(320, 420, a, table, 20), a);
  const diff = (x: Uint8Array, y: Uint8Array) => x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / x.length;
  assert.ok(diff(sigA, sigB) < 6, `gleiche Karte: ${diff(sigA, sigB)}`);
  assert.ok(diff(sigA, sigOther) > 12, `andere Karte: ${diff(sigA, sigOther)}`);
});

test('quadShift ist der mittlere Eckenabstand', () => {
  assert.equal(quadShift(rectQuad(0, 0, 10, 10), rectQuad(3, 4, 10, 10)), 5);
});
