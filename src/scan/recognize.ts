import type { Card, CardSet } from '../types';
import { cardsBySetCode, getCard, getNameEntries, isSetPrefix } from '../db/cardDb';
import {
  extractPasscodes,
  extractSetCodes,
  extractStats,
  findSetCodes,
  matchNames,
  nameScore,
  normalizeName,
  passcodeDistance,
  printMatch,
  setCodeKey,
  setCodeVariants,
  type NameHit,
  type Stats,
} from './match';
import { FRAME_GROUPS, frameGroup } from './image';
import type { OcrResult } from './ocr';

export interface Candidate {
  card: Card;
  /** 0..1, ab SURE_SCORE gilt der Treffer als sicher. */
  score: number;
  /** Log-Odds hinter `score` (ohne den Bonus fuer wiederholte Lesungen); der Abstand zum Zweitbesten entscheidet mit. */
  logit: number;
  imageId: number;
  /** Erkannter Druck als englischer Set-Code der Datenbank (ein gescanntes "LOB-DE001" wird zu "LOB-EN001"). */
  setCode?: string;
  prints: CardSet[];
  reasons: string[];
  /** Neben dem Namen durch Set-Code, Passcode oder ATK und DEF belegt. */
  corroborated: boolean;
  /** In wie vielen Lesungen der Name klar auf diese Karte zeigte. */
  nameVotes: number;
  /** Allein durch den Set-Code belegt (Name unlesbar oder nur deutsch ohne deutsche Texte in der Datenbank). */
  codeOnly: boolean;
  /** In wie vielen Lesungen der Set-Code exakt passte. */
  codeVotes: number;
  /** Gelesene ATK/DEF oder ein gelesener Passcode passen nicht zu dieser Karte. */
  contradicted: boolean;
}

export const SURE_SCORE = 0.88;
/** Mindestabstand (Log-Odds) zum zweitbesten Treffer, damit ein Treffer als sicher gilt. */
const MARGIN = 1;

/** Was eine einzelne Lesung ueber die Karte im Rahmen aussagt. */
export interface Observation {
  /** Normalisierte Namenszeile. */
  q: string;
  nameConf: number;
  hits: NameHit[];
  codes: string;
  /** Gelesene Set-Codes inkl. Buchstabe/Ziffer-Varianten. */
  setCodes: string[];
  passcodes: number[];
  stats: Stats;
  frame: number[];
}

export function observe(ocr: OcrResult): Observation {
  return {
    q: normalizeName(ocr.name),
    nameConf: ocr.nameConf,
    hits: matchNames(ocr.name, getNameEntries(), 8),
    codes: ocr.codes,
    setCodes: [...new Set([...extractSetCodes(ocr.codes), ...findSetCodes(ocr.codes, isSetPrefix)].flatMap(setCodeVariants))],
    passcodes: extractPasscodes(ocr.codes),
    stats: extractStats(ocr.codes),
    frame: ocr.frame,
  };
}

/** Staerke eines Merkmals ueber alle Lesungen: -1 widerspricht, 0 nichts, 1 unscharf, 2 eindeutig. */
type Level = -1 | 0 | 1 | 2;
const merge = (acc: Level, l: Level): Level => (l > 0 || acc > 0 ? (Math.max(acc, l) as Level) : (Math.min(acc, l) as Level));

// Beitraege zu den Log-Odds, Index = Level + 1. Die Codes zaehlen zuerst: Ein exakt gelesener Set-Code oder Passcode
// reicht allein fuer einen sicheren Treffer (der Set-Code nach einer zweiten Lesung, siehe verdict), auch wenn der Name
// unlesbar ist oder nur deutsch vorliegt. Ein Set-Code kann aber eine verlesene Ziffer sein (LOB-005 statt LOB-006);
// widerspricht der Name klar, bleibt es deshalb unsicher.
// ATK/DEF teilen sich viele Karten.
const CODE_WEIGHT = [-1.5, 0, 1.5, 4.5];
const PASS_WEIGHT = [-1.5, 0, 2, 4.5];
const STATS_WEIGHT = [-1, 0, 0.8, 2];
/** Klar gelesener Name einer anderen Karte. */
const CONFLICT_WEIGHT = -2.5;
/**
 * Jede weitere Lesung, deren Name klar auf diese Karte zeigt (hoechstens zwei): Ein Name mit ein, zwei Lesefehlern
 * bliebe sonst auch nach vielen uebereinstimmenden Lesungen unter SURE_SCORE. Nur fuer `score`, nicht fuer den Abstand
 * zum Zweitbesten: Liest die Texterkennung einen fast gleichnamigen Namen immer gleich falsch, bleibt es unsicher.
 */
const VOTE_WEIGHT = 0.6;

/**
 * Rahmenfarbe: passende Gruppe leicht belohnen, abweichende nur leicht bestrafen. Auf Fotos unter Raumlicht liegt die
 * Farbe oft daneben (Zauberkarten wirken weisslich wie Synchro); sie darf einen gelesenen Code nicht ueberstimmen.
 */
function typeTerm(frame: number[], group: number): number {
  const top = Math.max(...frame);
  const p = frame[group];
  return (p === top && top >= 0.5 ? 0.5 : 0) + Math.max(-0.5, Math.log(p / top || 1e-9));
}

function statsLevel(s: Stats, card: Card): Level {
  if (s.atk === undefined && s.def === undefined) return 0;
  if (card.frameType === 'spell' || card.frameType === 'trap') return -1; // dort steht kein ATK
  let hit = 0;
  let miss = 0;
  for (const [read, real] of [
    [s.atk, card.atk],
    [s.def, card.def],
  ]) {
    if (read === undefined || real === undefined || real < 0) continue;
    if (read === real) hit++;
    else miss++;
  }
  if (miss) return hit ? 0 : -1;
  return hit === 2 ? 2 : hit === 1 ? 1 : 0;
}

function evaluate(card: Card, obs: Observation[]): Candidate {
  const keys = [card.name, card.nameDe].filter((n): n is string => !!n).map(normalizeName);
  const group = frameGroup(card.frameType);
  const groupIndex = group ? FRAME_GROUPS.indexOf(group) : -1;
  const codes = card.sets.map((s) => s.code);
  const reasons = new Set<string>();

  let name = 0;
  let nameVotes = 0;
  let codeVotes = 0;
  let nameConflict = false;
  let code: Level = 0;
  let pass: Level = 0;
  let stats: Level = 0;
  let type = groupIndex < 0 ? 0 : -Infinity;
  let print: CardSet | undefined;
  let imageId = card.imageIds[0];

  for (const o of obs) {
    const hit = o.hits.find((h) => h.id === card.id);
    const s = hit?.score ?? Math.max(0, ...keys.map((k) => nameScore(o.q, k)));
    name = Math.max(name, s);
    const top = o.hits[0];
    if (top?.id === card.id && s >= 0.85) nameVotes++;
    // Klar gelesener Name einer anderen Karte spricht gegen diese, auch bei aehnlichen Namen ("Prank-Kids Lampsies"
    // gegen "Prank-Kids Dropsies" mit benachbartem Set-Code).
    else if (top && top.score >= 0.9 && o.nameConf >= 60 && s <= top.score - 0.15) nameConflict = true;

    // Ein gelesener Set-Code dieser Karte zaehlt als exakt; sonst unscharf im Text suchen.
    const read = new Set(o.setCodes.map(setCodeKey));
    const exact = card.sets.findIndex((s) => read.has(setCodeKey(s.code)));
    const pm = exact >= 0 ? { index: exact, dist: 0 } : printMatch(o.codes, codes);
    if (pm) {
      const l: Level = pm.dist < 0.5 ? 2 : 1;
      if (l === 2) codeVotes++;
      if (l > code || !print) print = card.sets[pm.index];
      code = merge(code, l);
    } else if (o.setCodes.some((c) => cardsBySetCode(c).length > 0)) code = merge(code, -1);

    const pd = Math.min(...[card.id, ...card.imageIds].map((id) => passcodeDistance(o.codes, id)));
    if (pd < 2) {
      pass = merge(pass, pd === 0 ? 2 : 1);
      const exact = o.passcodes.find((p) => card.imageIds.includes(p));
      if (exact) imageId = exact;
    } else if (o.passcodes.some((p) => getCard(p))) pass = merge(pass, -1);

    stats = merge(stats, statsLevel(o.stats, card));
    if (groupIndex >= 0) type = Math.max(type, typeTerm(o.frame, groupIndex));
  }

  // Ein schwach aehnlicher Name zaehlt nie schlechter als ein unlesbarer; nur ein klar anderer Name spricht dagegen.
  let logit = Math.max(12 * (name - 0.8), -1.5) + (nameConflict ? CONFLICT_WEIGHT : 0);
  logit += CODE_WEIGHT[code + 1] + PASS_WEIGHT[pass + 1] + STATS_WEIGHT[stats + 1] + type;

  // Gespeichert wird der englische Code der Datenbank: Nur dazu gibt es Set-Namen, Seltenheiten und Preise.
  const dbCode = print?.code;
  if (name > 0.5) reasons.add('Name');
  if (code > 0 && dbCode) reasons.add(code === 2 ? `Set-Code ${dbCode}` : 'Set-Code ähnlich');
  if (pass > 0) reasons.add('Passcode');
  if (stats > 0) reasons.add('ATK/DEF');
  if (type > 0) reasons.add('Kartentyp');

  // Nur ein sauber gelesener Code legt den Druck fest; ein unscharfer passt oft zu einem anderen Set.
  const key = dbCode && code === 2 ? setCodeKey(dbCode) : null;
  return {
    card,
    score: 1 / (1 + Math.exp(-(logit + VOTE_WEIGHT * Math.min(2, Math.max(0, nameVotes - 1))))),
    logit,
    imageId,
    setCode: key ? dbCode : undefined,
    prints: key ? card.sets.filter((s) => setCodeKey(s.code) === key) : [],
    reasons: [...reasons],
    corroborated: code > 0 || pass > 0 || stats === 2,
    nameVotes,
    codeOnly: code > 0 && pass <= 0 && stats < 2 && nameVotes === 0,
    codeVotes,
    contradicted: stats < 0 || pass < 0,
  };
}

/** Alle Lesungen derselben Karte gemeinsam auswerten: je Merkmal zaehlt die beste Lesung. */
export function rankCandidates(obs: Observation[]): Candidate[] {
  const cards = new Map<number, Card>();
  const take = (c: Card | undefined) => c && cards.set(c.id, c);
  for (const o of obs) {
    for (const p of o.passcodes) take(getCard(p));
    for (const c of o.setCodes) cardsBySetCode(c).forEach(take);
    for (const h of o.hits) take(getCard(h.id));
  }
  return [...cards.values()]
    .map((c) => evaluate(c, obs))
    .sort((a, b) => b.logit - a.logit)
    .slice(0, 6);
}

/**
 * sure: direkt uebernehmen. confirm: sicher, aber nur ueber den Namen oder nur ueber den Set-Code belegt, eine weitere
 * Lesung soll ihn bestaetigen (eine verlesene Ziffer ergibt oft den gueltigen Code einer anderen Karte). unsure: Auswahl
 * anzeigen.
 */
export type Verdict = 'sure' | 'confirm' | 'unsure';

export function verdict(ranked: Candidate[]): Verdict {
  const [best, second] = ranked;
  if (!best || best.score < SURE_SCORE || (second && best.logit - second.logit < MARGIN)) return 'unsure';
  // Widersprechen dabei ATK/DEF oder Passcode, ist eine verlesene Ziffer wahrscheinlicher als die Karte.
  if (best.codeOnly) return best.contradicted ? 'unsure' : best.codeVotes >= 2 ? 'sure' : 'confirm';
  return best.corroborated || best.nameVotes >= 2 ? 'sure' : 'confirm';
}
