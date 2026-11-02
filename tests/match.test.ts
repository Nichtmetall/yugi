import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPasscodes,
  extractSetCodes,
  levenshtein,
  matchNames,
  normalizeName,
  setCodeKey,
} from '../src/scan/match.ts';
import { parseYdk, toYdk } from '../src/lib/ydk.ts';

const entries = [
  { key: normalizeName('Blue-Eyes White Dragon'), id: 89631139 },
  { key: normalizeName('Blauäugiger w. Drache'), id: 89631139 },
  { key: normalizeName('Dark Magician'), id: 46986414 },
  { key: normalizeName('Schwarzer Magier'), id: 46986414 },
  { key: normalizeName('Dark Magician Girl'), id: 38033121 },
  { key: normalizeName('Pot of Greed'), id: 55144522 },
];

test('normalizeName entfernt Umlaute, Akzente und Satzzeichen', () => {
  assert.equal(normalizeName('Blauäugiger w. Drache'), 'blauaugigerwdrache');
  assert.equal(normalizeName('Größe'), 'grosse');
  assert.equal(normalizeName('Elemental HERO Neos'), 'elementalheroneos');
});

test('levenshtein mit Abbruch', () => {
  assert.equal(levenshtein('kitten', 'sitting', 5), 3);
  assert.equal(levenshtein('abc', 'abcdefghij', 3), 4);
});

test('matchNames findet Karten trotz OCR-Fehlern', () => {
  assert.equal(matchNames('Dark Magiclan', entries)[0].id, 46986414);
  assert.equal(matchNames('Schwarzer Maqier', entries)[0].id, 46986414);
  assert.equal(matchNames('BIue-Eyes White Dragon', entries)[0].id, 89631139);
  // Rahmensymbole am Zeilenende
  assert.equal(matchNames('Pot of Greed @ ~', entries)[0].id, 55144522);
  // echter OCR-Output aus dem Kamera-Test: Zauber-Symbol als "2" gelesen
  const pot = matchNames('POT OF GREED 2', entries)[0];
  assert.equal(pot.id, 55144522);
  assert.ok(pot.score >= 0.96);
  assert.ok(matchNames('Dark Magician Girl', entries)[0].score > 0.95);
  assert.equal(matchNames('Dark Magician Girl', entries)[0].id, 38033121);
  assert.deepEqual(matchNames('xy', entries), []);
});

test('extractSetCodes erkennt Codes mit Regionen und korrigiert Ziffern', () => {
  assert.deepEqual(extractSetCodes('LOB-DE001'), ['LOB-DE001']);
  assert.deepEqual(extractSetCodes('foo MP19-EN0O7 bar'), ['MP19-EN007']);
  assert.deepEqual(extractSetCodes('SDY - 006'), ['SDY-006']);
  assert.deepEqual(extractSetCodes('LOB-G0I2'), ['LOB-G012']);
});

test('setCodeKey ignoriert die Region', () => {
  assert.equal(setCodeKey('LOB-EN001'), 'LOB-001');
  assert.equal(setCodeKey('LOB-DE001'), 'LOB-001');
  assert.equal(setCodeKey('LOB-G001'), 'LOB-001');
  assert.equal(setCodeKey('SDY-006'), 'SDY-006');
  assert.equal(setCodeKey('kein code'), null);
});

test('extractPasscodes findet 8-stellige Zahlen', () => {
  assert.deepEqual(extractPasscodes('46986414 1996 KAZUKI'), [46986414]);
  assert.deepEqual(extractPasscodes('4698641O'), [46986410]);
  assert.deepEqual(extractPasscodes('123456789'), []);
});

test('YDK hin und zurueck', () => {
  const deck = { main: [1, 1, 2], extra: [3], side: [4] };
  assert.deepEqual(parseYdk(toYdk(deck)), deck);
  assert.deepEqual(parseYdk('#main\r\n10\r\n#extra\r\n!side\r\n11\r\n'), { main: [10], extra: [], side: [11] });
});
