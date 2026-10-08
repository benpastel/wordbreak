// Every word on a board, as paths. The bots know the board this way; what makes them
// human is how slowly, and how selectively, they notice what is here.

import { allWords } from '../dictionary';

let prefixes: Set<string> | null = null;

/** Every proper prefix of every word, built once on first use. */
function prefixSet(): Set<string> {
  if (prefixes) return prefixes;
  prefixes = new Set();
  for (const w of allWords()) for (let i = 1; i < w.length; i++) prefixes.add(w.slice(0, i));
  return prefixes;
}

const neighbourCache = new Map<number, number[][]>();

function neighbours(size: number): number[][] {
  let n = neighbourCache.get(size);
  if (n) return n;
  n = [];
  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((dr || dc) && rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
      }
    }
    n.push(out);
  }
  neighbourCache.set(size, n);
  return n;
}

export interface FoundPath {
  /** Row-major cell indexes, in reading order. */
  idx: number[];
  word: string;
}

/** All paths spelling a word of minLen..maxLen letters. `letters` is row-major. */
export function findPaths(letters: string[], size: number, minLen: number, maxLen: number): FoundPath[] {
  const words = allWords();
  const pre = prefixSet();
  const nb = neighbours(size);
  const lower = letters.map((l) => l.toLowerCase());
  const out: FoundPath[] = [];
  const path: number[] = [];
  const used = new Array<boolean>(lower.length).fill(false);

  const walk = (i: number, s: string) => {
    path.push(i);
    used[i] = true;
    if (s.length >= minLen && words.has(s)) out.push({ idx: [...path], word: s });
    if (s.length < maxLen && pre.has(s)) {
      for (const j of nb[i]) if (!used[j]) walk(j, s + lower[j]);
    }
    used[i] = false;
    path.pop();
  };

  for (let i = 0; i < lower.length; i++) walk(i, lower[i]);
  return out;
}
