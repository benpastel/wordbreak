// Finds words people actually say that our dictionary rejects: candidates for
// data/modern-words.txt.
//
// Two sources, both too large to keep in the repo:
//
//   en_full.txt   OpenSubtitles word counts, from hermitdave/FrequencyWords —
//                 the same corpus as data/word-frequency.txt, unfiltered.
//                 https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
//   wikt.jsonl.gz English Wiktionary, as extracted by wiktextract.
//                 https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
//
// Subtitles say which words are common; Wiktionary says which of them are English
// words at all, rather than names, run-together contractions or typos, and spells
// out their inflections. A word is a candidate when the corpus has seen it often,
// Wiktionary has a lowercase English entry for it, and ENABLE does not.
//
// Abbreviations still working as abbreviations (LOL, IMO) and misspellings are
// dropped. Everything else is kept and tagged — british, vulgar, slang, trademark,
// and so on — for a person to judge. Output is one line per word, most common
// first, with the inflections it would bring along.
//
//   node scripts/mine-words.mjs <en_full.txt> <wikt.jsonl.gz> [out]
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';

const [freqPath, wiktPath, outPath = 'word-candidates.txt'] = process.argv.slice(2);
if (!freqPath || !wiktPath) {
  console.error('usage: node scripts/mine-words.mjs <en_full.txt> <wikt.jsonl.gz> [out]');
  process.exit(1);
}

/** Corpus count below which a word is too rare to be missed. */
const MIN_COUNT = 200;
const PLAYABLE = /^[a-pr-z]{2,15}$/; // a-z, no q, the base list's own bar

const dict = new Set(
  readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
    .split('\n').map((w) => w.trim()).filter(Boolean),
);

const freq = new Map();
for (const line of readFileSync(freqPath, 'utf8').split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  const w = line.slice(0, sp);
  const n = Number(line.slice(sp + 1));
  if (PLAYABLE.test(w) && n >= MIN_COUNT && !dict.has(w)) freq.set(w, n);
}
console.log(`${freq.size} common words missing from the dictionary`);

// --------------------------------------------------------------- read Wiktionary

/** Tags that mean the sense is not a word in its own right. */
const DROP = new Set(['abbreviation', 'initialism', 'acronym', 'misspelling']);
/** Tags worth showing a reviewer, folded to one label each. */
const LABEL = {
  British: 'british', UK: 'british', Commonwealth: 'british', Australia: 'british', 'New-Zealand': 'british',
  vulgar: 'vulgar', offensive: 'vulgar', derogatory: 'vulgar', slur: 'vulgar',
  slang: 'slang', 'Internet': 'slang', colloquial: 'informal', informal: 'informal', childish: 'childish',
  nonstandard: 'nonstandard', 'pronunciation-spelling': 'nonstandard', dialectal: 'dialect',
  archaic: 'archaic', obsolete: 'archaic', dated: 'dated', rare: 'rare',
  clipping: 'clipping',
};
/** Inflection tags whose forms come along with their word. */
const INFLECT = ['plural', 'past', 'participle', 'third-person', 'comparative', 'superlative'];

/** word -> what Wiktionary says about it. Only words we might print are kept. */
const info = new Map();
const entry = (w) => {
  let e = info.get(w);
  if (!e) info.set(w, (e = { pos: new Set(), labels: new Set(), gloss: '', formOf: null, forms: new Set(), kept: false, dropped: new Set() }));
  return e;
};

/** Lines split on \n alone: readline also breaks on \r and \u2028, which turn up
 *  raw inside Wiktionary's quotation text. */
async function* jsonLines(path) {
  let rest = '';
  for await (const chunk of createReadStream(path).pipe(createGunzip()).setEncoding('utf8')) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    yield* parts;
  }
  if (rest) yield rest;
}

/** Words that are also someone's name or a place: the subtitles are counting the
 *  name, so the count says nothing about the word. "sam" is Wiktionary's "to
 *  assemble", and nobody has said it since 1600. */
const names = new Set();
/** Halves of contractions the subtitle tokenizer split: aren from aren't, ll from 'll. */
const fragments = new Set();

let lines = 0;
for await (const line of jsonLines(wiktPath)) {
  if (++lines % 200_000 === 0) console.log(`  ${lines} entries`);
  if (!line) continue;
  const j = JSON.parse(line);
  if (j.lang_code !== 'en') continue;
  const word = j.word;
  const lower = word.toLowerCase();
  // Both apostrophes: Wiktionary titles use the straight one, quotations the curly.
  const frag = /^['’]([a-z]+)$|^([a-z]+)['’]t$/.exec(word);
  if (frag) {
    if (freq.has(frag[1] ?? frag[2])) fragments.add(frag[1] ?? frag[2]);
    continue;
  }
  if (word !== lower) {
    if (freq.has(lower) && j.pos === 'name') names.add(lower);
    continue;
  }
  if (!freq.has(word)) continue;
  const e = entry(word);
  const cats = (j.categories ?? []).map((c) => (typeof c === 'string' ? c : c.name)).join(' ');
  for (const s of j.senses ?? []) {
    const tags = new Set(s.tags ?? []);
    const drop = [...tags].find((t) => DROP.has(t));
    if (drop) {
      e.dropped.add(drop);
      continue;
    }
    if (!s.glosses?.length) continue;
    // "Alternative letter-case form of TV": the word is really the capitalised one.
    const alt = s.alt_of?.[0]?.word;
    if ((alt && alt !== alt.toLowerCase()) || /letter-case form of/.test(s.glosses[0])) {
      e.dropped.add('case variant');
      continue;
    }
    e.kept = true;
    e.pos.add(j.pos);
    for (const t of tags) if (LABEL[t]) e.labels.add(LABEL[t]);
    const gloss = s.glosses.join(' ');
    const scats = (s.categories ?? []).map((c) => (typeof c === 'string' ? c : c.name)).join(' ');
    if (/trademark|brand ?name/i.test(gloss + ' ' + cats + ' ' + scats + ' ' + (j.etymology_text ?? ''))) {
      e.labels.add('trademark');
    }
    if (/British (standard )?spelling|Commonwealth spelling|Britain/i.test(gloss)) e.labels.add('british');
    const of = s.form_of?.[0]?.word;
    if (of && tags.has('form-of')) e.formOf ??= of;
    else if (!e.gloss || (e.formOf && !of)) e.gloss = gloss;
  }
  for (const f of j.forms ?? []) {
    if (PLAYABLE.test(f.form) && !dict.has(f.form) && f.form !== j.word &&
        (f.tags ?? []).some((t) => INFLECT.includes(t))) {
      e.forms.add(f.form);
    }
  }
}

// ---------------------------------------------------------------------- report

const dropCounts = {};
const count = (why) => (dropCounts[why] = (dropCounts[why] ?? 0) + 1);
const rows = [];
/** Names whose lowercase word is labelled slang or the like: a few (karen, stan)
 *  are real, so they are listed apart rather than dropped. */
const nameRows = [];
for (const [w, n] of freq) {
  if (fragments.has(w)) {
    count('contraction fragment');
    continue;
  }
  const e = info.get(w);
  if (!e) {
    dropCounts['no lowercase English entry'] = (dropCounts['no lowercase English entry'] ?? 0) + 1;
    continue;
  }
  if (!e.kept) {
    const why = [...e.dropped].join('/') || 'no senses';
    dropCounts[why] = (dropCounts[why] ?? 0) + 1;
    continue;
  }
  // An inflection whose word is itself a candidate is listed under that word.
  if (e.formOf && !e.gloss && freq.has(e.formOf) && info.get(e.formOf)?.kept) continue;
  if (names.has(w)) {
    if (['slang', 'vulgar', 'informal'].some((l) => e.labels.has(l))) nameRows.push({ w, n, e });
    else count('name');
    continue;
  }
  rows.push({ w, n, e });
}
rows.sort((a, b) => b.n - a.n);
nameRows.sort((a, b) => b.n - a.n);

const fmt = ({ w, n, e }) => {
  const labels = [...e.labels].sort();
  const pos = [...e.pos].join(' ');
  const what = e.gloss || (e.formOf ? `form of ${e.formOf}` : '');
  const forms = [...e.forms].filter((f) => f !== w).sort();
  return [
    w.padEnd(16),
    String(n).padStart(8),
    `  ${pos}${labels.length ? ' · ' + labels.join(' ') : ''}`.padEnd(34),
    `  ${what.length > 90 ? what.slice(0, 89) + '…' : what}`,
    forms.length ? `  +${forms.join(' +')}` : '',
  ].join('');
};

const header = [
  `# Candidates for data/modern-words.txt, mined by scripts/mine-words.mjs.`,
  `# Every word the subtitle corpus has seen at least ${MIN_COUNT} times that has a`,
  `# lowercase English Wiktionary entry and is missing from public/words.txt, most`,
  `# common first. Columns: word, corpus count, part of speech · labels, the first`,
  `# definition, and the inflections it would bring (+form).`,
  `#`,
  `# Not listed: ${Object.entries(dropCounts).map(([k, v]) => `${v} ${k}`).join(', ')}.`,
  ``,
];
const names_ = [
  ``,
  `# Also a common name, so the count above is mostly the name. Listed only where the`,
  `# lowercase word is labelled slang, vulgar or informal.`,
  ``,
];
writeFileSync(outPath, header.concat(rows.map(fmt), names_, nameRows.map(fmt)).join('\n') + '\n');
console.log(`wrote ${rows.length} candidates and ${nameRows.length} names to ${outPath}`);
console.log(dropCounts);
