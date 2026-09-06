import fs from 'node:fs';
import path from 'node:path';

// WordNet glosses for the "most obscure" award. Server-side only.
//
// WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
// Princeton University makes no representations or warranties, express or implied.
// See data/README.md for the full licence notice.

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
  // Not fatal: the award simply appears without a definition under it.
  console.warn(`definitions.txt not found; looked in:\n  ${CANDIDATES.join('\n  ')}`);
  return 0;
}

/** Only base lemmas are stored, so inflections are resolved here.
 *  Must stay in step with `bases` in scripts/build-definitions.mjs. */
function bases(w: string): string[] {
  const out: string[] = [];
  if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.endsWith('s')) out.push(w.slice(0, -1));
  if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) out.push(w.slice(0, -3), w.slice(0, -2));
  return out.filter((x) => x.length >= 3);
}

export function define(word: string): string | null {
  const w = word.toLowerCase();
  const direct = glosses.get(w);
  if (direct) return direct;
  for (const b of bases(w)) {
    const g = glosses.get(b);
    if (g) return g;
  }
  return null;
}
