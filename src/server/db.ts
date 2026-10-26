// What outlives the server. Play itself stays in memory (store.ts); the database
// only ever hears about a match once it is over, so a slow or missing database can
// never stall a claim. Every write is fire-and-forget: a failure is logged and the
// game carries on.
//
// Off unless DATABASE_URL is set, so local play and the tests need no Postgres.

import { Pool } from 'pg';

/** The little of a Postgres client this needs. pg's Pool in production; PGlite in the
 *  tests, so the SQL is checked against real Postgres without running a server. */
export interface Sql {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Several statements at once, no parameters. */
  exec(text: string): Promise<unknown>;
}

/** Applied in order, each once, each in its own transaction. Append only: a
 *  migration that has run in production is never edited, only followed. */
export const MIGRATIONS: string[] = [
  // 1. Every finished match: the same report printed to the log (matchlog.ts), plus
  //    who played, by id, which the log leaves out.
  `create table matches (
     id bigserial primary key,
     table_id text not null,
     ended_at timestamptz not null,
     how text not null,
     player_ids text[] not null,
     report jsonb not null
   );
   create index matches_ended_at on matches (ended_at);`,
];

export interface FinishedMatch {
  tableId: string;
  endedAt: Date;
  how: 'time' | 'points' | 'abandoned';
  playerIds: string[];
  /** MatchLog's JSON report. */
  report: string;
}

export class Db {
  private ready: Promise<void>;

  constructor(private sql: Sql) {
    this.ready = this.migrate();
    // Logged here so a broken database shows up at startup, not at the first match.
    this.ready.catch((e) => console.error(`database: migrations failed: ${e}`));
  }

  /** Resolves once the schema is current. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private async migrate(): Promise<void> {
    await this.sql.exec(`create table if not exists schema_migrations (
      version int primary key,
      applied_at timestamptz not null default now()
    )`);
    const { rows } = await this.sql.query('select coalesce(max(version), 0) as v from schema_migrations');
    const at = Number(rows[0].v);
    for (let v = at + 1; v <= MIGRATIONS.length; v++) {
      await this.sql.exec(
        `begin; ${MIGRATIONS[v - 1]}; insert into schema_migrations (version) values (${v}); commit;`,
      );
    }
    console.log(`database: schema at version ${MIGRATIONS.length}${at < MIGRATIONS.length ? ` (was ${at})` : ''}`);
  }

  /** Keep a match for good. Never throws. */
  saveMatch(m: FinishedMatch): Promise<void> {
    return this.ready
      .then(() =>
        this.sql.query(
          'insert into matches (table_id, ended_at, how, player_ids, report) values ($1, $2, $3, $4, $5)',
          [m.tableId, m.endedAt, m.how, m.playerIds, m.report],
        ),
      )
      .then(
        () => undefined,
        (e) => console.error(`database: could not save match ${m.tableId}: ${e}`),
      );
  }
}

/** The production database, or null when DATABASE_URL is not set. */
export function openDb(url = process.env.DATABASE_URL): Db | null {
  if (!url) return null;
  // A handful of connections is plenty for one write per match.
  const pool = new Pool({ connectionString: url, max: 3 });
  pool.on('error', (e) => console.error(`database: idle connection error: ${e}`));
  return new Db({
    query: (text, params) => pool.query(text, params),
    // On a connection of its own, rolled back on failure, so a migration that dies
    // halfway never hands the pool a connection stuck in an aborted transaction.
    exec: async (text) => {
      const c = await pool.connect();
      try {
        return await c.query(text);
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  });
}
