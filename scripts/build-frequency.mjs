// Rebuilds data/word-frequency.txt.
//
// Source: OpenSubtitles word frequencies from hermitdave/FrequencyWords, which is
// conversational English rather than news or books. That matters here: the award it
// feeds asks "would an ordinary person know this word", and film dialogue answers
// that far better than a news corpus, which has never heard of ZEPHYR or AARDVARK
// but is fluent in quarterly earnings.
//
// The output is every word of our own dictionary that the corpus has seen at least
// MIN_COUNT times, ordered most common first. Rank is the line number; a word absent
// from the file is rarer than anything in it.
//
//   node scripts/build-frequency.mjs
import { writeFileSync, readFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt';
const MIN_COUNT = 3; // drops one-off subtitle typos and OCR debris

const dict = new Set(
  readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
    .split('\n').map((w) => w.trim()).filter(Boolean),
);

console.log(`fetching ${SRC}`);
const raw = await (await fetch(SRC)).text();

const rows = [];
for (const line of raw.split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  const word = line.slice(0, sp).toLowerCase();
  const count = Number(line.slice(sp + 1));
  if (!/^[a-z]+$/.test(word) || !dict.has(word) || !(count >= MIN_COUNT)) continue;
  rows.push([word, count]);
}
rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const out = new URL('../data/word-frequency.txt', import.meta.url);
writeFileSync(out, rows.map(([w]) => w).join('\n') + '\n');
console.log(`wrote ${rows.length} words (${(rows.length / dict.size * 100).toFixed(1)}% of the dictionary)`);
