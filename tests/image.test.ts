import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundColor,
  clippedShare,
  FRAME_GROUPS,
  frameGroup,
  frameProbabilities,
  ocrGray,
  otsu,
  sharpness,
  textMask,
  type Pixels,
} from '../src/scan/image.ts';

type Rgb = [number, number, number];

/** Bild aus einer Farbfunktion je Pixel. */
function image(width: number, height: number, color: (x: number, y: number) => Rgb): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      [data[i], data[i + 1], data[i + 2]] = color(x, y);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Zwei waagrechte "Schriftbalken" auf Hintergrund (ca. 20 % Schrift). */
const textLike = (bg: Rgb, ink: Rgb) => image(40, 20, (x, y) => ((y === 6 || y === 13) && x > 4 && x < 36 ? ink : bg));

const argmax = (p: number[]) => FRAME_GROUPS[p.indexOf(Math.max(...p))];

test('otsu trennt zwei Helligkeitsklassen', () => {
  const hist = new Array(256).fill(0);
  hist[30] = 200;
  hist[200] = 800;
  const s = otsu(hist);
  assert.ok(s.threshold >= 30 && s.threshold < 200);
  assert.equal(s.darkShare, 0.2);
});

test('ocrGray: helle Schrift auf dunklem Grund wird zu dunkler Schrift auf hellem Grund', () => {
  const g = ocrGray(textLike([20, 20, 30], [240, 240, 240]));
  assert.equal(g[0], 255); // Hintergrund
  assert.equal(g[6 * 40 + 10], 0); // Schrift
});

test('ocrGray nimmt den Farbkanal mit dem besten Kontrast', () => {
  // Gleiche Helligkeit, aber im Rotkanal klar getrennt (wie Goldschrift auf farbigem Rahmen).
  const g = ocrGray(textLike([200, 100, 100], [90, 155, 100]));
  assert.ok(g[0] - g[6 * 40 + 10] > 150);
});

test('textMask stellt Zeichen frei und verwirft Rahmenlinien, angeschnittene Teile und die andere Polaritaet', () => {
  // Mittelgrauer Rahmen, oben eine dunkle Linie ueber die ganze Breite, rechts ein dunkles "Zeichen", links ein helles.
  const px = image(80, 40, (x, y) => {
    if (y === 3) return [20, 20, 20];
    if (x >= 60 && x < 64 && y >= 15 && y < 25) return [10, 10, 10];
    if (x >= 20 && x < 24 && y >= 15 && y < 25) return [250, 250, 250];
    return [140, 140, 140];
  });
  const dark = textMask(px, true);
  assert.equal(dark[20 * 80 + 61], 0); // dunkles Zeichen
  assert.equal(dark[3 * 80 + 40], 255); // Linie bis an den Rand
  assert.equal(dark[20 * 80 + 21], 255); // helles Zeichen
  assert.equal(dark[30 * 80 + 40], 255); // Hintergrund
  const light = textMask(px, false);
  assert.equal(light[20 * 80 + 21], 0);
  assert.equal(light[20 * 80 + 61], 255);
});

test('sharpness: scharfe Kanten zaehlen mehr als weiche', () => {
  const sharp = image(30, 30, (x) => (x < 15 ? [0, 0, 0] : [255, 255, 255]));
  const soft = image(30, 30, (x) => {
    const v = Math.max(0, Math.min(255, (x - 10) * 25));
    return [v, v, v];
  });
  assert.ok(sharpness(sharp) > sharpness(soft) * 4);
});

test('clippedShare zaehlt ausgebrannte Pixel', () => {
  const px = image(10, 10, (x) => (x < 3 ? [255, 255, 255] : [240, 230, 210]));
  assert.equal(clippedShare(px), 0.3);
});

test('backgroundColor ignoriert die Schrift', () => {
  assert.deepEqual(backgroundColor(textLike([184, 99, 55], [10, 10, 10])), [184, 99, 55]);
  assert.deepEqual(backgroundColor(textLike([34, 35, 36], [240, 240, 240])), [34, 35, 36]);
});

test('frameProbabilities ordnet Rahmenfarben zu, auch kamera-typisch verschoben', () => {
  // gemessen an YGOPRODeck-Kartenbildern
  assert.equal(argmax(frameProbabilities([195, 153, 82])), 'normal');
  assert.equal(argmax(frameProbabilities([184, 99, 55])), 'effect');
  assert.equal(argmax(frameProbabilities([11, 147, 128])), 'spell');
  assert.equal(argmax(frameProbabilities([170, 40, 120])), 'trap');
  assert.equal(argmax(frameProbabilities([30, 99, 153])), 'link');
  assert.equal(argmax(frameProbabilities([34, 35, 36])), 'xyz');
  // dunkler und etwas waermer, wie bei Zimmerlicht
  assert.equal(argmax(frameProbabilities([170, 140, 85])), 'normal');
  assert.equal(argmax(frameProbabilities([160, 92, 60])), 'effect');
  assert.equal(argmax(frameProbabilities([10, 120, 105])), 'spell');
});

test('frameGroup bildet Pendel- und Spielmarken-Rahmen ab', () => {
  assert.equal(frameGroup('effect_pendulum'), 'effect');
  assert.equal(frameGroup('token'), 'synchro');
  assert.equal(frameGroup('skill'), null);
});
