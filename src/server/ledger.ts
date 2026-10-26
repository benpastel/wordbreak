// Who has played, how they are rated, and the leaderboard. Held in memory, loaded
// from the database at startup and written back after every match, so nothing here
// is ever on the path of a claim.
//
// A guest is a browser and a name together (the browser known only by the hash of
// its secret), so people sharing one browser are rated apart by the names they play
// under. Each bot level is a single fixed player with a measured rating.
//
// Every match is kept with its players' ids and the full report, rating changes
// included, which is enough to recompute every rating from the first match on under
// different rules.

import { randomUUID } from 'node:crypto';
import { BOT_LEVELS } from '../shared/types';
import type { Leaderboard, LeaderRow } from '../shared/types';
import type { Db, PlayerRow } from './db';
import { INITIAL, rateMatch, shown } from './rating';
import type { Entrant, Rating } from './rating';

/** Rows sent for the leaderboard; anyone further down sees their own row added. */
const BOARD_SIZE = 100;

export interface Seat {
  /** Hash of the browser's secret; null for a bot. */
  device: string | null;
  name: string;
  /** A bot's difficulty, or null for a person. */
  bot: number | null;
  /** Final score, or null for someone who left before the end. */
  score: number | null;
}

export interface MatchRecord {
  tableId: string;
  endedAt: Date;
  how: 'time' | 'points' | 'abandoned';
  seats: Seat[];
  /** MatchLog's JSON report, in seat order. */
  report: string;
}

export const nameKey = (name: string) => name.trim().toLowerCase();

/** The named level a bot's difficulty belongs to. */
export function levelOf(difficulty: number) {
  return BOT_LEVELS.reduce((a, b) => (Math.abs(b.difficulty - difficulty) < Math.abs(a.difficulty - difficulty) ? b : a));
}

export class Ledger {
  private byId = new Map<string, PlayerRow>();
  private byGuest = new Map<string, PlayerRow>();
  readonly ready: Promise<void>;

  constructor(private db: Db | null) {
    this.ready = (db ? db.loadPlayers() : Promise.resolve([])).then(
      (rows) => {
        for (const r of rows) this.index(r);
        this.seatBots();
      },
      (e) => {
        // Rated play goes on from scratch rather than not at all; nothing already
        // stored is overwritten, since only players who play get written.
        console.error(`ledger: could not load players: ${e}`);
        this.seatBots();
      },
    );
  }

  private index(r: PlayerRow): void {
    this.byId.set(r.id, r);
    if (r.kind === 'guest' && r.deviceHash && r.nameKey) this.byGuest.set(`${r.deviceHash}\n${r.nameKey}`, r);
  }

  /** The bot levels, at their measured ratings, with no uncertainty. */
  private seatBots(): void {
    const changed: PlayerRow[] = [];
    for (const l of BOT_LEVELS) {
      const had = this.byId.get(l.id);
      if (had && had.rating === l.rating && had.rd === 0 && had.name === l.persona) continue;
      const row: PlayerRow = {
        id: l.id,
        kind: 'bot',
        name: l.persona,
        deviceHash: null,
        nameKey: null,
        rating: l.rating,
        rd: 0,
        volatility: INITIAL.volatility,
        ratedMatches: had?.ratedMatches ?? 0,
        lastSeen: had?.lastSeen ?? new Date(),
      };
      this.index(row);
      changed.push(row);
    }
    if (changed.length) void this.db?.savePlayers(changed);
  }

  /** The guest playing as `name` on this browser, if they have played before. */
  guestId(device: string | null | undefined, name: string): string | null {
    if (!device || !name.trim()) return null;
    return this.byGuest.get(`${device}\n${nameKey(name)}`)?.id ?? null;
  }

  private seatRow(seat: Seat, at: Date): PlayerRow {
    if (seat.bot !== null) return this.byId.get(levelOf(seat.bot).id)!;
    const key = seat.device ? `${seat.device}\n${nameKey(seat.name)}` : null;
    const had = key ? this.byGuest.get(key) : undefined;
    if (had) return had;
    const row: PlayerRow = {
      id: randomUUID(),
      kind: 'guest',
      name: seat.name,
      deviceHash: seat.device,
      nameKey: nameKey(seat.name),
      ...INITIAL,
      ratedMatches: 0,
      lastSeen: at,
    };
    this.index(row);
    return row;
  }

  /** Rate a finished match and keep it. Abandoned matches are kept but not rated. */
  async record(m: MatchRecord): Promise<void> {
    await this.ready;
    const rows = m.seats.map((s) => this.seatRow(s, m.endedAt));
    const before = rows.map((r): Rating => ({ rating: r.rating, rd: r.rd, volatility: r.volatility }));
    const rated = m.how !== 'abandoned' && rows.length > 1;
    if (rated) {
      const entrants: Entrant[] = rows.map((r, i) => ({
        id: r.id,
        rating: before[i],
        fixed: r.kind === 'bot',
        score: m.seats[i].score,
      }));
      const after = rateMatch(entrants);
      for (const r of rows) {
        if (r.kind === 'bot') continue;
        Object.assign(r, after.get(r.id));
        r.ratedMatches++;
      }
    }
    rows.forEach((r, i) => {
      if (r.kind === 'bot') return;
      r.name = m.seats[i].name;
      r.lastSeen = m.endedAt;
    });

    const report = JSON.parse(m.report);
    report.ratings = rows.map((r, i) => ({
      id: r.id,
      before: before[i],
      ...(rated ? { after: { rating: r.rating, rd: r.rd, volatility: r.volatility } } : {}),
    }));
    // Queued, not awaited: the queue keeps them in order and retries them, and the
    // leaderboard should not wait on the database to show the new ratings.
    if (this.db) {
      void this.db.savePlayers(rows.filter((r) => r.kind !== 'bot'));
      void this.db.saveMatch({
        tableId: m.tableId,
        endedAt: m.endedAt,
        how: m.how,
        playerIds: rows.map((r) => r.id),
        report: JSON.stringify(report),
      });
    }
  }

  /** The top of the board by shown rating, bots included, with you added at the
   *  bottom if you are further down. */
  leaderboard(you: string | null): Leaderboard {
    const all = [...this.byId.values()]
      .filter((r) => r.kind === 'bot' || r.ratedMatches > 0)
      .map((r) => ({ r, shown: shown(r) }))
      .sort((a, b) => b.shown - a.shown);
    const row = ({ r, shown: s }: (typeof all)[number], i: number): LeaderRow => ({
      rank: i + 1,
      id: r.id,
      name: r.name,
      bot: r.kind === 'bot',
      rating: Math.round(s),
      matches: r.ratedMatches,
    });
    const rows = all.slice(0, BOARD_SIZE).map(row);
    const at = you ? all.findIndex((e) => e.r.id === you) : -1;
    if (at >= BOARD_SIZE) rows.push(row(all[at], at));
    return { rows, you: at >= 0 ? you : null };
  }
}

/** Every rating, recomputed from stored matches alone, oldest first: proof that the
 *  history is enough, and the way to re-rate everyone after changing the rules or a
 *  bot's rating. Each match's report lists its players in the same order as its ids. */
export function replay(matches: { playerIds: string[]; how: string; report: string }[]): Map<string, Rating> {
  const ratings = new Map<string, Rating>();
  for (const m of matches) {
    if (m.how === 'abandoned' || m.playerIds.length < 2) continue;
    const players: { bot: number | null; score?: number }[] = JSON.parse(m.report).players;
    const entrants: Entrant[] = m.playerIds.map((id, i) => {
      const bot = players[i].bot;
      return {
        id,
        rating: bot !== null ? { rating: levelOf(bot).rating, rd: 0, volatility: INITIAL.volatility } : (ratings.get(id) ?? INITIAL),
        fixed: bot !== null,
        score: players[i].score ?? null,
      };
    });
    for (const [id, r] of rateMatch(entrants)) if (!entrants.find((e) => e.id === id)!.fixed) ratings.set(id, r);
  }
  return ratings;
}
