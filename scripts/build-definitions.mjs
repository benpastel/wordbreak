// Rebuilds data/definitions.txt from Princeton WordNet 3.0.
//
// Only base lemmas are stored. Inflected forms are resolved at lookup time by the
// same suffix rules used here, which halves the file for identical coverage —
// CATS does not need its own copy of the definition of CAT.
//
//   node scripts/build-definitions.mjs
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz';
const POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };
const ORDER = ['n', 'v', 'a', 'r']; // a noun sense reads best when a word has several
const MAX_LEN = 120;

const NOTICE = `# Definitions from Princeton WordNet 3.0.
#
# WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
#
# Princeton University makes no representations or warranties, express or implied.
# See data/README.md for the full licence notice. Rebuild with
# node scripts/build-definitions.mjs
`;

const dir = mkdtempSync(join(tmpdir(), 'wordnet-'));
console.log(`fetching ${SRC}`);
const tgz = join(dir, 'wn.tar.gz');
writeFileSync(tgz, Buffer.from(await (await fetch(SRC)).arrayBuffer()));
execFileSync('tar', ['xzf', tgz, '-C', dir]);
const db = join(dir, 'dict');
if (!existsSync(join(db, 'data.noun'))) throw new Error(`unexpected archive layout in ${dir}`);

/** Definition only: WordNet appends quoted usage examples we have no room for. */
const clean = (raw) => {
  let d = raw.split(/;\s*"/)[0].replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
  if (d.length > MAX_LEN) {
    const cut = d.slice(0, MAX_LEN);
    const sp = cut.lastIndexOf(' ');
    d = (sp > 60 ? cut.slice(0, sp) : cut) + '…';
  }
  return d;
};

const gloss = {};
const senses = {};
for (const [file, pos] of Object.entries(POS)) {
  gloss[pos] = {};
  for (const line of readFileSync(join(db, `data.${file}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue; // the licence header
    const bar = line.indexOf(' | ');
    if (bar < 0) continue;
    gloss[pos][line.slice(0, line.indexOf(' '))] = clean(line.slice(bar + 3));
  }
  for (const line of readFileSync(join(db, `index.${file}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const t = line.split(' ');
    if (!/^[a-z]+$/.test(t[0])) continue;
    // lemma pos synset_cnt p_cnt [ptrs...] sense_cnt tagsense_cnt offset...
    (senses[t[0]] ||= {})[pos] = t[6 + Number(t[3])];
  }
}

const define = (w) => {
  const s = senses[w];
  if (!s) return null;
  for (const p of ORDER) if (s[p] && gloss[p][s[p]]) return gloss[p][s[p]];
  return null;
};

/** Must stay in step with the same function on the server. */
const bases = (w) => {
  const out = [];
  if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.endsWith('s')) out.push(w.slice(0, -1));
  if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) out.push(w.slice(0, -3), w.slice(0, -2));
  return out.filter((x) => x.length >= 3);
};

const dict = readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
  .split('\n').map((w) => w.trim()).filter(Boolean);

// Keep a lemma only if some playable word can actually reach it.
const keep = new Set();
for (const w of dict) {
  if (define(w)) keep.add(w);
  else for (const b of bases(w)) if (define(b)) { keep.add(b); break; }
}

const lines = [...keep].sort().map((w) => `${w}\t${define(w)}`);
writeFileSync(new URL('../data/definitions.txt', import.meta.url), NOTICE + lines.join('\n') + '\n');

let reachable = 0;
for (const w of dict) {
  if (keep.has(w)) { reachable++; continue; }
  if (bases(w).some((b) => keep.has(b))) reachable++;
}
console.log(`wrote ${lines.length} lemmas; ${reachable} of ${dict.length} playable words ` +
  `(${(reachable / dict.length * 100).toFixed(1)}%) can be defined`);
