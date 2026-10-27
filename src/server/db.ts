// What outlives the server. Play itself stays in memory (store.ts); the database
// only ever hears about a match once it is over, so a slow or missing database can
// never stall a claim.
//
// Writes go through one queue, in order, each retried with backoff while the
// database is unreachable, so the ratings held in memory and the rows behind them
// cannot drift apart over a blip, and an older write can never land after a newer
// one. A write the database refuses outright (bad data, not a lost connection) is
// logged and skipped; one that still cannot get through after every retry is logged
// in full, so it can be put back by hand.
//
// Off unless DATABASE_URL is set. `npm run dev` reads it from a .env file, if there
// is one (see the README), and the tests use PGlite instead.

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

type Query = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** The little of a Postgres client this needs. pg's Pool in production; PGlite in the
 *  tests, so the SQL is checked against real Postgres without running a server. */
export interface Sql {
  query: Query;
  /** `fn` inside one transaction on one connection: `exec` runs several statements
   *  at once, with no parameters. Rolled back if it throws. */
  transaction<T>(fn: (tx: { query: Query; exec: (text: string) => Promise<unknown> }) => Promise<T>): Promise<T>;
}

// ------------------------------------------------------------------ migrations
//
// One file each in migrations/, NNN-name.sql, applied in order and once each,
// recorded in schema_migrations by number. Append only: a migration that has run in
// production is never edited, only followed by another.
//
// Additive only, too. On a deploy the new server starts, and migrates, while the old
// one is still serving for a few seconds, so the old code must keep working against
// the new schema: add tables and columns freely, but remove or rename something in
// two deploys, the first to stop using it and the second to drop it.

const MIGRATION_DIRS = [
  path.join(__dirname, '..', '..', 'migrations'), // from dist/server or src/server
  path.join(process.cwd(), 'migrations'),
];

export function readMigrations(): string[] {
  const dir = MIGRATION_DIRS.find((d) => fs.existsSync(d));
  if (!dir) throw new Error(`migrations/ not found; looked in:\n  ${MIGRATION_DIRS.join('\n  ')}`);
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}-.+\.sql$/.test(f)).sort();
  files.forEach((f, i) => {
    if (Number(f.slice(0, 3)) !== i + 1) throw new Error(`migrations/${f} is out of sequence: expected ${i + 1}`);
  });
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

export const MIGRATIONS = readMigrations();

/** Held while migrating, so two servers starting at once take turns. Any number,
 *  so long as nothing else in this database uses it. */
const MIGRATION_LOCK = 7_461_843;

// ------------------------------------------------------------------ rows

export interface WordRequest {
  word: string;
  playerId: string;
  tableId: string;
}

/** A player as stored, and as the ratings keep them in memory. */
export interface PlayerRow {
  id: string;
  kind: 'guest' | 'account' | 'bot';
  name: string;
  deviceHash: string | null;
  nameKey: string | null;
  rating: number;
  rd: number;
  volatility: number;
  ratedMatches: number;
  lastSeen: Date;
  /** The guest this one was merged into, by linking browsers; null for most. */
  mergedInto: string | null;
}

/** Another browser playing as a guest (migrations/004). */
export interface GuestLink {
  deviceHash: string;
  nameKey: string;
  playerId: string;
}

export interface FinishedMatch {
  tableId: string;
  endedAt: Date;
  how: 'time' | 'points' | 'abandoned';
  playerIds: string[];
  /** MatchLog's JSON report. */
  report: string;
}

// ------------------------------------------------------------------ writing

/** Waits between attempts at a write the database could not be reached for: about
 *  ten minutes in all before giving up on it. */
const RETRY_MS = [1_000, 3_000, 10_000, 30_000, 60_000, 120_000, 180_000, 240_000];
/** Writes held while the database is away, beyond which the oldest are dropped
 *  (and logged in full) rather than memory growing without end. */
const MAX_QUEUED = 5_000;

interface Write {
  text: string;
  params: unknown[];
  what: string;
}

/** Whether an error is the database being out of reach, worth waiting out, rather
 *  than a refusal that will only ever be refused again. Postgres reports its own
 *  refusals with a five-character SQLSTATE; a lost connection has a system code
 *  like ECONNREFUSED, or a state in class 08 (connection), 53 (out of resources) or
 *  57 (shutting down). */
export function transient(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true;
  return /^(08|53|57)/.test(code);
}

export class Db {
  private ready: Promise<void>;
  private queue: Write[] = [];
  private draining: Promise<void> | null = null;

  constructor(
    private sql: Sql,
    private retryMs: number[] = RETRY_MS,
    /** False to only read, as with a read-only login, which cannot migrate. */
    migrate = true,
  ) {
    this.ready = migrate ? this.migrate() : Promise.resolve();
    // Logged here so a broken database shows up at startup, not at the first match.
    this.ready.catch((e) => console.error(`database: migrations failed: ${e}`));
  }

  /** Resolves once the schema is current. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Resolves once every write queued so far has landed, or been given up on. */
  drained(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  private async migrate(): Promise<void> {
    const at = await this.sql.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      await tx.exec(`create table if not exists schema_migrations (
        version int primary key,
        applied_at timestamptz not null default now()
      )`);
      const { rows } = await tx.query('select coalesce(max(version), 0) as v from schema_migrations');
      const from = Number(rows[0].v);
      for (let v = from + 1; v <= MIGRATIONS.length; v++) {
        await tx.exec(MIGRATIONS[v - 1]);
        await tx.query('insert into schema_migrations (version) values ($1)', [v]);
      }
      return from;
    });
    console.log(`database: schema at version ${MIGRATIONS.length}${at < MIGRATIONS.length ? ` (was ${at})` : ''}`);
  }

  /** Queue a write. Resolves when it has landed or been given up on; never throws. */
  private write(text: string, params: unknown[], what: string): Promise<void> {
    this.queue.push({ text, params, what });
    if (this.queue.length > MAX_QUEUED) {
      const dropped = this.queue.shift()!;
      console.error(`database: queue full, dropped ${dropped.what}: ${JSON.stringify(dropped.params)}`);
    }
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    await this.ready.catch(() => undefined);
    while (this.queue.length) {
      const w = this.queue[0];
      for (let attempt = 0; ; attempt++) {
        try {
          await this.sql.query(w.text, w.params);
          break;
        } catch (e) {
          if (!transient(e)) {
            console.error(`database: ${w.what} refused: ${e}`);
            break;
          }
          if (attempt >= this.retryMs.length) {
            console.error(`database: gave up ${w.what} after ${attempt + 1} tries: ${e}; params ${JSON.stringify(w.params)}`);
            break;
          }
          if (attempt === 0) console.error(`database: ${w.what} failed, retrying: ${e}`);
          await new Promise((r) => setTimeout(r, this.retryMs[attempt]));
        }
      }
      this.queue.shift();
    }
  }

  /** Keep a match for good. */
  saveMatch(m: FinishedMatch): Promise<void> {
    return this.write(
      'insert into matches (table_id, ended_at, how, player_ids, report) values ($1, $2, $3, $4, $5)',
      [m.tableId, m.endedAt, m.how, m.playerIds, m.report],
      `saving match ${m.tableId}`,
    );
  }

  /** Ask for a word to be added, or take the ask back. */
  requestWord(r: WordRequest, requested: boolean): Promise<void> {
    return requested
      ? this.write(
          'insert into word_requests (word, player_id, table_id) values ($1, $2, $3) on conflict do nothing',
          [r.word, r.playerId, r.tableId],
          `recording the request for ${r.word}`,
        )
      : this.write(
          'delete from word_requests where word = $1 and player_id = $2',
          [r.word, r.playerId],
          `withdrawing the request for ${r.word}`,
        );
  }

  /** Insert or update players, as they stand after a match. */
  savePlayers(players: PlayerRow[]): Promise<void> {
    let last = Promise.resolve();
    for (const p of players) {
      last = this.write(
        `insert into players (id, kind, name, device_hash, name_key, rating, rd, volatility, rated_matches, last_seen,
           merged_into)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set name = $3, rating = $6, rd = $7, volatility = $8,
           rated_matches = $9, last_seen = $10, merged_into = $11`,
        [p.id, p.kind, p.name, p.deviceHash, p.nameKey, p.rating, p.rd, p.volatility, p.ratedMatches, p.lastSeen,
          p.mergedInto],
        `saving player ${p.id}`,
      );
    }
    return last;
  }

  /** Every player, for the ratings to hold in memory. */
  async loadPlayers(): Promise<PlayerRow[]> {
    await this.ready;
    const { rows } = await this.sql.query(
      `select id, kind, name, device_hash, name_key, rating, rd, volatility, rated_matches, last_seen, merged_into
       from players`,
    );
    return rows.map(toPlayer);
  }

  /** Let another browser play as a guest. */
  linkGuest(l: GuestLink): Promise<void> {
    return this.write(
      `insert into guest_links (device_hash, name_key, player_id) values ($1, $2, $3)
       on conflict (device_hash, name_key) do update set player_id = $3, linked_at = now()`,
      [l.deviceHash, l.nameKey, l.playerId],
      `linking a browser to ${l.playerId}`,
    );
  }

  async loadLinks(): Promise<GuestLink[]> {
    await this.ready;
    const { rows } = await this.sql.query('select device_hash, name_key, player_id from guest_links');
    return rows.map((r) => ({ deviceHash: String(r.device_hash), nameKey: String(r.name_key), playerId: String(r.player_id) }));
  }

  /** Every match, oldest first, for rebuilding ratings (rerate.ts); or only those
   *  any of `ids` played in. */
  async loadMatches(ids?: string[]): Promise<{ playerIds: string[]; how: string; report: string }[]> {
    await this.ready;
    const { rows } = ids
      ? await this.sql.query(
          'select player_ids, how, report from matches where player_ids && $1::text[] order by ended_at, id',
          [ids],
        )
      : await this.sql.query('select player_ids, how, report from matches order by ended_at, id');
    return rows.map((r) => ({
      playerIds: r.player_ids as string[],
      how: String(r.how),
      report: typeof r.report === 'string' ? r.report : JSON.stringify(r.report),
    }));
  }

  /** Overwrite ratings wholesale, in one transaction: for rebuilding them (rerate.ts). */
  async setRatings(
    ratings: Map<string, { rating: number; rd: number; volatility: number; ratedMatches: number }>,
  ): Promise<void> {
    await this.ready;
    await this.sql.transaction(async (tx) => {
      for (const [id, r] of ratings) {
        await tx.query(
          'update players set rating = $2, rd = $3, volatility = $4, rated_matches = $5 where id = $1',
          [id, r.rating, r.rd, r.volatility, r.ratedMatches],
        );
      }
    });
  }
}

function toPlayer(r: Record<string, unknown>): PlayerRow {
  return {
    id: String(r.id),
    kind: r.kind as PlayerRow['kind'],
    name: String(r.name),
    deviceHash: (r.device_hash as string | null) ?? null,
    nameKey: (r.name_key as string | null) ?? null,
    rating: Number(r.rating),
    rd: Number(r.rd),
    volatility: Number(r.volatility),
    ratedMatches: Number(r.rated_matches),
    lastSeen: new Date(r.last_seen as string),
    mergedInto: (r.merged_into as string | null) ?? null,
  };
}

/** A pg Pool as `Sql`. */
export function poolSql(url: string): Sql {
  // A handful of connections is plenty for a few writes per match.
  const pool = new Pool({ connectionString: url, max: 3 });
  pool.on('error', (e) => console.error(`database: idle connection error: ${e}`));
  return {
    query: (text, params) => pool.query(text, params),
    transaction: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const out = await fn({ query: (t, p) => c.query(t, p), exec: (t) => c.query(t) });
        await c.query('commit');
        return out;
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

/** The production database, or null when DATABASE_URL is not set. */
export function openDb(url = process.env.DATABASE_URL): Db | null {
  return url ? new Db(poolSql(url)) : null;
}
