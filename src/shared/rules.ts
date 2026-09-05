// Pure game rules. Imported by both halves: the server runs them authoritatively,
// the client runs the same checks for instant feedback. No I/O, no clock reads —
// every function that needs "now" takes it as an argument, which is also what makes
// swapping the in-memory store for a database a contained change later.

import { drawLetter, WEIGHTS } from './letters';
import {
  MAX_GAME_MS, MAX_GRID, MAX_HOLD_MS, MAX_TARGET, MEDALS,
  MIN_GAME_MS, MIN_GRID, MIN_HOLD_MS, MIN_TARGET,
} from './types';
import type {
  Award, BreakNote, Claim, ClaimRecord, EndMode, GameState, MatchStats, Medal, Settings, Tile,
} from './types';

export type AllocId = () => number;

export function makeGrid(size: number, allocId: AllocId, now: number): Tile[] {
  const grid: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    grid.push({ id: allocId(), letter: drawLetter(grid.map((t) => t.letter)), bornAt: now });
  }
  return grid;
}

export function newGame(
  size: number,
  allocId: AllocId,
  endsAt: number | null,
  now: number,
): GameState {
  return { size, grid: makeGrid(size, allocId, now), claims: [], endsAt };
}

export function tileIndex(game: GameState, tileId: number): number {
  return game.grid.findIndex((t) => t.id === tileId);
}

/** The 8 touching neighbours, by row-major index. Diagonals count. */
export function areAdjacent(size: number, a: number, b: number): boolean {
  if (a === b) return false;
  const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size));
  const dc = Math.abs((a % size) - (b % size));
  return dr <= 1 && dc <= 1;
}

export function claimOfTile(game: GameState, tileId: number): Claim | undefined {
  return game.claims.find((c) => c.tileIds.includes(tileId));
}

/** Claims are always disjoint — see the note on `canAppend` — so this is a partition. */
export function claimsTouching(game: GameState, tileIds: number[]): Claim[] {
  const ids = new Set(tileIds);
  return game.claims.filter((c) => c.tileIds.some((id) => ids.has(id)));
}

export function wordOf(game: GameState, tileIds: number[]): string {
  return tileIds
    .map((id) => game.grid.find((t) => t.id === id)?.letter ?? '')
    .join('')
    .toLowerCase();
}

/**
 * May `selection` be extended with `tileId`?
 *
 * Path rules only: adjacency, and no letter twice. Deliberately says nothing about
 * claims — any letter on the board can always be selected, because at the moment you
 * click you do not yet know how long the word will be. Gating the click would make it
 * impossible to start a long word that happens to pass through a short claim.
 *
 * The length rule lives in `validatePath`, on the claim.
 */
export function canAppend(game: GameState, selection: number[], tileId: number): boolean {
  if (selection.includes(tileId)) return false;
  const i = tileIndex(game, tileId);
  if (i < 0) return false;

  if (selection.length === 0) return true;
  const j = tileIndex(game, selection[selection.length - 1]);
  return j >= 0 && areAdjacent(game.size, i, j);
}

export type PathError =
  | 'empty'
  | 'unknown-tile'
  | 'duplicate'
  | 'not-adjacent'
  | 'not-long-enough';

/**
 * The gate on actually taking a word. This is where the length rule lives: the word
 * you end up with must be strictly longer than every claim it touches, which is what
 * keeps live claims disjoint — any word reaching into one destroys it outright.
 *
 * Symmetric by design: your own claims are no easier to break than anyone else's.
 * Extending still works because the trail already holds those letters and so is
 * already longer (DO -> DOG is 3 against 2).
 *
 * Also the server's re-validation of a claim: it never trusts the client, and a path
 * can go stale between send and receive.
 */
export function validatePath(game: GameState, tileIds: number[]): PathError | null {
  if (tileIds.length === 0) return 'empty';
  if (new Set(tileIds).size !== tileIds.length) return 'duplicate';

  const idxs = tileIds.map((id) => tileIndex(game, id));
  if (idxs.some((i) => i < 0)) return 'unknown-tile';

  for (let k = 1; k < idxs.length; k++) {
    if (!areAdjacent(game.size, idxs[k - 1], idxs[k])) return 'not-adjacent';
  }

  for (const c of claimsTouching(game, tileIds)) {
    if (tileIds.length <= c.tileIds.length) return 'not-long-enough';
  }
  return null;
}

export interface ClaimResult {
  claim: Claim;
  /** Claims destroyed by this one — a claim is atomic, so touching any tile kills it whole. */
  broken: Claim[];
}

export function applyClaim(
  game: GameState,
  tileIds: number[],
  playerId: string,
  word: string,
  now: number,
  holdMs: number,
  claimId: string,
): ClaimResult {
  const broken = claimsTouching(game, tileIds);
  const brokenIds = new Set(broken.map((c) => c.id));
  game.claims = game.claims.filter((c) => !brokenIds.has(c.id));

  const claim: Claim = {
    id: claimId,
    playerId,
    tileIds: [...tileIds],
    word,
    claimedAt: now,
    banksAt: now + holdMs,
  };
  game.claims.push(claim);
  return { claim, broken };
}

export interface BankResult {
  points: number;
  idx: number[];
  letters: string[];
}

/** Hold time elapsed: score one point per letter, vacate the tiles, reseed them. */
export function bankClaim(
  game: GameState,
  claim: Claim,
  allocId: AllocId,
  now: number,
): BankResult {
  const idx = claim.tileIds.map((id) => tileIndex(game, id)).filter((i) => i >= 0);
  const letters = idx.map((i) => game.grid[i].letter);

  game.claims = game.claims.filter((c) => c.id !== claim.id);

  const vacating = new Set(idx);
  for (const i of idx) {
    const survivors = game.grid.filter((_, j) => !vacating.has(j)).map((t) => t.letter);
    game.grid[i] = { id: allocId(), letter: drawLetter(survivors), bornAt: now };
    vacating.delete(i);
  }

  return { points: claim.tileIds.length, idx, letters };
}

/**
 * A crude stand-in for how obscure a word is: rarer letters score higher, using the
 * same weights the bag is drawn from. It is not corpus frequency — it cannot tell a
 * common word from an odd one — but it reliably surfaces the JAZZY over the RATES,
 * which is what the write-up is for.
 */
export function rarity(word: string): number {
  let total = 0;
  for (const ch of word.toUpperCase()) total += 1 / (WEIGHTS[ch] ?? 1);
  return total;
}

/** The end-of-match write-up: one holder per award, plus the biggest thefts. */
export function computeStats(log: ClaimRecord[]): MatchStats {
  const awards: Award[] = [];

  const award = (
    kind: Award['kind'],
    pool: ClaimRecord[],
    better: (a: ClaimRecord, b: ClaimRecord) => boolean,
    detail: (c: ClaimRecord) => string,
  ) => {
    if (pool.length === 0) return;
    const winner = pool.reduce((a, b) => (better(a, b) ? b : a));
    awards.push({ kind, playerId: winner.playerId, word: winner.word, detail: detail(winner) });
  };

  award('longest', log, (a, b) => b.word.length > a.word.length, (c) => `${c.word.length} letters`);
  award('shortest', log, (a, b) => b.word.length < a.word.length, (c) => `${c.word.length} letters`);
  award('obscure', log, (a, b) => rarity(b.word) > rarity(a.word), () => 'rarest letters');
  award(
    'fastest',
    log.filter((c) => c.reactionMs !== null),
    (a, b) => (b.reactionMs as number) < (a.reactionMs as number),
    (c) => `${((c.reactionMs as number) / 1000).toFixed(1)}s after it landed`,
  );

  type Broke = ClaimRecord & { broke: { playerId: string; word: string } };
  const breaks: BreakNote[] = log
    .filter((c): c is Broke => c.broke !== null)
    // Biggest jump in length first: taking a 3 with an 8 is the story, a 3 with a 4 is not.
    .sort((a, b) => b.word.length - b.broke.word.length - (a.word.length - a.broke.word.length))
    .slice(0, 4)
    .map((c) => ({
      byPlayerId: c.playerId,
      word: c.word,
      overPlayerId: c.broke.playerId,
      overWord: c.broke.word,
    }));

  return { awards, breaks };
}

/**
 * Live claims grouped by owner and ordered for display: longest first, and within a
 * length the one nearest banking on top. So the head of each list is the biggest and
 * most imminent, and truncating from the bottom only ever drops the least consequential.
 */
export function claimsByPlayer(claims: Claim[]): Map<string, Claim[]> {
  const byPlayer = new Map<string, Claim[]>();
  for (const c of claims) {
    const arr = byPlayer.get(c.playerId);
    if (arr) arr.push(c);
    else byPlayer.set(c.playerId, [c]);
  }
  for (const arr of byPlayer.values()) {
    arr.sort((x, y) => y.tileIds.length - x.tileIds.length || x.banksAt - y.banksAt);
  }
  return byPlayer;
}

const END_MODES: EndMode[] = ['time', 'points', 'unlimited'];

/** The server's floor and ceiling on what a client may ask for. Bounds come from the
 *  shared constants so the lobby cannot offer a value this would reject, or vice versa. */
export function clampSettings(s: Settings): Settings {
  return {
    gridSize: Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(s.gridSize))),
    holdMs: Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.round(s.holdMs))),
    endMode: END_MODES.includes(s.endMode) ? s.endMode : 'points',
    gameMs: Math.max(MIN_GAME_MS, Math.min(MAX_GAME_MS, Math.round(s.gameMs))),
    targetScore: Math.max(MIN_TARGET, Math.min(MAX_TARGET, Math.round(s.targetScore))),
  };
}

/**
 * Who finished in the top three, by standard competition ranking: a tie for first
 * gives two golds and no silver. Scoring nothing wins nothing, so a quiet match can
 * end with no medals at all.
 */
export function medalsFor(players: { id: string; score: number }[]): Record<string, Medal> {
  const out: Record<string, Medal> = {};
  for (const p of players) {
    if (p.score <= 0) continue;
    const ahead = players.filter((q) => q.score > p.score).length;
    if (ahead < MEDALS.length) out[p.id] = MEDALS[ahead];
  }
  return out;
}
