import fs from 'node:fs';
import path from 'node:path';

// Definitions shown on the end-of-match timeline. Server-side only.
//
// WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
// Princeton University makes no representations or warranties, express or implied.
// Remaining entries are Webster's Unabridged (1913), public domain.
// See data/README.md for the full licence notices.

const CANDIDATES = [
  path.join(__dirname, '..', '..', 'data', 'definitions.txt'),
  path.join(process.cwd(), 'data', 'definitions.txt'),
];

let glosses = new Map<string, string>();

export function loadDefinitions(): number {
  for (const p of CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    glosses = new Map();
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const tab = line.indexOf('\t');
      if (tab > 0) glosses.set(line.slice(0, tab), line.slice(tab + 1));
    }
    return glosses.size;
  }
  // Not fatal: the timeline simply shows words without definitions.
  console.warn(`definitions.txt not found; looked in:\n  ${CANDIDATES.join('\n  ')}`);
  return 0;
}

/**
 * Suffix stripping, duplicated verbatim from scripts/build-definitions.mjs — the two
 * must stay in step, and the build script verifies every word it claims coverage for
 * is reachable by exactly these rules.
 *
 * Negating affixes are deliberately absent: showing the definition of HOPE under
 * HOPELESS, or COMPILE under UNCOMPILED, would be worse than showing nothing.
 */
const PREFIXES = ['re', 'over', 'under', 'pre', 'co', 'sub', 'semi', 'counter',
  'inter', 'super', 'out', 'post', 'multi'];

function bases(w: string): string[] {
  const o: string[] = [];
  if (w.endsWith('ies')) o.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) o.push(w.slice(0, -2));
  if (w.endsWith('s')) o.push(w.slice(0, -1));
  if (w.endsWith('ed')) o.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) o.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er')) o.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) o.push(w.slice(0, -3), w.slice(0, -2));
  for (const [s, r] of [['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'],
    ['shes', 'sh'], ['men', 'man'], ['ves', 'f'], ['ves', 'fe'], ['ier', 'y'],
    ['iest', 'y'], ['ied', 'y'], ['ily', 'y'], ['iness', 'y']] as const) {
    if (w.endsWith(s)) o.push(w.slice(0, -s.length) + r);
  }
  // doubled final consonant: DRIPPED -> DRIP, ALLOTTERS -> ALLOT
  for (const s of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(s)) continue;
    const b = w.slice(0, -s.length);
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) o.push(b.slice(0, -1));
  }
  for (const s of ['ly', 'ness', 'ish', 'like', 'ful', 'able', 'ably']) {
    if (w.endsWith(s)) o.push(w.slice(0, -s.length));
  }
  if (w.endsWith('ically')) o.push(w.slice(0, -6) + 'ic');
  if (w.endsWith('ally')) o.push(w.slice(0, -4), w.slice(0, -4) + 'al');
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 4) o.push(w.slice(p.length));
  }
  return o.filter((x) => x.length >= 3);
}

const ROUNDS = 2;

export function define(word: string): string | null {
  const start = word.toLowerCase();
  const seen = new Set([start]);
  let cur = [start];
  for (let r = 0; r <= ROUNDS; r++) {
    for (const w of cur) {
      const g = glosses.get(w);
      if (g) return g;
    }
    const next: string[] = [];
    for (const w of cur) for (const b of bases(w)) if (!seen.has(b)) { seen.add(b); next.push(b); }
    cur = next;
    if (cur.length === 0) break;
  }
  return null;
}
