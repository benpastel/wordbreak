// The words nobody played: what the scout keeps, and what it strikes off.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
const require = createRequire(import.meta.url);
const { Scout } = require('../dist/server/missed.js');
require('../dist/server/dictionary.js').loadDictionary();
require('../dist/server/frequency.js').loadFrequencies();

//   S T O P
//   A R E N
//   L I D E
//   X Q Z K
const grid = (letters) => letters.split('').map((letter, i) => ({ id: i + 1, letter }));
const game = (claims = []) => ({ size: 4, grid: grid('STOPARENLIDEXQZK'), claims, endsAt: null });
const word = (idx) => idx.map((i) => 'STOPARENLIDEXQZK'[i]).join('').toLowerCase();
const claim = (id, playerId, idx) => ({
  id, playerId, tileIds: idx.map((i) => i + 1), word: word(idx), claimedAt: 0, banksAt: 10_000,
});

section('one of each kind');
{
  const s = new Scout();
  // TO and ARE held, so anything longer through both breaks two.
  s.look(game([claim('a', 'p1', [1, 2]), claim('b', 'p2', [4, 5, 6])]), 5_000);
  const r = s.result();
  const by = Object.fromEntries(r.map((m) => [m.kind, m]));
  check('all three kinds found', ['longest', 'biggest', 'easiest'].every((k) => by[k]), JSON.stringify(r.map((m) => [m.kind, m.word])));
  check('each is spelt by its path', r.every((m) => word(m.idx) === m.word));
  check('no word is used twice', new Set(r.map((m) => m.word)).size === r.length);
  check('the biggest break breaks something, and says what',
    by.biggest.breaks.length > 0 && by.biggest.breaks.every((b) => ['to', 'are'].includes(b.word)));
  check('the easiest break breaks two or more, in four letters or fewer',
    by.easiest.breaks.length >= 2 && by.easiest.word.length <= 4, by.easiest.word);
  check('nothing kept could not legally have been claimed',
    r.every((m) => m.breaks.every((b) => b.word.length < m.word.length)));
  equal('the board is kept as it stood, claims half way through their hold',
    by.biggest.board.claims.map((c) => c.fill), [0.5, 0.5]);
}

section('played words are struck off');
{
  const s = new Scout();
  s.look(game(), 0);
  const first = s.result().find((m) => m.kind === 'longest').word;
  s.playedWord(first);
  const next = s.result().find((m) => m.kind === 'longest');
  check('the next best takes its place', !!next && next.word !== first, `${first} then ${next?.word}`);
  check('and is no shorter than one the scout would have ranked lower', next.word.length <= first.length);
}

done();
