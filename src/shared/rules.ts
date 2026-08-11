// Pure game rules. Imported by both halves: the server runs them authoritatively,
// the client runs the same checks for instant feedback. No I/O, no clock reads —
// every function that needs "now" takes it as an argument, which is also what makes
// swapping the in-memory store for a database a contained change later.

import { drawLetter } from './letters';
import type { Claim, GameState, Tile } from './types';

export type AllocId = () => number;

export function makeGrid(size: number, allocId: AllocId): Tile[] {
  const grid: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    grid.push({ id: allocId(), letter: drawLetter(grid.map((t) => t.letter)) });
  }
  return grid;
}

export function newGame(size: number, allocId: AllocId): GameState {
  return { size, grid: makeGrid(size, allocId), claims: [] };
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
export function bankClaim(game: GameState, claim: Claim, allocId: AllocId): BankResult {
  const idx = claim.tileIds.map((id) => tileIndex(game, id)).filter((i) => i >= 0);
  const letters = idx.map((i) => game.grid[i].letter);

  game.claims = game.claims.filter((c) => c.id !== claim.id);

  const vacating = new Set(idx);
  for (const i of idx) {
    const survivors = game.grid.filter((_, j) => !vacating.has(j)).map((t) => t.letter);
    game.grid[i] = { id: allocId(), letter: drawLetter(survivors) };
    vacating.delete(i);
  }

  return { points: claim.tileIds.length, idx, letters };
}

export function clampSettings(gridSize: number, holdMs: number, min: number, max: number) {
  return {
    gridSize: Math.max(3, Math.min(7, Math.round(gridSize))),
    holdMs: Math.max(min, Math.min(max, Math.round(holdMs))),
  };
}
