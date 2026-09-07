// Rebuilds data/definitions.txt.
//
// Two sources, in order of preference:
//   Princeton WordNet 3.0 — modern, concise, but only reaches about two thirds of a
//     Scrabble dictionary; it has never heard of XEBEC or CROCEIN.
//   Webster's Unabridged (1913) — public domain, and strongest on exactly the
//     archaic and technical vocabulary WordNet lacks, which is also exactly what
//     wins the "most obscure" award.
//
// Only base lemmas are stored; inflections are resolved at lookup time by `bases`,
// which is duplicated verbatim in src/server/definitions.ts and must stay in step.
// Any word the runtime rules cannot reach on their own — irregular plurals and past
// tenses, which WordNet keeps in separate exception lists — is written out in full,
// so runtime coverage always equals build-time coverage.
//
//   node scripts/build-definitions.mjs
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORDNET = 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz';
const WEBSTER = 'https://raw.githubusercontent.com/ssvivian/WebstersDictionary/master/dictionary.json';
const POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };
const ORDER = ['n', 'v', 'a', 'r'];
const MAX_LEN = 120;
const ROUNDS = 2;

const NOTICE = `# Definitions for WordBreak. Generated — do not edit by hand.
#
# WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
# Princeton University makes no representations or warranties, express or implied.
#
# Remaining entries are from Webster's Unabridged Dictionary (1913), which is in
# the public domain, via github.com/ssvivian/WebstersDictionary (MIT).
#
# See data/README.md for full notices. Rebuild with:
#   node scripts/build-definitions.mjs
`;

/** Suffix stripping shared with the server. Negating affixes are deliberately absent:
 *  showing the definition of HOPE under HOPELESS would be worse than showing none. */
const PREFIXES = ['re', 'over', 'under', 'pre', 'co', 'sub', 'semi', 'counter',
  'inter', 'super', 'out', 'post', 'multi'];
function bases(w) {
  const o = [];
  if (w.endsWith('ies')) o.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) o.push(w.slice(0, -2));
  if (w.endsWith('s')) o.push(w.slice(0, -1));
  if (w.endsWith('ed')) o.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) o.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er')) o.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) o.push(w.slice(0, -3), w.slice(0, -2));
  for (const [s, r] of [['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'],
    ['shes', 'sh'], ['men', 'man'], ['ves', 'f'], ['ves', 'fe'], ['ier', 'y'],
    ['iest', 'y'], ['ied', 'y'], ['ily', 'y'], ['iness', 'y']]) {
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

/** Cross-references rather than definitions. */
const STUB = /^(pl|sing|imp|p\. ?p|p\. ?pr|obs|alt|var|fem|masc)\.? +of\b|^(see\b|same as\b|of\b|a?n? ?(form|variant|spelling|contraction) of\b)/i;

const trim = (d) => {
  let s = d.replace(/\[[^\]]*\]/g, ' ')          // [Obs.], [Colloq.]
    .replace(/Etym:.*/i, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[-–—;,.\s]+/, '').replace(/[;,\s]+$/, '');
  s = s.replace(/(?<=\.)\s+(?:[A-Z][A-Za-z']*\.?\s*){1,4}$/, '').trim();
  if (s.length > MAX_LEN) {
    const cut = s.slice(0, MAX_LEN);
    const sp = cut.lastIndexOf(' ');
    s = (sp > 60 ? cut.slice(0, sp) : cut) + '…';
  }
  return s;
};

// ---------------------------------------------------------------- WordNet
const dir = mkdtempSync(join(tmpdir(), 'wordnet-'));
console.log(`fetching ${WORDNET}`);
writeFileSync(join(dir, 'wn.tgz'), Buffer.from(await (await fetch(WORDNET)).arrayBuffer()));
execFileSync('tar', ['xzf', join(dir, 'wn.tgz'), '-C', dir]);
const db = join(dir, 'WordNet-3.0', 'dict');
if (!existsSync(join(db, 'data.noun'))) throw new Error(`unexpected archive layout in ${dir}`);

const gloss = {};
const senses = {};
const exc = new Map();
for (const [file, pos] of Object.entries(POS)) {
  gloss[pos] = {};
  for (const line of readFileSync(join(db, `data.${file}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const bar = line.indexOf(' | ');
    if (bar < 0) continue;
    gloss[pos][line.slice(0, line.indexOf(' '))] = trim(line.slice(bar + 3).split(/;\s*"/)[0]);
  }
  for (const line of readFileSync(join(db, `index.${file}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const t = line.split(' ');
    if (/^[a-z]+$/.test(t[0])) (senses[t[0]] ||= {})[pos] = t[6 + Number(t[3])];
  }
  for (const line of readFileSync(join(db, `${file}.exc`), 'latin1').split('\n')) {
    const p = line.trim().split(' ');
    if (p.length >= 2 && !exc.has(p[0])) exc.set(p[0], p[1]);
  }
}
const fromWordNet = (w) => {
  const s = senses[w];
  if (!s) return null;
  for (const p of ORDER) if (s[p] && gloss[p][s[p]]) return gloss[p][s[p]];
  return null;
};

// ---------------------------------------------------------------- Webster
console.log(`fetching ${WEBSTER}`);
const webster = new Map();
for (const e of JSON.parse(await (await fetch(WEBSTER)).text())) {
  const w = String(e.word || '').toLowerCase();
  if (!/^[a-z]+$/.test(w) || webster.has(w)) continue;
  const d = trim(String((e.definitions || [])[0] || ''));
  // Webster is full of cross-reference stubs — "pl. of Wolf.", "imp. of Drink." —
  // which say nothing. Dropping them lets the word fall through to its base, where
  // there is an actual definition waiting.
  if (d.length >= 12 && !STUB.test(d)) webster.set(w, d);
}
console.log(`  wordnet lemmas: ${Object.keys(senses).length}, webster headwords: ${webster.size}`);

const define = (w) => fromWordNet(w) ?? webster.get(w) ?? null;

// ------------------------------------------------------- resolve every word
const dict = readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
  .split('\n').map((w) => w.trim()).filter(Boolean);

/** Walk outwards, preferring the fewest transformations, and allow the irregular
 *  lists as a step the runtime cannot take on its own. */
const resolve = (word) => {
  let seen = new Set([word]);
  let cur = [word];
  for (let r = 0; r <= ROUNDS; r++) {
    // WordNet first, including through its irregular lists, before Webster. DRANK is
    // the past tense of DRINK long before it is Webster's word for darnel grass.
    for (const x of cur) {
      const d = fromWordNet(x);
      if (d) return [x, d];
      const e = exc.get(x);
      if (e) {
        const ed = fromWordNet(e);
        if (ed) return [e, ed];
      }
    }
    for (const x of cur) {
      const d = webster.get(x);
      if (d) return [x, d];
      const e = exc.get(x);
      if (e) {
        const ed = webster.get(e);
        if (ed) return [e, ed];
      }
    }
    const next = [];
    for (const x of cur) for (const b of bases(x)) if (!seen.has(b)) { seen.add(b); next.push(b); }
    cur = next;
    if (!cur.length) break;
  }
  return null;
};

const found = new Map(); // word -> [lemma, definition]
for (const w of dict) {
  const hit = resolve(w);
  if (hit) found.set(w, hit);
}

const store = new Map();
for (const [, [lemma, def]] of found) store.set(lemma, def);

/** Can the server get from `word` to something in `store` using only `bases`? */
const runtimeReaches = (word) => {
  let seen = new Set([word]);
  let cur = [word];
  for (let r = 0; r <= ROUNDS; r++) {
    for (const x of cur) if (store.has(x)) return true;
    const next = [];
    for (const x of cur) for (const b of bases(x)) if (!seen.has(b)) { seen.add(b); next.push(b); }
    cur = next;
    if (!cur.length) break;
  }
  return false;
};

let inlined = 0;
for (const [w, [, def]] of found) {
  if (runtimeReaches(w)) continue;
  store.set(w, def); // irregular: keep its own copy
  inlined++;
}

const lines = [...store.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([w, d]) => `${w}\t${d}`);
writeFileSync(new URL('../data/definitions.txt', import.meta.url), NOTICE + lines.join('\n') + '\n');
console.log(`wrote ${lines.length} entries (${inlined} irregular forms kept in full)`);
console.log(`${found.size} of ${dict.length} playable words can be defined ` +
  `(${(found.size / dict.length * 100).toFixed(1)}%)`);
