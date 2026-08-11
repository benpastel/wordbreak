import fs from 'node:fs';
import path from 'node:path';

// ENABLE, filtered to a-z, <=15 letters, no q (there is no Q tile in the bag), plus
// the two one-letter words. The same file is fetched by the client for instant local
// validation — the server stays the authority, the client just avoids a round trip
// per keystroke.
const CANDIDATES = [
  path.join(__dirname, '..', 'client', 'words.txt'), // built: dist/client/words.txt
  path.join(__dirname, '..', '..', 'public', 'words.txt'), // dev: public/words.txt
  path.join(process.cwd(), 'public', 'words.txt'),
];

let words: Set<string> = new Set();

export function loadDictionary(): number {
  for (const p of CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    words = new Set(
      raw
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    );
    return words.size;
  }
  throw new Error(`words.txt not found. Looked in:\n  ${CANDIDATES.join('\n  ')}`);
}

export function isWord(w: string): boolean {
  return words.has(w.toLowerCase());
}
