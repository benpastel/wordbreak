// Players, ratings and the leaderboard, kept in a real Postgres (PGlite), and the
// promise that stored matches are enough to rebuild every rating.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
const require = createRequire(import.meta.url);
const { Db } = require('../dist/server/db.js');
const { Ledger, replay } = require('../dist/server/ledger.js');
const { BOT_LEVELS } = require('../dist/shared/types.js');

import { pglite } from './pglite.mjs';
const { pg, sql } = pglite();
const log = console.log;
console.log = () => {};
const db = new Db(sql);
await db.whenReady();
console.log = log;

const seat = (name, device, score, bot = null) => ({ name, device, score, bot });
// A report in seat order, as MatchLog prints it: scores for those who stayed.
const report = (seats) => JSON.stringify({
  players: seats.map((s) => ({ name: s.name, bot: s.bot, ...(s.score === null ? { left: true } : { score: s.score }) })),
});
let minute = 0;
const match = (seats, how = 'points') => ({
  tableId: 't', endedAt: new Date(Date.UTC(2026, 9, 26, 12, minute++)), how, seats, report: report(seats),
});

section('guests and bots');
const ledger = new Ledger(db);
await ledger.ready;
await ledger.record(match([seat('ann', 'dev1', 30), seat('bob', 'dev1', 10)]));
await ledger.record(match([seat('Ann', 'dev1', 30), seat('cal', 'dev2', 20), seat('intermediate', null, 25, 0.35)]));
await ledger.record(match([seat('cal', 'dev2', null), seat('bob', 'dev1', 5)]));
await ledger.record(match([seat('ann', 'dev1', null), seat('dee', 'dev3', null)], 'abandoned'));
await db.drained();

const ann = ledger.guestId('dev1', 'ann');
check('two people on one browser are two guests', ann && ledger.guestId('dev1', 'bob') && ann !== ledger.guestId('dev1', 'bob'));
equal('a name is the same guest whatever its case', ledger.guestId('dev1', 'ANN '), ann);
equal('the same name on another browser is someone else', ledger.guestId('dev9', 'ann'), null);
const board = ledger.leaderboard(ann);
equal('the leaderboard marks you', board.you, ann);
check('bots sit on it at their fixed ratings', BOT_LEVELS.every((l) => board.rows.some((r) => r.id === l.id && r.rating === l.rating)));
check('ann, who won both, is above bob, who lost both', board.rows.findIndex((r) => r.id === ann) < board.rows.findIndex((r) => r.name === 'bob'));
equal('an abandoned match rates nobody', board.rows.find((r) => r.name === 'dee'), undefined);

section('kept in the database');
const { rows } = await pg.query('select count(*)::int as n from matches');
equal('every match is kept, abandoned ones too', rows[0].n, 4);
const again = new Ledger(db);
await again.ready;
equal('a restart reloads the same leaderboard', again.leaderboard(ann), board);

section('rebuilt from history');
const stored = await pg.query('select player_ids, how, report from matches order by id');
const rebuilt = replay(stored.rows.map((r) => ({ playerIds: r.player_ids, how: r.how, report: JSON.stringify(r.report) })));
const players = await pg.query("select id, rating, rd, volatility from players where kind = 'guest' and rated_matches > 0");
check('every rating comes back exactly from the stored matches',
  players.rows.length === 3 && players.rows.every((p) => {
    const r = rebuilt.get(p.id);
    return r && Math.abs(r.rating - p.rating) < 1e-9 && Math.abs(r.rd - p.rd) < 1e-9 && Math.abs(r.volatility - p.volatility) < 1e-9;
  }), JSON.stringify(players.rows));
const one = (await pg.query("select report->'ratings' as r from matches order by id limit 1")).rows[0].r;
check("each match keeps everyone's rating before and after", one.length === 2 && one.every((x) => x.before && x.after));

section('another browser');
await ledger.record(match([seat('ANN', 'dev7', 40), seat('cal', 'dev2', 10)]));
await db.drained();
const phone = ledger.guestId('dev7', 'ann');
check('ann on her phone starts as someone else', phone && phone !== ann);
const annBefore = { ...(await pg.query('select rated_matches from players where id = $1', [ann])).rows[0] };
const linked = await ledger.link('dev7', ann);
await db.drained();
equal('linking the phone makes it ann', ledger.guestId('dev7', 'Ann'), ann);
equal('and returns who it now plays as', linked?.id, ann);
const merged = ledger.leaderboard(ann);
equal('the phone guest leaves the board', merged.rows.find((r) => r.id === phone), undefined);
equal('ann is on two browsers now', merged.devices, 2);
const annRow = merged.rows.find((r) => r.id === ann);
check('the rating shown is the estimate less two RDs, give or take rounding',
  Math.abs(annRow.rating - (annRow.estimate - 2 * annRow.rd)) <= 2, JSON.stringify(annRow));
equal("ann's matches are both browsers'", merged.rows.find((r) => r.id === ann).matches, annBefore.rated_matches + 1);
await ledger.record(match([seat('ann', 'dev7', 30), seat('cal', 'dev2', 20)]));
await db.drained();
equal('a match played on the phone counts for ann', ledger.leaderboard(ann).rows.find((r) => r.id === ann).matches, annBefore.rated_matches + 2);
const reloaded = new Ledger(db);
await reloaded.ready;
equal('a restart remembers the link', reloaded.guestId('dev7', 'ann'), ann);
equal('and the merged board', reloaded.leaderboard(ann), ledger.leaderboard(ann));
equal('nobody links to a bot', await ledger.link('dev8', BOT_LEVELS[0].id), null);

await pg.close();
done();
