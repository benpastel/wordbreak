// One match, as it happened, printed as a single JSON line when it ends: every
// claim with rough timings and what became of it, and every word that was tried and
// turned down. For reading play back, and for tuning the bots against how people
// actually play, so bots are recorded the same as everyone else.
//
// Times are seconds into the match, to a tenth.

import type { Medal, Settings } from '../shared/types';

/** Why a word was turned down. The first two are the client's own check on a
 *  slide; the rest are the server refusing a claim the client let through. */
export const MISS_REASONS = [
  'not-a-word',
  'not-long-enough',
  'unknown-tile',
  'not-adjacent',
  'duplicate',
  'empty',
] as const;
export type MissReason = (typeof MISS_REASONS)[number];

/** Rejections kept per player per match, so a client cannot fill the log. */
const MAX_MISSES = 400;

interface Who {
  id: string;
  name: string;
  bot: number | null;
}

interface ClaimEntry {
  s: number;
  p: number;
  w: string;
  banked?: number;
  broken?: number;
  by?: number;
  held?: true;
}

interface MissEntry {
  s: number;
  p: number;
  w: string;
  why: MissReason;
  /** Turned down by the server rather than the player's own client. */
  server?: true;
}

export class MatchLog {
  private players: Who[] = [];
  private claims = new Map<string, ClaimEntry>();
  private misses: MissEntry[] = [];
  private missCount = new Map<number, number>();

  constructor(
    private tableId: string,
    private settings: Settings,
    private startedAt: number,
    players: Who[],
  ) {
    for (const p of players) this.players.push(p);
  }

  private secs(now: number): number {
    return Math.round((now - this.startedAt) / 100) / 10;
  }

  /** A player's index, adding anyone who arrived after the start. */
  private index(who: Who): number {
    const i = this.players.findIndex((p) => p.id === who.id);
    return i >= 0 ? i : this.players.push(who) - 1;
  }

  claimed(claimId: string, who: Who, word: string, now: number): void {
    this.claims.set(claimId, { s: this.secs(now), p: this.index(who), w: word });
  }

  broken(claimId: string, by: Who, now: number): void {
    const c = this.claims.get(claimId);
    if (c) Object.assign(c, { broken: this.secs(now), by: this.index(by) });
  }

  banked(claimId: string, now: number): void {
    const c = this.claims.get(claimId);
    if (c) c.banked = this.secs(now);
  }

  /** Still held when the match ended, and paid out then. */
  held(claimId: string): void {
    const c = this.claims.get(claimId);
    if (c) c.held = true;
  }

  missed(who: Who, word: string, why: MissReason, now: number, server = false): void {
    const p = this.index(who);
    const n = this.missCount.get(p) ?? 0;
    if (n >= MAX_MISSES) return;
    this.missCount.set(p, n + 1);
    this.misses.push({ s: this.secs(now), p, w: word, why, ...(server ? { server: true as const } : {}) });
  }

  /** The finished report. `how` is what ended it; final scores and medals belong to
   *  whoever is still at the table. */
  report(
    how: 'time' | 'points' | 'abandoned',
    now: number,
    finals: Map<string, { score: number; medal?: Medal }>,
  ): string {
    const s = this.settings;
    return JSON.stringify({
      table: this.tableId,
      ended: new Date(now).toISOString(),
      how,
      secs: this.secs(now),
      grid: s.gridSize,
      ...(s.endMode === 'time' ? { timeSecs: s.gameMs / 1000 } : { target: s.targetScore }),
      players: this.players.map((p) => {
        const f = finals.get(p.id);
        return {
          name: p.name,
          bot: p.bot,
          ...(f ? { score: f.score, ...(f.medal ? { medal: f.medal } : {}) } : { left: true }),
        };
      }),
      claims: [...this.claims.values()],
      misses: this.misses,
    });
  }
}
