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

/** How a match finishes. */
export type EndMode = 'time' | 'points' | 'unlimited';

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
  /** When this letter appeared. Used to time reactions to a reseed. */
  bornAt: number;
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
  holdMs: number;
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

/** Seconds of warning between the table agreeing and the board appearing. */
export const COUNTDOWN_MS = 5_000;

export type AwardKind =
  | 'longest'
  | 'shortest'
  | 'hardest'
  | 'obscure'
  | 'fastest'
  | 'repeat';

/** How many times you must find the same word before it is worth mentioning. */
export const REPEAT_THRESHOLD = 3;

export interface Award {
  kind: AwardKind;
  playerId: string;
  word: string;
  /** Pre-rendered supporting text, e.g. "1.4s". */
  detail: string;
}

export interface BreakNote {
  byPlayerId: string;
  word: string;
  overPlayerId: string;
  overWord: string;
}

/** Everything worth saying about the match that just finished. */
export interface MatchStats {
  awards: Award[];
  breaks: BreakNote[];
}

/** One claim as it happened, kept for the end-of-match write-up. */
export interface ClaimRecord {
  playerId: string;
  word: string;
  at: number;
  /** Time from the newest letter it used appearing to the claim landing, when that
   *  letter arrived mid-match. Null for words built only from the opening board. */
  reactionMs: number | null;
  broke: { playerId: string; word: string } | null;
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
  /** The write-up for the last finished match, kept until the next one starts. */
  stats: MatchStats | null;
  /** Set once the table has agreed to play; the board appears when it passes. */
  startsAt: number | null;
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
