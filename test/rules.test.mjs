// The pure rules: what may be selected, and what may be claimed.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
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

section('match write-up');
{
  const c = (playerId, word, reactionMs = null, broke = null) =>
    ({ playerId, word, at: 0, reactionMs, broke });
  const stats = R.computeStats([
    c('a', 'do'),
    c('b', 'strained', 4200),
    c('a', 'jazzy', 900),
    c('b', 'rates', 300, { playerId: 'a', word: 'rat' }),
    c('a', 'breaking', 1500, { playerId: 'b', word: 'bre' }),
  ]);
  const by = Object.fromEntries(stats.awards.map((x) => [x.kind, x]));
  check('longest goes to the longest word', by.longest.word === 'strained', by.longest?.word);
  check('shortest goes to the shortest', by.shortest.word === 'do', by.shortest?.word);
  check('obscure prefers rare letters over length',
    by.obscure.word === 'jazzy', by.obscure?.word);
  check('fastest goes to the quickest reaction', by.fastest.word === 'rates', by.fastest?.word);
  check('fastest reads in seconds', by.fastest.detail.startsWith('0.3'), by.fastest.detail);
  check('each award names its winner', by.longest.playerId === 'b' && by.obscure.playerId === 'a');

  check('only broken claims are listed', stats.breaks.length === 2);
  check('the biggest jump leads',
    stats.breaks[0].word === 'breaking' && stats.breaks[0].overWord === 'bre',
    stats.breaks.map((b) => `${b.overWord}->${b.word}`).join(', '));
  check('a break records both sides',
    stats.breaks[0].byPlayerId === 'a' && stats.breaks[0].overPlayerId === 'b');

  const empty = R.computeStats([]);
  check('a match with no claims has nothing to say',
    empty.awards.length === 0 && empty.breaks.length === 0);

  const noReactions = R.computeStats([c('a', 'cat')]);
  check('no fastest award when nothing was a reaction',
    !noReactions.awards.some((x) => x.kind === 'fastest'));
  check('rarity ranks rare letters above common ones', R.rarity('jazz') > R.rarity('tease'));
}

section('live word lists: longest on top, shortest truncated away');
{
  const c = (id, playerId, len, banksAt, word) =>
    ({ id, playerId, tileIds: Array.from({ length: len }, (_, i) => i + 1), word, claimedAt: 0, banksAt });
  const grouped = R.claimsByPlayer([
    c('1', 'a', 3, 500, 'cat'),
    c('2', 'b', 5, 900, 'crane'),
    c('3', 'a', 6, 100, 'badger'),
    c('4', 'a', 3, 200, 'dog'),
    c('5', 'a', 4, 700, 'lynx'),
  ]);
  check('claims are grouped by owner', grouped.size === 2 && grouped.get('a').length === 4);
  equal('longest first for each player',
    grouped.get('a').map((x) => x.word), ['badger', 'lynx', 'dog', 'cat']);
  check('equal lengths put the one nearest banking above',
    grouped.get('a')[2].word === 'dog' && grouped.get('a')[3].word === 'cat');
  equal('a player with one claim still gets a list', grouped.get('b').map((x) => x.word), ['crane']);
  check('no claims means no entry', R.claimsByPlayer([]).size === 0);

  // truncation drops from the bottom, which is where the shortest words are
  const shown = grouped.get('a').slice(0, 2).map((x) => x.word);
  equal('truncating keeps the longest', shown, ['badger', 'lynx']);
}

section('settings are clamped to the offered range');
{
  const base = { gridSize: 5, holdMs: 30_000, endMode: 'points', gameMs: 300_000, targetScore: 50 };
  const clamp = (patch) => R.clampSettings({ ...base, ...patch });
  for (const [asked, want] of [[3, 4], [4, 4], [5, 5], [6, 6], [7, 6], [99, 6]]) {
    check(`grid ${asked} clamps to ${want}`, clamp({ gridSize: asked }).gridSize === want);
  }
  check('hold time clamps low', clamp({ holdMs: 1 }).holdMs >= 3_000);
  check('hold time clamps high', clamp({ holdMs: 1e9 }).holdMs <= 60_000);
  check('match length clamps low', clamp({ gameMs: 1 }).gameMs >= 30_000);
  check('target clamps low', clamp({ targetScore: 0 }).targetScore >= 10);
  check('target clamps high', clamp({ targetScore: 1e6 }).targetScore <= 1_000);
  for (const m of ['time', 'points', 'unlimited']) {
    check(`${m} is a valid end mode`, clamp({ endMode: m }).endMode === m);
  }
  check('a nonsense end mode falls back to points',
    clamp({ endMode: 'whenever' }).endMode === 'points');
}

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
