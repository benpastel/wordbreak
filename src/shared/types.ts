// Shared vocabulary between client and server.
//
// Terms:
//   claim  — a word you have locked. Its tiles are yours until it banks or breaks.
//   break  — take a tile out of someone's claim with a strictly longer word.
//   bank   — a claim's hold time elapses: it converts to points, its tiles vanish.
//   reseed — fresh letters flip into the vacated cells.

export const MIN_GRID = 4;
export const MAX_GRID = 6;
export const MAX_PLAYERS = 10;
export const COLOR_COUNT = 10;
/** The difficulties a bot can be set to, easiest first, as points on the dial every
 *  bot knob runs along (server/bot/knobs.ts); the top of it, 1, is beyond any
 *  person and offered nowhere. Playing alone for three minutes on a 4x4 board,
 *  child claims about 2.3 words a minute and the rest about 2.9, 4.7 and 7.4, for
 *  about 14, 22, 43 and 76 points.
 *
 *  Each also has a fixed rating, measured in the bot tournament (bot/tournament.ts,
 *  40,000 games, about ±20) with intermediate pinned at 1500, and a fixed id so it
 *  is one player across every match and on the leaderboard.
 *
 *  And each is a poet, the same one at every table and on the leaderboard, from
 *  nonsense verse up to sprung rhythm. A second of the same level at one table is
 *  II, a third III. */
export const BOT_LEVELS = [
  { name: 'child', persona: 'Edward Lear', difficulty: 0, rating: -482, id: '00000000-0000-4000-8000-0000000000b0' },
  { name: 'beginner', persona: 'Christina Rossetti', difficulty: 0.15, rating: 305, id: '00000000-0000-4000-8000-0000000000b1' },
  { name: 'intermediate', persona: 'Emily Dickinson', difficulty: 0.35, rating: 1500, id: '00000000-0000-4000-8000-0000000000b2' },
  { name: 'expert', persona: 'John Keats', difficulty: 0.47, rating: 2162, id: '00000000-0000-4000-8000-0000000000b4' },
  { name: 'impossible', persona: 'Gerard Manley Hopkins', difficulty: 0.62, rating: 2868, id: '00000000-0000-4000-8000-0000000000b3' },
] as const;

export const DEFAULT_GRID = 4;

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
export const DEFAULT_TARGET = 30;

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
  /** Set only for a bot: how hard it plays, one of BOT_LEVELS' difficulties. */
  bot?: { difficulty: number };
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
 * With other people it is long enough to look up, and no longer. Alone, or alone
 * with bots, there is nobody to wait for: a timed match gets a beat so its clock
 * doesn't start mid-reach, and a race to points, which nothing is timing, starts
 * at once.
 */
export function countdownFor(humans: number, endMode: EndMode): number {
  if (humans > 1) return 2_000;
  return endMode === 'time' ? 500 : 0;
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

/** A board as it stood at one moment: its letters, row-major, and the claims on it,
 *  each filled as far through its hold as it had got (0 to 1). */
export interface BoardShot {
  letters: string;
  claims: { playerId: string; idx: number[]; fill: number }[];
}

/** What makes a missed word worth showing: the longest anyone could have played,
 *  the one that would have broken the most, and the commonest short word that would
 *  have broken two claims or more. */
export type MissKind = 'longest' | 'biggest' | 'easiest';

/** A word that was there to be played and nobody played. */
export interface MissedWord {
  kind: MissKind;
  word: string;
  /** Its path on the board, row-major cell indexes. */
  idx: number[];
  board: BoardShot;
  /** The claims it would have broken. */
  breaks: { playerId: string; word: string }[];
}

/** One place on the leaderboard. The rating is the cautious one: as low as the
 *  player's true rating plausibly is (server/rating.ts). */
export interface LeaderRow {
  rank: number;
  id: string;
  name: string;
  bot: boolean;
  rating: number;
  matches: number;
}

export interface Leaderboard {
  rows: LeaderRow[];
  /** Your own id on it, as the name you are using now, if you have played. */
  you: string | null;
}

/** The part of the last match only its own player is sent: the words they tried
 *  that were not words, so they can ask for any to be let in. */
export interface MyRecap {
  misses: { word: string; tries: number; requested: boolean }[];
}

/** The match that just finished, word by word. */
export interface Recap {
  words: PlayedWord[];
  durationMs: number;
  missed: MissedWord[];
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
  /** `device` is this browser's secret, never shown to anyone: with it, a returning
   *  tab resumes its player, and with the name it says which guest is playing. */
  | { t: 'hello'; playerId: string | null; device: string; name: string }
  | { t: 'setName'; name: string }
  | { t: 'createTable'; name: string }
  | { t: 'joinTable'; tableId: string }
  | { t: 'leaveTable' }
  | { t: 'setSettings'; settings: Partial<Settings> }
  | { t: 'setColor'; color: number }
  | { t: 'setReady'; ready: boolean }
  | { t: 'start' }
  | { t: 'backToSetup' }
  | { t: 'claim'; tileIds: number[] }
  /** A slid word that was not one, for the server's match report. */
  | { t: 'missed'; word: string; why: string }
  /** After a match: ask for one of your own misses to be added to the dictionary,
   *  or take the request back. */
  | { t: 'requestWord'; word: string; requested: boolean }
  | { t: 'addBot' }
  | { t: 'removeBot'; botId: string }
  | { t: 'setBotDifficulty'; botId: string; difficulty: number }
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; name: string }
  | { t: 'lobby'; tables: TableSummary[] }
  | { t: 'table'; table: TableView; serverNow: number; fx: Fx[]; mine?: MyRecap }
  | { t: 'left' }
  | { t: 'leaderboard'; board: Leaderboard }
  | { t: 'error'; message: string };
