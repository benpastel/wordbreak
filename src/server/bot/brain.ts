// One bot's mind. It plays the way a person does, one move at a time:
//
//   reorient → search → enter → claim → reorient → …
//
// Search is a race. Every word the bot knows that is on the board, and claimable,
// carries its own clock — how long until the bot happens to notice it — and the
// first to run out is the word it plays. Short, common, forwards-reading words in
// the patch it is looking at have fast clocks; long, rare, backwards or distant ones
// slow clocks. So one mechanism decides both how long a move takes and how long the
// word is. Difficulty only changes the clocks (knobs.ts).
//
// Attention is the limit. Nothing is noticed while selecting tiles or recovering
// from a claim, and a half-noticed word keeps only part of its progress into the
// next search.
//
// Driven by tick(), with the clock passed in, so the live server and the simulator
// run exactly the same mind.

import * as R from '../../shared/rules';
import type { GameState } from '../../shared/types';
import { corpusRank } from '../frequency';
import { isBlocked, isFamiliarShort } from './wordlists';
import { findPaths } from './finder';
import { knobsFor, MAX_LEN, MIN_LEN } from './knobs';
import type { Knobs } from './knobs';
import { hash01, jitter, normal, seeded } from './rng';
import type { Rng } from './rng';

/** Rank given to words the corpus never saw: rarer than everything it did. */
const UNRANKED = 250_000;
/** Rank below which rarity costs nothing. */
const COMMON = 300;
/** Median of the effort distribution (gamma, shape 2), so a word's median spot time
 *  comes out as its median, not as its mean. */
const EFFORT_MEDIAN = 1.678;

export interface BotAction {
  tileIds: number[];
}

interface Breakable {
  claimedAt: number;
  banksAt: number;
}

interface Cand {
  tileIds: number[];
  idx: number[];
  /** Median ms to spot it from length, rarity and shape alone. */
  base: number;
  /** How much noticing it takes, drawn once; it is found when progress reaches it. */
  effort: number;
  progress: number;
  valid: boolean;
  /** Other players' claims this word would break. */
  breaks: Breakable[];
  /** Its own claims this word would break. */
  own: Breakable[];
}

/** Cost of one step by direction [dr, dc]. Reading order is cheapest. */
function stepCost(dr: number, dc: number): number {
  if ((dr === 0 && dc === 1) || (dr === 1 && dc === 0)) return 1;
  if (dr === 1 && dc === 1) return 1.3;
  if ((dr === 1 && dc === -1) || (dr === -1 && dc === 1)) return 1.6;
  if ((dr === 0 && dc === -1) || (dr === -1 && dc === 0)) return 1.8;
  return 2; // up and to the left
}
const TURN_COST = 1.25;

/** How far through its hold a claim is, 0 to 1. */
function fillOf(c: Breakable, now: number): number {
  return Math.max(0, Math.min(1, (now - c.claimedAt) / Math.max(1, c.banksAt - c.claimedAt)));
}

export class Brain {
  readonly knobs: Knobs;
  private rng: Rng;
  private sig = '';
  private gridSig = '';
  private cands = new Map<string, Cand>();
  /** Tile id -> when this bot first saw it. */
  private seenAt = new Map<number, number>();
  private seenClaims = new Set<string>();
  private fx = 0;
  private fy = 0;
  private phase: 'start' | 'reorient' | 'search' | 'enter' = 'start';
  private until = 0;
  private pending: number[] | null = null;

  constructor(
    readonly playerId: string,
    difficulty: number,
    private seed: number,
  ) {
    this.knobs = knobsFor(difficulty);
    this.rng = seeded(seed);
  }

  /** Advance by dt ms to `now`. Returns a claim when the bot finishes selecting one.
   *  The claim may fail if the board moved meanwhile, as a person's would. */
  tick(game: GameState, now: number, dt: number): BotAction | null {
    if (this.phase === 'start') {
      this.fx = this.rng() * (game.size - 1);
      this.fy = this.rng() * (game.size - 1);
      this.phase = 'reorient';
      this.until = now + this.knobs.reorientMs * jitter(this.rng, 0.35);
    }
    this.sync(game, now);
    this.drift(game.size, dt);

    switch (this.phase) {
      case 'reorient':
        if (now >= this.until) this.phase = 'search';
        return null;
      case 'enter': {
        if (now < this.until || !this.pending) return null;
        const tileIds = this.pending;
        this.pending = null;
        this.afterClaim(game, tileIds, now);
        return { tileIds };
      }
      case 'search': {
        const found = this.search(game, now, dt);
        if (!found) return null;
        const k = this.knobs;
        this.pending = found.tileIds;
        this.phase = 'enter';
        this.until = now + (k.hesitateMs + k.perTileMs * found.tileIds.length) * jitter(this.rng, 0.25);
        return null;
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ seeing

  /** Bring what the bot knows up to date with the board, if it changed. */
  private sync(game: GameState, now: number): void {
    const gridSig = game.grid.map((t) => t.id).join(',');
    const sig = `${gridSig}|${game.claims.map((c) => c.id).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;

    for (const t of game.grid) if (!this.seenAt.has(t.id)) this.seenAt.set(t.id, now);

    // Someone else's fresh claim can pull the eye to it.
    for (const c of game.claims) {
      if (this.seenClaims.has(c.id)) continue;
      this.seenClaims.add(c.id);
      if (c.playerId !== this.playerId && this.rng() < this.knobs.attend) {
        this.lookAt(game.size, c.tileIds.map((id) => R.tileIndex(game, id)), 0.4);
      }
    }

    if (gridSig !== this.gridSig) {
      this.gridSig = gridSig;
      this.rebuild(game);
    }

    const byTile = new Map<number, GameState['claims'][number]>();
    for (const c of game.claims) for (const id of c.tileIds) byTile.set(id, c);
    for (const cand of this.cands.values()) {
      cand.valid = R.validatePath(game, cand.tileIds) === null;
      cand.breaks = [];
      cand.own = [];
      const hit = new Set<string>();
      for (const id of cand.tileIds) {
        const c = byTile.get(id);
        if (!c || hit.has(c.id)) continue;
        hit.add(c.id);
        const b = { claimedAt: c.claimedAt, banksAt: c.banksAt };
        if (c.playerId === this.playerId) cand.own.push(b);
        else cand.breaks.push(b);
      }
    }
  }

  /** Re-read the board after tiles changed. Words still standing keep their progress. */
  private rebuild(game: GameState): void {
    const letters = game.grid.map((t) => t.letter);
    const next = new Map<string, Cand>();
    for (const f of findPaths(letters, game.size, MIN_LEN, MAX_LEN)) {
      if (!this.knows(f.word)) continue;
      const tileIds = f.idx.map((i) => game.grid[i].id);
      const key = tileIds.join(',');
      const prev = this.cands.get(key);
      next.set(
        key,
        prev ?? {
          tileIds,
          idx: f.idx,
          base: this.baseMs(f.word, f.idx, game.size),
          effort: -Math.log(Math.max(this.rng(), 1e-12)) - Math.log(Math.max(this.rng(), 1e-12)),
          progress: 0,
          valid: false,
          breaks: [],
          own: [],
        },
      );
    }
    this.cands = next;
  }

  /** Whether this bot knows a word at all. Fixed for the life of the bot. */
  private knows(word: string): boolean {
    if (isBlocked(word)) return false;
    const rank = corpusRank(word) ?? UNRANKED;
    let p = 1 / (1 + (rank / this.knobs.vocabRank) ** 2);
    if (word.length <= 3 && !isFamiliarShort(word)) p *= this.knobs.oddShort;
    return hash01(this.seed, word) < p;
  }

  private baseMs(word: string, idx: number[], size: number): number {
    const k = this.knobs;
    const rank = corpusRank(word) ?? UNRANKED;
    let shape = 1;
    let prev = '';
    for (let i = 1; i < idx.length; i++) {
      const dr = Math.floor(idx[i] / size) - Math.floor(idx[i - 1] / size);
      const dc = (idx[i] % size) - (idx[i - 1] % size);
      shape *= stepCost(dr, dc);
      const dir = `${dr},${dc}`;
      if (prev && dir !== prev) shape *= TURN_COST;
      prev = dir;
    }
    return (
      k.spot3Ms *
      (word.length === 2 ? k.twoLetter : k.perLetter ** (word.length - 3)) *
      Math.max(1, rank / COMMON) ** k.rarity *
      shape ** k.shape
    );
  }

  // --------------------------------------------------------------- attention

  private lookAt(size: number, idx: number[], spread: number): void {
    const xs = idx.filter((i) => i >= 0);
    if (!xs.length) return;
    const cx = xs.reduce((s, i) => s + (i % size), 0) / xs.length;
    const cy = xs.reduce((s, i) => s + Math.floor(i / size), 0) / xs.length;
    this.fx = this.clamp(cx + normal(this.rng) * spread, size);
    this.fy = this.clamp(cy + normal(this.rng) * spread, size);
  }

  private drift(size: number, dt: number): void {
    if (this.phase !== 'search') return;
    const step = this.knobs.drift * Math.sqrt(dt / 1000);
    this.fx = this.clamp(this.fx + normal(this.rng) * step, size);
    this.fy = this.clamp(this.fy + normal(this.rng) * step, size);
  }

  private clamp(v: number, size: number): number {
    return Math.max(0, Math.min(size - 1, v));
  }

  // ------------------------------------------------------------------ search

  private search(game: GameState, now: number, dt: number): Cand | null {
    const k = this.knobs;
    let best: Cand | null = null;
    let bestOver = 1;
    for (const c of this.cands.values()) {
      if (!c.valid) continue;

      let dist = Infinity;
      for (const i of c.idx) {
        dist = Math.min(dist, Math.hypot((i % game.size) - this.fx, Math.floor(i / game.size) - this.fy));
      }
      let ms = c.base;
      if (dist > k.focusRadius) ms *= Math.exp((dist - k.focusRadius) / k.focusFalloff);

      // A tile that just appeared has not quite registered yet.
      let youngest = Infinity;
      for (const id of c.tileIds) youngest = Math.min(youngest, now - (this.seenAt.get(id) ?? now));
      if (youngest < k.freshMs) ms *= 1 + 3 * (1 - youngest / k.freshMs);

      // The most tempting claim it would break decides the pull. A claim that has
      // only just landed has to be read before a longer word through it occurs.
      let pull = c.breaks.length ? 0 : 1;
      let newest = Infinity;
      for (const b of c.breaks) {
        pull = Math.max(pull, k.breakPull * (1 + k.urgency * fillOf(b, now)));
        newest = Math.min(newest, now - b.claimedAt);
      }
      if (newest < k.newClaimMs) ms *= 1 + 3 * (1 - newest / k.newClaimMs);
      if (c.own.length) {
        const fill = Math.max(...c.own.map((o) => fillOf(o, now)));
        pull *= k.ownPull * (1 - fill) ** k.ownAversion;
      }
      ms /= pull;

      c.progress += (EFFORT_MEDIAN * dt) / ms;
      const over = c.progress / c.effort;
      if (over >= bestOver) {
        best = c;
        bestOver = over;
      }
    }
    return best;
  }

  private afterClaim(game: GameState, tileIds: number[], now: number): void {
    // Eyes stay roughly where the hands just were.
    this.lookAt(game.size, tileIds.map((id) => R.tileIndex(game, id)), 0.7);
    for (const c of this.cands.values()) c.progress *= this.knobs.memory;
    this.phase = 'reorient';
    this.until = now + this.knobs.reorientMs * jitter(this.rng, 0.35);
  }
}
