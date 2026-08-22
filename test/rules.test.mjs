// The pure rules: what may be selected, and what may be claimed.
import { createRequire } from 'node:module';
import { section, check, done } from './harness.mjs';
const R = createRequire(import.meta.url)('../dist/shared/rules.js');

//   1 2 3      C A T
//   4 5 6      S E D
//   7 8 9      R O G
const game = {
  size: 3,
  grid: 'CATSEDROG'.split('').map((letter, i) => ({ id: i + 1, letter })),
  claims: [
    { id: 'x', playerId: 'me', tileIds: [1, 2, 3], word: 'cat', claimedAt: 0, banksAt: 9e9 },
  ],
};
const theirs = { ...game, claims: [{ ...game.claims[0], playerId: 'them' }] };

section('selection is never blocked by a claim');
check('can start a fresh trail inside your own claim', R.canAppend(game, [], 1));
check('can start a fresh trail inside an opponent claim', R.canAppend(theirs, [], 1));
check('can extend into your own claim', R.canAppend(game, [4], 1));
check('can extend into an opponent claim', R.canAppend(theirs, [4], 1));
check('can walk a whole claim from scratch',
  R.canAppend(game, [], 1) && R.canAppend(game, [1], 2) && R.canAppend(game, [1, 2], 3));

section('path rules still apply');
check('rejects a letter already in the trail', !R.canAppend(game, [1, 2], 1));
check('rejects a non-adjacent letter', !R.canAppend(game, [1], 6));
check('accepts a diagonal neighbour', R.canAppend(game, [1], 5));
check('rejects a letter not on the board', !R.canAppend(game, [], 99));

section('the length rule lives on the claim, and is symmetric');
check('equal length over your own claim rejected', R.validatePath(game, [1, 2, 3]) === 'not-long-enough');
check('equal length over an opponent claim rejected', R.validatePath(theirs, [1, 2, 3]) === 'not-long-enough');
check('shorter over your own claim rejected', R.validatePath(game, [1, 2]) === 'not-long-enough');
check('longer over your own claim accepted', R.validatePath(game, [1, 2, 3, 6]) === null);
check('longer over an opponent claim accepted', R.validatePath(theirs, [1, 2, 3, 6]) === null);
check('a word touching no claim accepted', R.validatePath(game, [4, 5]) === null);
check('a broken path is a path error, not a length one', R.validatePath(game, [1, 6]) === 'not-adjacent');

section('settings are clamped to the offered range');
for (const [asked, want] of [[3, 4], [4, 4], [5, 5], [6, 6], [7, 6], [99, 6]]) {
  check(`grid ${asked} clamps to ${want}`, R.clampSettings(asked, 30000).gridSize === want);
}
check('hold time clamps low', R.clampSettings(5, 1).holdMs >= 3000);
check('hold time clamps high', R.clampSettings(5, 1e9).holdMs <= 60000);

section('medals: standard competition ranking, and nothing for nothing');
{
  const m = (xs) => R.medalsFor(xs);
  const g = m([{ id: 'a', score: 9 }, { id: 'b', score: 5 }, { id: 'c', score: 1 }]);
  check('clear top three', g.a === 'gold' && g.b === 'silver' && g.c === 'bronze');

  const tie = m([{ id: 'a', score: 9 }, { id: 'b', score: 9 }, { id: 'c', score: 4 }]);
  check('a tie for first gives two golds', tie.a === 'gold' && tie.b === 'gold');
  check('...and skips silver', tie.c === 'bronze');

  const fourth = m([
    { id: 'a', score: 9 }, { id: 'b', score: 5 },
    { id: 'c', score: 5 }, { id: 'd', score: 3 },
  ]);
  check('a tie for second gives two silvers', fourth.b === 'silver' && fourth.c === 'silver');
  check('...and nobody takes bronze', fourth.d === undefined);

  check('scoring nothing wins nothing', Object.keys(m([{ id: 'a', score: 0 }])).length === 0);
  check('a lone scorer still takes gold', m([{ id: 'a', score: 2 }]).a === 'gold');
}

section('claiming and banking');
{
  const g = JSON.parse(JSON.stringify(game));
  const { broken } = R.applyClaim(g, [1, 2, 3, 6], 'them', 'cats', 1000, 30000, 'c2');
  check('the claim it reached into was destroyed whole', broken.length === 1 && g.claims.length === 1);
  check('claims stay disjoint', new Set(g.claims.flatMap((c) => c.tileIds)).size ===
    g.claims.reduce((n, c) => n + c.tileIds.length, 0));

  let next = 100;
  const res = R.bankClaim(g, g.claims[0], () => next++);
  check('one point per letter', res.points === 4, `got ${res.points}`);
  check('old letters are reported for the fly-to animation', res.letters.join('') === 'CATD');
  check('board stays full', g.grid.length === 9);
  check('vacated cells got fresh ids', g.grid.filter((t) => t.id >= 100).length === 4);
  check('the banked claim is gone', g.claims.length === 0);
}

done();
