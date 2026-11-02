import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/lib/csv.ts';

test('toCsv trennt mit Semikolon und beginnt mit BOM', () => {
  assert.equal(toCsv([['Name', 'ID', 'Anzahl'], ['Dunkler Magier', 46986414, 3]]), '﻿Name;ID;Anzahl\r\nDunkler Magier;46986414;3\r\n');
});

test('toCsv quotet Trennzeichen, Anfuehrungszeichen und Umbrueche', () => {
  assert.equal(toCsv([['A;B', 'Say "Hi"', 'x,y', 'a\nb']]), '﻿"A;B";"Say ""Hi""";"x,y";"a\nb"\r\n');
});
