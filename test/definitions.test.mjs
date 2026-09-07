// Definition lookup: the server must reach everything the build script claimed,
// using only its own copy of the suffix rules.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { section, check, done } from './harness.mjs';
const require = createRequire(import.meta.url);
const { loadDefinitions, define } = require('../dist/server/definitions.js');

const stored = loadDefinitions();
const dict = readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
  .split('\n').map((w) => w.trim()).filter(Boolean);

section('the file loads');
check('entries were read', stored > 60_000, String(stored));

section('inflections resolve without their own entry');
for (const [word, expect] of [
  ['cat', /feline|mammal/i],
  ['cats', /feline|mammal/i],
  ['dripped', /drop|drip/i],
  ['stingiest', /spend|mean|stingy/i],
  ['allotters', /allot/i],
  ['boxes', /./],
  ['wolves', /./],
]) {
  const d = define(word);
  check(`${word} resolves`, !!d && expect.test(d), d ? d.slice(0, 60) : 'no definition');
}

section('irregular forms are kept in full, since the rules cannot derive them');
for (const w of ['aardwolves', 'geese', 'children']) {
  const d = define(w);
  check(`${w} resolves`, !!d, d ? d.slice(0, 60) : 'no definition');
}

section('words WordNet does not have come from Webster');
for (const w of ['xebec', 'crocein', 'puckery']) {
  const d = define(w);
  check(`${w} resolves`, !!d, d ? d.slice(0, 60) : 'no definition');
}

section('negating affixes are never stripped');
check('hopeless does not borrow the definition of hope',
  !/a specific feeling|expect with confidence/i.test(define('hopeless') ?? ''),
  define('hopeless')?.slice(0, 60));
check('nothing is invented for a non-word', define('zzzzqqx') === null);

section('coverage');
{
  let n = 0;
  for (const w of dict) if (define(w)) n++;
  const pct = (n / dict.length) * 100;
  check('at least 80% of playable words can be defined', pct >= 80,
    `${n} of ${dict.length} (${pct.toFixed(1)}%)`);
}

done();
