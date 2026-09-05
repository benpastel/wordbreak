import fs from 'node:fs';
import path from 'node:path';

// Corpus rank for the "most obscure" award. Server-side only — the browser never
// needs it, because the write-up is computed here.
const CANDIDATES = [
  path.join(__dirname, '..', '..', 'data', 'word-frequency.txt'),
  path.join(process.cwd(), 'data', 'word-frequency.txt'),
];

let ranks = new Map<string, number>();

export function loadFrequencies(): number {
  for (const p of CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    ranks = new Map();
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const w = lines[i].trim();
      if (w) ranks.set(w, ranks.size);
    }
    return ranks.size;
  }
  // Not fatal: without it the obscure award simply falls back to letter rarity.
  console.warn(`word-frequency.txt not found; looked in:\n  ${CANDIDATES.join('\n  ')}`);
  return 0;
}

/** Position in the corpus, most common first. Null means rarer than everything in it. */
export function corpusRank(word: string): number | null {
  const r = ranks.get(word.toLowerCase());
  return r === undefined ? null : r;
}
