// The end-of-match report: claims, what became of them, and words turned down.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
const { MatchLog } = createRequire(import.meta.url)('../dist/server/matchlog.js');

const ann = { id: 'a', name: 'ann', bot: null };
const bot = { id: 'b', name: 'Amy Levy', bot: 0.35 };
const late = { id: 'c', name: 'cal', bot: null };
const settings = { gridSize: 4, endMode: 'points', gameMs: 300_000, targetScore: 30 };

section('a match, start to finish');
{
  const log = new MatchLog('t1', settings, 1_000, [ann, bot]);
  log.claimed('c1', ann, 'cat', 3_240);
  log.claimed('c2', bot, 'cats', 5_000);
  log.broken('c1', bot, 5_000);
  log.banked('c2', 18_000);
  log.claimed('c3', late, 'dog', 20_000);
  log.held('c3');
  log.missed(ann, 'xq', 'not-a-word', 4_000);
  log.missed(bot, 'at', 'not-long-enough', 6_000, true);
  const r = JSON.parse(log.report('points', 21_000, new Map([
    ['a', { score: 0 }],
    ['b', { score: 30, medal: 'gold' }],
  ])));

  equal('times are seconds into the match, to a tenth', r.claims[0].s, 2.2);
  equal('a broken claim says when and by whom', [r.claims[0].broken, r.claims[0].by], [4, 1]);
  equal('a banked claim says when', r.claims[1].banked, 17);
  check('one still held at the end says so', r.claims[2].held === true);
  equal('a player who arrived late is added', r.players[2].name, 'cal');
  check('and one no longer at the table is marked as gone', r.players[2].left === true);
  equal('bots carry their difficulty', r.players.map((p) => p.bot), [null, 0.35, null]);
  equal('medals and scores come from the finals', [r.players[1].score, r.players[1].medal], [30, 'gold']);
  equal('a points match gives its target, not a clock', [r.target, r.timeSecs], [30, undefined]);
  equal('misses keep who, what and why', r.misses[0], { s: 3, p: 0, w: 'xq', why: 'not-a-word' });
  check('and which were the server refusing', r.misses[1].server === true && r.misses[0].server === undefined);
}

section('limits');
{
  const log = new MatchLog('t2', settings, 0, [ann]);
  for (let i = 0; i < 1000; i++) log.missed(ann, 'zz', 'not-a-word', i);
  const r = JSON.parse(log.report('abandoned', 2_000, new Map()));
  equal('misses are capped per player', r.misses.length, 400);
  equal('an abandoned match says so', r.how, 'abandoned');
}

done();
