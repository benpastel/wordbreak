// Glicko-2, and how a match of several players becomes ratings.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
const { update, rateMatch, pairScore, shown, INITIAL } = createRequire(import.meta.url)('../dist/server/rating.js');

const near = (a, b, tol) => Math.abs(a - b) <= tol;

section("Glickman's worked example");
{
  // From the paper: 1500/200 beats 1400/30, loses to 1550/100 and to 1700/300.
  const r = update({ rating: 1500, rd: 200, volatility: 0.06 }, [
    { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
    { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
    { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
  ]);
  check('rating comes out at 1464.06', near(r.rating, 1464.06, 0.01), r.rating);
  check('RD at 151.52', near(r.rd, 151.52, 0.01), r.rd);
  check('volatility at 0.05999', near(r.volatility, 0.05999, 0.00001), r.volatility);
}

section('a match as pairs');
{
  const e = (id, score, fixed = false, rating = INITIAL) => ({ id, score, fixed, rating });
  equal('higher score wins, equal draws', [pairScore(e('a', 30), e('b', 12)), pairScore(e('a', 9), e('b', 9))], [1, 0.5]);
  equal('leaving loses to anyone who stayed', [pairScore(e('a', null), e('b', 0)), pairScore(e('a', 3), e('b', null))], [0, 1]);
  equal('two who left draw', pairScore(e('a', null), e('b', null)), 0.5);

  const bot = { rating: 1500, rd: 0, volatility: 0.06 };
  const after = rateMatch([e('ann', 30), e('bob', 20), e('bot', 10, true, bot), e('cal', null)]);
  check('the winner rises', after.get('ann').rating > 1500);
  check('the one who left falls', after.get('cal').rating < 1500);
  check('the middle one lands in between', after.get('ann').rating > after.get('bob').rating && after.get('bob').rating > after.get('cal').rating);
  equal('a bot never moves', after.get('bot'), bot);
  check('everyone playing tightens their RD', ['ann', 'bob', 'cal'].every((id) => after.get(id).rd < 350));
  equal('alone at a table, nothing changes', rateMatch([e('solo', 30)]).get('solo'), INITIAL);
}

section('what is shown');
{
  equal('a newcomer shows rating less two RDs', shown(INITIAL), 800);
  const beat = (r) => update(r, [{ opponent: { rating: 1500, rd: 0, volatility: 0.06 }, score: 0.5 }]);
  let r = INITIAL;
  const seen = [];
  for (let i = 0; i < 10; i++) seen.push(Math.round(shown((r = beat(r)))));
  check('even games against a fixed 1500 climb towards it as the RD shrinks', seen.every((x, i) => i === 0 || x > seen[i - 1]) && seen[9] < 1500, seen.join(' '));
}

done();
