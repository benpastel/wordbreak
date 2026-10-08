import fs from 'node:fs';
import path from 'node:path';

// Hand-kept word lists that shape what a bot will play. See the files themselves.

function load(file: string): Set<string> {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'data', file),
    path.join(process.cwd(), 'data', file),
  ];
  const out = new Set<string>();
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (line.startsWith('#')) continue;
    for (const w of line.split(/\s+/)) if (w) out.add(w);
  }
  return out;
}

let familiar: Set<string> | null = null;
let blocked: Set<string> | null = null;

/** A two- or three-letter word ordinary players think of. */
export function isFamiliarShort(word: string): boolean {
  familiar ??= load('bot-short-words.txt');
  return familiar.has(word);
}

/** A word no bot plays. */
export function isBlocked(word: string): boolean {
  blocked ??= load('bot-blocked-words.txt');
  return blocked.has(word);
}
