// Semikolon statt Komma, damit Excel mit deutschem Gebietsschema die Spalten trennt.
const SEP = ';';

const cell = (v: string | number) => {
  const s = String(v);
  return /[;,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV mit BOM, damit Excel Umlaute als UTF-8 liest. */
export function toCsv(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map(cell).join(SEP)).join('\r\n') + '\r\n';
}
