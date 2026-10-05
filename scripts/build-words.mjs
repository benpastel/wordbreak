// Merges data/modern-words.txt into public/words.txt.
//
// The base list is ENABLE, which was last revised in 1999 and so has never heard
// of SELFIE, PODCAST or BITCOIN. Rather than swap lists — the free alternatives
// are all *older* or *more obscure*, not more current — we keep ENABLE and layer
// a hand-curated patch on top. See data/modern-words.txt for what goes in it.
//
// Idempotent: re-running after an edit adds only what is new. The patch file is
// the record of what we changed, so public/words.txt stays regenerable from
// ENABLE plus one reviewable diff.
//
// Additions must clear the same bar as the base list — a-z only, 15 letters or
// fewer, no Q, since there is no Q tile in the bag. A violation is a hard error
// rather than a silent drop, so nothing is quietly lost from the patch.
//
//   node scripts/build-words.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const WORDS = new URL('../public/words.txt', import.meta.url);
const PATCH = new URL('../data/modern-words.txt', import.meta.url);
const MAX_LEN = 15;

const dict = new Set(
  readFileSync(WORDS, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean),
);
const before = dict.size;

const patch = readFileSync(PATCH, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const bad = patch.filter((w) => !/^[a-z]+$/.test(w) || w.length > MAX_LEN || w.includes('q'));
if (bad.length) {
  console.error(`${PATCH.pathname} has ${bad.length} unplayable entries:`);
  for (const w of bad) console.error(`  ${w}`);
  process.exit(1);
}

const added = patch.filter((w) => !dict.has(w));
for (const w of added) dict.add(w);

// C locale, matching the ENABLE original, so the diff stays minimal.
const sorted = [...dict].sort();
writeFileSync(WORDS, sorted.join('\n') + '\n');

console.log(`patch: ${patch.length} words, ${added.length} new, ${patch.length - added.length} already present`);
console.log(`dictionary: ${before} -> ${sorted.length}`);
