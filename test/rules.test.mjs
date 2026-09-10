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
  const c = (playerId, word, broke = null) => ({ playerId, word, at: 0, broke });
  const of = (st, kind, playerId) =>
    st.awards.find((x) => x.kind === kind && x.playerId === playerId);
  const all = (st, kind) => st.awards.filter((x) => x.kind === kind);

  // A corpus rank, as in production. Without one, obscurity falls back to letter
  // rarity, which sums over the word and so mostly just re-picks the longest.
  const corpus = {
    do: 5, cat: 900, rates: 4000, breaking: 3000, strained: 12000, jazzy: 15000,
    zephyr: 21000,
  };
  const rank = (w) => (w in corpus ? corpus[w] : null);

  const stats = R.computeStats([
    c('a', 'do'),
    c('b', 'strained'),
    c('a', 'jazzy'),
    c('b', 'rates', { playerId: 'a', word: 'rat' }),
    c('b', 'zephyr'),
    c('a', 'breaking', { playerId: 'b', word: 'bre' }),
  ], { rank });

  check('everyone who claimed gets their own longest', all(stats, 'longest').length === 2);
  check("a's longest is their own, not the table's",
    of(stats, 'longest', 'a').word === 'breaking', of(stats, 'longest', 'a')?.word);
  check("b's longest is theirs", of(stats, 'longest', 'b').word === 'strained',
    of(stats, 'longest', 'b')?.word);
  check('longest counts letters', of(stats, 'longest', 'a').detail === '8 letters');

  check('everyone gets their own most obscure too', all(stats, 'obscure').length === 2,
    JSON.stringify(all(stats, 'obscure').map((x) => `${x.playerId}:${x.word}`)));
  check("a's most obscure is theirs, and not their longest",
    of(stats, 'obscure', 'a').word === 'jazzy', of(stats, 'obscure', 'a')?.word);
  check("b's most obscure is theirs, and is not their longest",
    of(stats, 'obscure', 'b').word === 'zephyr', of(stats, 'obscure', 'b')?.word);
  check('shortest is still one winner across the table', all(stats, 'shortest').length === 1);
  check('and it is the shortest word anyone claimed',
    of(stats, 'shortest', 'a').word === 'do', all(stats, 'shortest')[0]?.word);
  check('hardest letters is also table-wide', all(stats, 'hardest').length === 1);
  check('and prefers rare letters over length',
    all(stats, 'hardest')[0].word === 'jazzy', all(stats, 'hardest')[0]?.word);
  check('the removed reaction award is gone', all(stats, 'fastest').length === 0);

  check('only broken claims are listed', stats.breaks.length === 2);
  check('the biggest jump leads',
    stats.breaks[0].word === 'breaking' && stats.breaks[0].overWord === 'bre',
    stats.breaks.map((b) => `${b.overWord}->${b.word}`).join(', '));
  check('a break records both sides',
    stats.breaks[0].byPlayerId === 'a' && stats.breaks[0].overPlayerId === 'b');

  const empty = R.computeStats([]);
  check('a match with no claims has nothing to say',
    empty.awards.length === 0 && empty.breaks.length === 0);

  // 'syzygy' is off the corpus entirely, which outranks anything on it — even a
  // longer word the corpus does know.
  const offCorpus = R.computeStats([c('a', 'breaking'), c('a', 'syzygy')], { rank });
  check('a word the corpus has never seen beats anything in it',
    of(offCorpus, 'obscure', 'a').word === 'syzygy', of(offCorpus, 'obscure', 'a')?.word);
  check('and says so', of(offCorpus, 'obscure', 'a').detail === 'not in everyday use',
    of(offCorpus, 'obscure', 'a').detail);
  check('while a word it does know is described differently',
    of(stats, 'obscure', 'a').detail === 'seldom said out loud',
    of(stats, 'obscure', 'a').detail);

  section('a word is never listed twice for the same player');
  {
    // one claim each: their longest and their most obscure are necessarily the same
    const single = R.computeStats([c('a', 'cat'), c('b', 'syzygy')], { rank });
    check('the obscure line is dropped rather than repeating the longest',
      all(single, 'obscure').length === 0,
      JSON.stringify(single.awards.map((x) => `${x.playerId}:${x.kind}:${x.word}`)));
    check('the longest line survives', all(single, 'longest').length === 2);

    const defined = R.computeStats([c('a', 'cat'), c('b', 'syzygy')], {
      rank,
      define: (w) => (w === 'syzygy' ? 'three celestial bodies in a straight line' : null),
    });
    check('and inherits the definition the dropped line would have carried',
      of(defined, 'longest', 'b').definition === 'three celestial bodies in a straight line',
      of(defined, 'longest', 'b')?.definition);

    // longest and most obscure genuinely differ here, so both lines stay
    const two = R.computeStats([c('a', 'breaking'), c('a', 'syzygy')], {
      rank,
      define: (w) => (w === 'syzygy' ? 'three celestial bodies in a straight line' : null),
    });
    check('with distinct words both lines are kept',
      of(two, 'longest', 'a').word === 'breaking' && of(two, 'obscure', 'a').word === 'syzygy',
      JSON.stringify(two.awards.filter((x) => x.playerId === 'a').map((x) => `${x.kind}:${x.word}`)));
    check('the definition sits on the obscure line, not the longest',
      of(two, 'obscure', 'a').definition === 'three celestial bodies in a straight line' &&
        of(two, 'longest', 'a').definition === undefined);
    check('a word with no definition simply goes without one',
      of(R.computeStats([c('a', 'cat')], { rank }), 'longest', 'a').definition === undefined);
    check('the internal duplicate marker never escapes',
      !single.awards.some((x) => x.kind === 'duplicate'));
  }
}

section('kept going back to the same word');
{
  const c = (playerId, word) => ({ playerId, word, at: 0, broke: null });
  {
    const twice = R.computeStats([c('a', 'sea'), c('a', 'sea'), c('a', 'ore')]);
    check('twice is not worth mentioning', !twice.awards.some((x) => x.kind === 'repeat'));

    const thrice = R.computeStats([c('a', 'sea'), c('a', 'sea'), c('a', 'sea'), c('b', 'ore')]);
    const rep = thrice.awards.find((x) => x.kind === 'repeat');
    check('three times is', !!rep && rep.word === 'sea' && rep.playerId === 'a');
    check('and it says how many', rep?.detail === 'found it 3 times', rep?.detail);

    const both = R.computeStats([
      c('a', 'sea'), c('a', 'sea'), c('a', 'sea'),
      c('b', 'ore'), c('b', 'ore'), c('b', 'ore'),
    ]);
    const reps = both.awards.filter((x) => x.kind === 'repeat');
    check('two players can both place', reps.length === 2,
      JSON.stringify(reps.map((r) => `${r.playerId}:${r.word}`)));

    const sameWord = R.computeStats([
      c('a', 'sea'), c('a', 'sea'), c('a', 'sea'),
      c('b', 'sea'), c('b', 'sea'),
    ]);
    check('the same word by different players is counted separately',
      sameWord.awards.filter((x) => x.kind === 'repeat').length === 1);
  }
  check('rarity ranks rare letters above common ones', R.rarity('jazz') > R.rarity('tease'));
}

section('thief, and ties');
{
  const c = (playerId, word, at = 0, broke = null) => ({ playerId, word, at, broke });
  const kinds = (st) => Object.fromEntries(st.awards.map((x) => [x.kind, x]));
  const all = (st, kind) => st.awards.filter((x) => x.kind === kind);

  const thieving = R.computeStats([
    c('a', 'cats', 1, { playerId: 'b', word: 'cat' }),
    c('a', 'breaking', 2, { playerId: 'b', word: 'bre' }),
    c('a', 'seas', 3, { playerId: 'b', word: 'sea' }),
    c('b', 'ores', 4, { playerId: 'a', word: 'ore' }),
  ]);
  const th = kinds(thieving).thief;
  check('thief goes to whoever broke the most', th.playerId === 'a');
  check('and counts them', th.detail === 'broke 3 claims', th.detail);
  check('and shows the theft that gained the most letters', th.word === 'breaking', th.word);
  check('a single break is not thievery',
    !kinds(R.computeStats([c('a', 'cats', 1, { playerId: 'b', word: 'cat' })])).thief);

  const tied = R.computeStats([
    c('a', 'cats', 1, { playerId: 'x', word: 'cat' }), c('a', 'dogs', 2, { playerId: 'x', word: 'dog' }),
    c('b', 'oars', 3, { playerId: 'x', word: 'oar' }), c('b', 'ears', 4, { playerId: 'x', word: 'ear' }),
  ]);
  check('a genuine tie places both', all(tied, 'thief').length === 2,
    JSON.stringify(all(tied, 'thief').map((x) => x.playerId)));

  // six players all break twice: five place, the sixth misses out by arriving last
  const many = [];
  'abcdef'.split('').forEach((id, i) => {
    many.push(c(id, 'cats', i * 2 + 1, { playerId: 'x', word: 'cat' }));
    many.push(c(id, 'dogs', i * 2 + 2, { playerId: 'x', word: 'dog' }));
  });
  const capped = all(R.computeStats(many), 'thief');
  check('ties are capped at five', capped.length === 5, String(capped.length));
  check('and the earliest to get there keep it',
    capped.map((x) => x.playerId).join('') === 'abcde', capped.map((x) => x.playerId).join(''));

  const reps = all(R.computeStats(
    'abcdef'.split('').flatMap((id) => [c(id, 'sea', 1), c(id, 'sea', 2), c(id, 'sea', 3)]),
  ), 'repeat');
  check('repeat ties are capped the same way', reps.length === 5, String(reps.length));
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
