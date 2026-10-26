// The database: migrations and what a finished match leaves behind. Run against
// PGlite, real Postgres in-process, so no server is needed.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
import { pglite } from './pglite.mjs';
const { Db, MIGRATIONS, transient } = createRequire(import.meta.url)('../dist/server/db.js');

const { pg, sql } = pglite();
const quiet = (fn) => async (...a) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn(...a);
  } finally {
    console.log = log;
  }
};

section('migrations');
{
  await quiet(() => new Db(sql).whenReady())();
  const { rows } = await pg.query('select version from schema_migrations order by version');
  equal('every migration ran, once, in order', rows.map((r) => r.version), MIGRATIONS.map((_, i) => i + 1));
  await quiet(() => new Db(sql).whenReady())();
  const again = await pg.query('select count(*)::int as n from schema_migrations');
  equal('a restart runs none of them again', again.rows[0].n, MIGRATIONS.length);

  const fresh = pglite();
  await quiet(() => Promise.all([new Db(fresh.sql).whenReady(), new Db(fresh.sql).whenReady()]))();
  const both = await fresh.pg.query('select count(*)::int as n from schema_migrations');
  equal('two servers starting at once apply each migration once', both.rows[0].n, MIGRATIONS.length);
  await fresh.pg.close();
}

section('a finished match');
{
  const db = new Db(sql);
  await quiet(() => db.whenReady())();
  const report = JSON.stringify({ table: 't1', how: 'points', players: [{ name: 'ann', score: 30 }], claims: [{ w: 'cat' }] });
  await db.saveMatch({ tableId: 't1', endedAt: new Date('2026-10-26T12:00:00Z'), how: 'points', playerIds: ['a', 'b'], report });
  const { rows } = await pg.query(
    "select table_id, how, player_ids, report->'claims'->0->>'w' as first, ended_at from matches",
  );
  equal('is kept, with who played', [rows[0].table_id, rows[0].how, rows[0].player_ids], ['t1', 'points', ['a', 'b']]);
  equal('and its report can be queried as JSON', rows[0].first, 'cat');
  check('at the time it ended', rows[0].ended_at.toISOString() === '2026-10-26T12:00:00.000Z');
}

section('word requests');
{
  const db = new Db(sql);
  await quiet(() => db.whenReady())();
  const r = { word: 'rizz', playerId: 'a', tableId: 't1' };
  await db.requestWord(r, true);
  await db.requestWord(r, true);
  await db.requestWord({ ...r, playerId: 'b' }, true);
  const count = async () => (await pg.query("select count(*)::int as n from word_requests where word = 'rizz'")).rows[0].n;
  equal('one ask per player, however many times they ask', await count(), 2);
  await db.requestWord(r, false);
  equal('and taking one back removes only theirs', await count(), 1);
}

section('when the database fails');
{
  const db = new Db(sql);
  await quiet(() => db.whenReady())();
  const err = console.error;
  let logged = '';
  console.error = (m) => (logged += m);
  // Not valid JSON, so Postgres turns the insert down.
  await db.saveMatch({ tableId: 't2', endedAt: new Date(), how: 'time', playerIds: [], report: '{' });
  console.error = err;
  check('saving a match does not throw, and says why', logged.includes('saving match t2 refused'), logged);
}

section('the write queue');
{
  equal('a lost connection is worth waiting out', [transient({ code: 'ECONNREFUSED' }), transient({ code: '08006' }), transient({ code: '57P01' }), transient(new Error('timeout'))], [true, true, true, true]);
  equal('a refusal by Postgres is not', [transient({ code: '22P02' }), transient({ code: '23505' })], [false, false]);

  // A connection that drops the first two writes it is given, then recovers.
  let drops = 2;
  const landed = [];
  const flaky = {
    query: async (t, p) => {
      if (t.startsWith('insert into word_requests') && drops > 0) {
        drops--;
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      }
      const out = await sql.query(t, p);
      if (t.startsWith('insert into word_requests')) landed.push(p[0]);
      return out;
    },
    transaction: sql.transaction,
  };
  const db = new Db(flaky, [5, 5, 5]);
  await quiet(() => db.whenReady())();
  const err = console.error;
  let logged = '';
  console.error = (m) => (logged += `${m}\n`);
  for (const word of ['one', 'two', 'three']) void db.requestWord({ word, playerId: 'q', tableId: 't' }, true);
  void db.saveMatch({ tableId: 'bad', endedAt: new Date(), how: 'time', playerIds: [], report: '{' });
  void db.requestWord({ word: 'four', playerId: 'q', tableId: 't' }, true);
  await db.drained();
  console.error = err;
  equal('writes dropped by the connection are retried until they land, in order', landed, ['one', 'two', 'three', 'four']);
  check('the retry is logged once, not per attempt', logged.split('retrying').length - 1 === 1, logged);
  check('a write Postgres refuses is skipped, without holding up the rest', logged.includes('saving match bad refused'), logged);
}

await pg.close();
done();
