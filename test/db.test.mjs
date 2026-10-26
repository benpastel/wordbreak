// The database: migrations and what a finished match leaves behind. Run against
// PGlite, real Postgres in-process, so no server is needed.
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { section, check, equal, done } from './harness.mjs';
const { Db, MIGRATIONS } = createRequire(import.meta.url)('../dist/server/db.js');

const pg = new PGlite();
const sql = { query: (t, p) => pg.query(t, p), exec: (t) => pg.exec(t) };
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
  check('saving a match does not throw, and says why', logged.includes('could not save match t2'), logged);
}

await pg.close();
done();
