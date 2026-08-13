// Shared vocabulary between client and server.
//
// Terms:
//   claim  — a word you have locked. Its tiles are yours until it banks or breaks.
//   break  — take a tile out of someone's claim with a strictly longer word.
//   bank   — a claim's hold time elapses: it converts to points, its tiles vanish.
//   reseed — fresh letters flip into the vacated cells.

export const MIN_GRID = 4;
export const MAX_GRID = 6;
export const MAX_PLAYERS = 8;
export const COLOR_COUNT = 8;

export const MIN_HOLD_MS = 3_000;
export const MAX_HOLD_MS = 60_000;
export const DEFAULT_HOLD_MS = 30_000;
export const DEFAULT_GRID = 5;

/** A cell of the board. `id` is stable and never reused, so the client can tell
 *  "same tile, new state" from "this cell was reseeded". */
export interface Tile {
  id: number;
  letter: string; // single uppercase A-Z
}

export interface Claim {
  id: string;
  playerId: string;
  /** Ordered path of tile ids — the order the letters were selected in. */
  tileIds: number[];
  word: string;
  claimedAt: number; // server epoch ms
  banksAt: number;   // server epoch ms
}

export interface Player {
  id: string;
  name: string;
  color: number; // 0..COLOR_COUNT-1
  score: number;
  connected: boolean;
  ready: boolean;
}

export interface Settings {
  gridSize: number;
  holdMs: number;
}

export interface GameState {
  size: number;
  /** Row-major, length size*size. */
  grid: Tile[];
  claims: Claim[];
}

export type Phase = 'lobby' | 'playing';

export interface TableView {
  id: string;
  name: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  players: Player[];
  game: GameState | null;
}

export interface TableSummary {
  id: string;
  name: string;
  phase: Phase;
  playerCount: number;
  settings: Settings;
  players: { name: string; color: number }[];
}

/** Animation hints. State snapshots are authoritative; these only say what just
 *  happened so the client knows which transition to play. */
export type Fx =
  | { k: 'claimed'; playerId: string; idx: number[]; word: string }
  | { k: 'broken'; playerId: string; byPlayerId: string; idx: number[]; word: string }
  | {
      k: 'banked';
      playerId: string;
      idx: number[];
      letters: string[]; // the letters as they were, for the fly-to-score clones
      word: string;
      points: number;
    };

export type ClientMsg =
  | { t: 'hello'; playerId: string | null; name: string }
  | { t: 'setName'; name: string }
  | { t: 'createTable'; name: string }
  | { t: 'joinTable'; tableId: string }
  | { t: 'leaveTable' }
  | { t: 'setSettings'; settings: Partial<Settings> }
  | { t: 'setColor'; color: number }
  | { t: 'setReady'; ready: boolean }
  | { t: 'start' }
  | { t: 'claim'; tileIds: number[] };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'lobby'; tables: TableSummary[] }
  | { t: 'table'; table: TableView; serverNow: number; fx: Fx[] }
  | { t: 'left' }
  | { t: 'error'; message: string };
