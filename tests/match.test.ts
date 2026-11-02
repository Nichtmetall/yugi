import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPasscodes,
  extractSetCodes,
  extractStats,
  findSetCodes,
  levenshtein,
  matchNames,
  normalizeName,
  ocrDistance,
  passcodeDistance,
  printMatch,
  setCodeKey,
  setCodeVariants,
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
  // Nummern mit Buchstaben (echte deutsche Karte "LEDD-DEB01"); B kann auch 8 sein, das klaeren die Varianten.
  assert.deepEqual(extractSetCodes('LEDD-DEB01'), ['LEDD-DE801']);
  assert.deepEqual(extractSetCodes('SGX1-DEA19 SOI-DESE1'), ['SGX1-DEA19', 'SOI-DE5E1']);
  // "DE" als "0E" verlesen
  assert.deepEqual(extractSetCodes('LOB-0E001'), ['LOB-0E001']);
});

test('setCodeKey ignoriert die Region', () => {
  assert.equal(setCodeKey('LOB-EN001'), 'LOB-001');
  assert.equal(setCodeKey('LOB-DE001'), 'LOB-001');
  assert.equal(setCodeKey('LOB-G001'), 'LOB-001');
  assert.equal(setCodeKey('SDY-006'), 'SDY-006');
  assert.equal(setCodeKey('LOB-E001'), 'LOB-001');
  assert.equal(setCodeKey('lob-de001'), 'LOB-001');
  assert.equal(setCodeKey('kein code'), null);
});

test('setCodeKey uebersetzt deutsche Codes mit Buchstaben in der Nummer auf die englischen', () => {
  assert.equal(setCodeKey('LEDD-DEB01'), setCodeKey('LEDD-ENB01'));
  assert.equal(setCodeKey('LEDD-DEB01'), 'LEDD-B01');
  assert.equal(setCodeKey('SOI-DESE1'), setCodeKey('SOI-ENSE1'));
  assert.equal(setCodeKey('IOC-SE1'), 'IOC-SE1');
  assert.equal(setCodeKey('OP13-PT006'), 'OP13-006');
  assert.equal(setCodeKey('LOB-0E001'), 'LOB-001');
  assert.equal(setCodeKey('SR03-ENTKN'), null);
});

test('extractPasscodes findet 8-stellige Zahlen', () => {
  assert.deepEqual(extractPasscodes('46986414 1996 KAZUKI'), [46986414]);
  assert.deepEqual(extractPasscodes('4698641O'), [46986410]);
  assert.deepEqual(extractPasscodes('123456789'), []);
});

test('ocrDistance: typische OCR-Verwechslungen kosten weniger', () => {
  assert.equal(ocrDistance('biue', 'blue', 3), 0.4);
  assert.equal(ocrDistance('retumer', 'returner', 3), 0.5);
  assert.equal(ocrDistance('kitten', 'sitting', 5), 3);
  assert.equal(ocrDistance('abc', 'abcdefghij', 3), 4);
});

test('matchNames: kuerzerer Name verdraengt keinen laengeren, der die ganze Zeile erklaert', () => {
  const list = [
    ...entries,
    { key: normalizeName('Jinzo'), id: 77585513 },
    { key: normalizeName('Jinzo - Returner'), id: 3 },
  ];
  // Frueher gewann hier "Dark Magician" mit 0,97 (nur der Anfang verglichen) und wurde automatisch hinzugefuegt.
  assert.equal(matchNames('Dark Magician Gir1', list)[0].id, 38033121);
  assert.equal(matchNames('Dark Magician Girl 2', list)[0].id, 38033121);
  assert.equal(matchNames('Jinzo - Retumer', list)[0].id, 3);
  // Kurzes Symbol-Rauschen hinter dem Namen bleibt Rauschen.
  assert.equal(matchNames('DARK MAGICIAN 6', list)[0].id, 46986414);
  assert.equal(matchNames('JINZO', list)[0].id, 77585513);
});

test('setCodeVariants tauscht Buchstaben und Ziffern im Set-Kuerzel', () => {
  const v = setCodeVariants('L0B-DE005');
  assert.equal(v[0], 'L0B-DE005');
  assert.ok(v.includes('LOB-DE005'));
  assert.deepEqual(setCodeVariants('kaputt'), ['kaputt']);
});

test('setCodeVariants stellt Buchstaben in der Nummer wieder her', () => {
  assert.ok(setCodeVariants('LEDD-DE801').includes('LEDD-DEB01'));
  assert.ok(setCodeVariants('SGX3-DE016').includes('SGX3-DED16'));
  assert.ok(setCodeVariants('SOI-DE5E1').includes('SOI-DESE1'));
  // Die letzte Stelle ist immer eine Ziffer.
  assert.ok(!setCodeVariants('LOB-DE001').some((v) => /[A-Z]$/.test(v)));
});

test('printMatch findet Drucke auch in verlesenem Text', () => {
  assert.deepEqual(printMatch('L0B-DE0O5', ['SDY-005', 'LOB-EN005']), { index: 1, region: 'DE', dist: 0.4 });
  assert.equal(printMatch('xx LOBDE005 yy', ['LOB-EN005'])?.dist, 0);
  assert.equal(printMatch('LOB-DE006', ['LOB-EN005'])?.dist, 1);
  assert.equal(printMatch('MRD-DE060 1996', ['LOB-EN005']), null);
});

test('findSetCodes liest Set-Codes aus verrauschtem OCR-Text echter Fotos', () => {
  const known = new Set(['SDWD', 'YSYR', 'SBLS', 'MP25', 'LOB', 'LEDD']);
  const find = (t: string) => findSetCodes(t, (p) => known.has(p));
  assert.deepEqual(find('YSYR-DEO14 A 2'), ['YSYR-014']);
  assert.deepEqual(find('YSY R-DEOO4 Z'), ['YSYR-004']); // Leerzeichen im Kuerzel
  assert.deepEqual(find('YSYR-DEO1 1 KE'), ['YSYR-011']); // Leerzeichen in der Nummer
  assert.deepEqual(find('SDWD-DEO026 G'), ['SDWD-026']); // zusaetzliches Zeichen in der Region, nicht SDWD-002
  assert.deepEqual(find('A NN SDWD-DEQ22'), ['SDWD-022']);
  assert.deepEqual(find('NNSDWD-DE022'), ['SDWD-022']); // Rauschen vor dem Kuerzel
  assert.deepEqual(find('SBLS - DEQO1'), ['SBLS-001']);
  assert.deepEqual(find('L0B-G001'), ['LOB-001']);
  assert.deepEqual(find('LEDD-DEB01'), ['LEDD-801']); // setCodeVariants stellt "B01" wieder her
  assert.deepEqual(find('I-EWDM D-MG /EFFEKT 2020SD/SHUEISHATV'), []);
});

test('printMatch findet deutsche Drucke unter den englischen Codes', () => {
  assert.deepEqual(printMatch('LEDD-DEB01', ['LEDD-ENA01', 'LEDD-ENB01']), { index: 1, region: 'DE', dist: 0 });
  assert.equal(printMatch('LEDD-DE801', ['LEDD-ENB01'])?.dist, 0.4);
  assert.equal(printMatch('SOI-DESE1', ['SOI-ENSE1'])?.dist, 0);
  assert.equal(printMatch('LOB-0E005', ['LOB-EN005'])?.dist, 0);
  assert.equal(printMatch('LEDD-DEC01', ['LEDD-ENB01'])?.dist, 1);
  // Gleich gut: der Druck mit der gelesenen Region
  assert.equal(printMatch('LOB-EN005', ['LOB-005', 'LOB-E005', 'LOB-EN005'])?.index, 2);
});

test('passcodeDistance vergleicht unscharf mit einem bekannten Passcode', () => {
  assert.equal(passcodeDistance('469864I4 1996', 46986414), 0);
  assert.equal(passcodeDistance('46986415', 46986414), 1);
  assert.equal(passcodeDistance('04031928', 4031928), 0);
  assert.equal(passcodeDistance('1996 KAZUKI TAKAHASHI', 46986414), 2);
});

test('extractStats liest ATK/DEF auch ohne Leerzeichen und mit Ziffernfehlern', () => {
  // echte Tesseract-Ausgaben aus dem Test mit Kartenbildern
  assert.deepEqual(extractStats('ATK/3000DEF/2800'), { atk: 3000, def: 2800 });
  assert.deepEqual(extractStats('ATK/2000DEF/1700 4'), { atk: 2000, def: 1700 });
  assert.deepEqual(extractStats('BS\n\nATK/ 0 DEF/ 0'), { atk: 0, def: 0 });
  assert.deepEqual(extractStats('ATK/2300LINK-2'), { atk: 2300, def: undefined });
  assert.deepEqual(extractStats('ATK/25OO DEF/21O0'), { atk: 2500, def: 2100 });
  // Abgeschnittene Zweitlesung aus dem ueberlappenden Fussbereich verdraengt die vollstaendige nicht.
  assert.deepEqual(extractStats('ATK/2500 DEF/2100\nATK/25'), { atk: 2500, def: 2100 });
  assert.deepEqual(extractStats('LOB-EN005'), { atk: undefined, def: undefined });
});

test('YDK hin und zurueck', () => {
  const deck = { main: [1, 1, 2], extra: [3], side: [4] };
  assert.deepEqual(parseYdk(toYdk(deck)), deck);
  assert.deepEqual(parseYdk('#main\r\n10\r\n#extra\r\n!side\r\n11\r\n'), { main: [10], extra: [], side: [11] });
});
