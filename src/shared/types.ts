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

export const DEFAULT_GRID = 5;

/** How long a claim must survive to bank, by board size. Not a setting: a bigger
 *  board has more letters to search for a word long enough to break with, so the
 *  hold grows with it. */
export const HOLD_MS: Record<number, number> = { 4: 13_000, 5: 18_000, 6: 26_000 };

/** How a match finishes. */
export type EndMode = 'time' | 'points';

export const MIN_GAME_MS = 30_000;
export const MAX_GAME_MS = 1_800_000;
export const DEFAULT_GAME_MS = 300_000;

export const MIN_TARGET = 10;
export const MAX_TARGET = 1_000;
export const DEFAULT_TARGET = 50;

export const DEFAULT_END_MODE: EndMode = 'points';

export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDALS: Medal[] = ['gold', 'silver', 'bronze'];
/** Won across every match at this table; scores reset each match, these do not. */
export type Trophies = Record<Medal, number>;

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
  trophies: Trophies;
  connected: boolean;
  ready: boolean;
}

export interface Settings {
  gridSize: number;
  endMode: EndMode;
  /** Used when endMode is 'time'. */
  gameMs: number;
  /** Used when endMode is 'points': first to reach it ends the match. */
  targetScore: number;
}

export interface GameState {
  size: number;
  /** Row-major, length size*size. */
  grid: Tile[];
  claims: Claim[];
  /** Server epoch ms, or null when the match is not on a clock. */
  endsAt: number | null;
}

export type Phase = 'lobby' | 'playing' | 'ended';

export interface ChatMessage {
  id: string;
  playerId: string;
  /** Name and colour as they were when it was sent, so history stays readable
   *  after someone renames or recolours. */
  name: string;
  color: number;
  text: string;
  at: number;
}
export const MAX_CHAT = 200;
export const MAX_CHAT_LEN = 240;

/**
 * Warning between the table agreeing and the board appearing.
 *
 * Playing alone there is nobody to wait for and nothing to brace against, so it is
 * barely a pause. With company it is long enough to look up, and no longer.
 */
export function countdownFor(players: number): number {
  return players <= 1 ? 1_000 : 3_000;
}

/** One claim as it happened, for the end-of-match timeline. */
export interface PlayedWord {
  playerId: string;
  word: string;
  /** Milliseconds after the match began. */
  at: number;
  /** Whoever broke it, which can be the player who claimed it. Null if it banked. */
  brokenBy: string | null;
  definition?: string;
}

/** The match that just finished, word by word. */
export interface Recap {
  words: PlayedWord[];
  durationMs: number;
}

export interface TableView {
  id: string;
  name: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  players: Player[];
  game: GameState | null;
  chat: ChatMessage[];
  /** The last finished match, kept until the next one starts. */
  recap: Recap | null;
  /** Set once the table has agreed to play; the board appears when it passes. */
  startsAt: number | null;
  /** How long that countdown runs in total, so the fill has a denominator. It
   *  varies with the table size and cannot be re-derived once players come and go
   *  mid-countdown, so it travels with startsAt rather than being recomputed. */
  countdownMs: number | null;
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
    }
  /** The clock ran out. Carries the medals awarded so the client can celebrate the
   *  moment it happened, rather than re-firing every time a snapshot arrives. */
  | { k: 'ended'; medals: Record<string, Medal> };

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
  | { t: 'claim'; tileIds: number[] }
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'lobby'; tables: TableSummary[] }
  | { t: 'table'; table: TableView; serverNow: number; fx: Fx[] }
  | { t: 'left' }
  | { t: 'error'; message: string };
