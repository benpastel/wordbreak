// The authoritative game hub. Owns every table, every claim, and every hold-time
// timer. Clients send intents; the hub validates against current state and pushes
// a fresh snapshot plus a few animation hints.

import { randomUUID } from 'node:crypto';
import {
  BOT_LEVELS, COLOR_COUNT, countdownFor, DEFAULT_END_MODE, DEFAULT_GAME_MS, DEFAULT_GRID,
  DEFAULT_TARGET, MAX_CHAT, MAX_CHAT_LEN, MAX_PLAYERS,
} from '../shared/types';
import type {
  EndMode, Fx, Medal, MyRecap, Player, ServerMsg, Settings, TableSummary, TableView, Trophies,
} from '../shared/types';
import * as R from '../shared/rules';
import { Brain } from './bot/brain';
import { isWord } from './dictionary';
import { define } from './definitions';
import { MatchLog, MISS_REASONS } from './matchlog';
import type { MissReason } from './matchlog';
import { createHash } from 'node:crypto';
import type { Db } from './db';
import { Ledger, levelOf } from './ledger';
import { Scout } from './missed';
import { MemoryStore } from './store';
import type { PlayerRecord, Store, TableRecord } from './store';

type Send = (playerId: string, msg: ServerMsg) => void;

const DISCONNECT_GRACE_MS = 120_000;
/** How often the bots at a table look at the board. */
const BOT_TICK_MS = 100;
const DEFAULT_BOT_DIFFICULTY = 0.35;
/** Numerals for a second, third... bot of one level at a table. */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes, these end up in URLs

function rid(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

const noTrophies = (): Trophies => ({ gold: 0, silver: 0, bronze: 0 });

function cleanName(raw: string, fallback: string): string {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  return n.length ? n : fallback;
}

/** Every real duration the hub waits on. */
export interface Timing {
  holdMs: (gridSize: number) => number;
  countdownMs: (humans: number, endMode: EndMode) => number;
  /** The real length of a timed match, given the length its settings ask for. */
  gameMs: (asked: number) => number;
}

export const REAL_TIMING: Timing = {
  holdMs: R.holdMsFor,
  countdownMs: countdownFor,
  gameMs: (asked) => asked,
};

/** For the end-to-end test, which would otherwise sit through real holds and real
 *  match clocks. Every wait shrinks, but stays long enough for a websocket round
 *  trip, so a hold is still something a second message can land inside. */
export const FAST_TIMING: Timing = {
  holdMs: () => 800,
  countdownMs: () => 400,
  gameMs: (asked) => asked / 60, // a minute of settings is a second of play
};

export class Hub {
  private store: Store = new MemoryStore();
  /** claimId -> pending bank. Cleared the moment a claim is broken, so a broken
   *  claim can never bank late. */
  private timers = new Map<string, NodeJS.Timeout>();
  /** tableId -> the match clock. */
  private endTimers = new Map<string, NodeJS.Timeout>();
  /** tableId -> the pre-match countdown. */
  private startTimers = new Map<string, NodeJS.Timeout>();
  /** tableId -> the bots playing the current match, and what drives them. */
  private brains = new Map<string, Map<string, Brain>>();
  private botTickers = new Map<string, NodeJS.Timeout>();

  constructor(
    private send: Send,
    private timing: Timing = REAL_TIMING,
    /** Where finished matches are kept, if anywhere (db.ts). */
    private db: Db | null = null,
    /** Players and ratings (ledger.ts). */
    private ledger: Ledger = new Ledger(db),
  ) {
    // Once ratings are loaded, anyone already in the lobby gets the board.
    void this.ledger.ready.then(() => this.pushLeaderboards());
    setInterval(() => this.reap(), 30_000).unref();
  }

  // ---------------------------------------------------------------- identity

  /** A returning player keeps their seat, score and colour: the client holds its own
   *  id in localStorage, so a refresh mid-game is not a new player.
   *
   *  `bind` runs once the id is known but before anything is sent, so the caller can
   *  wire up the socket in time to receive the welcome. */
  hello(existingId: string | null, device: unknown, name: string, bind: (playerId: string) => void): string {
    const deviceHash =
      typeof device === 'string' && device.length >= 16 && device.length <= 200
        ? createHash('sha256').update(device).digest('hex')
        : undefined;
    let p = existingId ? this.store.getPlayer(existingId) : undefined;
    // Nobody signs in as a bot, and an id alone is not enough: it is shown to
    // everyone at a table, so resuming also takes the browser's own secret.
    if (p?.bot || !deviceHash || p?.device !== deviceHash) p = undefined;
    if (!p) {
      const id = randomUUID();
      p = {
        id,
        // Nameless until they type one. The server inventing "player" here was
        // what defeated the client's own requirement: it echoed that back in the
        // welcome, which filled the field and satisfied the check guarding it.
        name: cleanName(name, ''),
        color: 0,
        score: 0,
        trophies: noTrophies(),
        connected: true,
        ready: false,
        tableId: null,
        lastSeen: Date.now(),
        device: deviceHash,
      };
    } else {
      if (name.trim()) p.name = cleanName(name, p.name);
      p.connected = true;
      p.lastSeen = Date.now();
    }
    this.store.putPlayer(p);
    bind(p.id);

    this.send(p.id, { t: 'welcome', playerId: p.id, name: p.name });
    this.pushFor(p.id);
    if (p.tableId) this.pushLobby();
    return p.id;
  }

  disconnect(playerId: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    p.connected = false;
    p.lastSeen = Date.now();
    this.store.putPlayer(p);
    if (p.tableId) this.pushTable(p.tableId, []);
    this.pushLobby();
  }

  setName(playerId: string, name: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    // The field reports every keystroke so the lobby's controls can react to what
    // is actually in the box, so most of what arrives here says nothing new.
    const next = cleanName(name, p.name);
    if (next === p.name) return;
    p.name = next;
    this.store.putPlayer(p);
    if (p.tableId) this.pushTable(p.tableId, []);
    this.pushLobby();
    // A different name on the same browser is a different guest.
    this.pushLeaderboard(p.id, { onlyIfYouChanged: true });
  }

  // ------------------------------------------------------------------ tables

  createTable(playerId: string, name: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p || !p.name) return;
    this.leaveTable(playerId, { quiet: true });

    const t: TableRecord = {
      id: rid(5),
      name: cleanName(name, `${p.name}'s table`),
      hostId: playerId,
      phase: 'lobby',
      settings: {
        gridSize: DEFAULT_GRID,
        endMode: DEFAULT_END_MODE,
        gameMs: DEFAULT_GAME_MS,
        targetScore: DEFAULT_TARGET,
      },
      playerIds: [],
      game: null,
      nextTileId: 1,
      claimSeq: 1,
      createdAt: Date.now(),
      chat: [],
      startedAt: 0,
      log: new Map(),
      matchLog: null,
      scout: null,
      recap: null,
      misses: new Map(),
      requested: new Map(),
      startsAt: null,
      countdownMs: null,
    };
    this.store.putTable(t);
    this.joinTable(playerId, t.id);
  }

  // Both ways in require a name. The client disables the controls too, but the rule
  // belongs here: a seat with nobody's name on it is the thing we are preventing.
  joinTable(playerId: string, tableId: string): void {
    const p = this.store.getPlayer(playerId);
    const t = this.store.getTable(tableId);
    if (!p || !p.name) return;
    if (!t) {
      this.send(playerId, { t: 'error', message: 'That table is gone.' });
      this.send(playerId, { t: 'left' });
      this.pushLobby();
      return;
    }
    if (p.tableId === tableId) {
      this.pushTable(tableId, []);
      return;
    }
    if (t.playerIds.length >= MAX_PLAYERS) {
      this.send(playerId, { t: 'error', message: 'That table is full.' });
      return;
    }
    this.leaveTable(playerId, { quiet: true });

    p.tableId = tableId;
    p.score = 0;
    p.trophies = noTrophies();
    p.ready = false;
    p.color = this.freeColor(t);
    this.store.putPlayer(p);

    t.playerIds.push(playerId);
    this.store.putTable(t);

    this.pushTable(tableId, []);
    this.pushLobby();
  }

  leaveTable(playerId: string, opts: { quiet?: boolean } = {}): void {
    const p = this.store.getPlayer(playerId);
    if (!p || !p.tableId) return;
    const t = this.store.getTable(p.tableId);
    p.tableId = null;
    p.ready = false;
    this.store.putPlayer(p);

    if (t) {
      t.playerIds = t.playerIds.filter((id) => id !== playerId);
      // Their claims die with them, rather than banking for an absent player.
      if (t.game) {
        for (const c of t.game.claims.filter((c) => c.playerId === playerId)) {
          this.clearTimer(c.id);
        }
        t.game.claims = t.game.claims.filter((c) => c.playerId !== playerId);
      }
      // Bots do not keep a table open, and never host one.
      const humans = t.playerIds.filter((id) => !this.store.getPlayer(id)?.bot);
      if (humans.length === 0) {
        this.destroyTable(t);
      } else {
        if (t.hostId === playerId) t.hostId = humans[0];
        this.store.putTable(t);
        this.pushTable(t.id, []);
      }
    }

    if (!opts.quiet) {
      this.send(playerId, { t: 'left' });
      this.pushLobby();
      this.pushLeaderboard(playerId);
    }
  }

  setSettings(playerId: string, patch: Partial<Settings>): void {
    const t = this.tableOf(playerId);
    // Allowed between matches too, not just before the first one — that is when a
    // table actually decides the next game should be shorter, or played to points.
    if (!t || t.hostId !== playerId || t.phase === 'playing') return;
    t.settings = R.clampSettings({ ...t.settings, ...patch });
    this.store.putTable(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  // -------------------------------------------------------------------- bots

  /** The host seats a bot. It is always ready, so it never holds up a start. */
  addBot(playerId: string): void {
    const t = this.tableOf(playerId);
    if (!t || t.hostId !== playerId || t.phase === 'playing') return;
    if (t.playerIds.length >= MAX_PLAYERS) return;
    // A new bot plays like the one listed above it, so a table of five experts is one
    // choice rather than five.
    const above = t.playerIds.map((id) => this.store.getPlayer(id)?.bot).filter((b) => b).pop();
    const bot: PlayerRecord = {
      id: randomUUID(),
      name: '', // given by nameBots, below
      color: this.freeColor(t),
      score: 0,
      trophies: noTrophies(),
      connected: true,
      ready: true,
      tableId: t.id,
      lastSeen: Date.now(),
      bot: { difficulty: above?.difficulty ?? DEFAULT_BOT_DIFFICULTY, seed: Math.floor(Math.random() * 2 ** 31) },
    };
    this.store.putPlayer(bot);
    t.playerIds.push(bot.id);
    this.nameBots(t);
    this.store.putTable(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  /** Each bot is its level's poet; a second of the same level at the table is II, a
   *  third III, in seat order, renumbered whenever the table's bots change. */
  private nameBots(t: TableRecord): void {
    const seen = new Map<string, number>();
    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (!p?.bot) continue;
      const persona = levelOf(p.bot.difficulty).persona;
      const n = (seen.get(persona) ?? 0) + 1;
      seen.set(persona, n);
      p.name = n === 1 ? persona : `${persona} ${ROMAN[n]}`;
      this.store.putPlayer(p);
    }
  }

  removeBot(playerId: string, botId: string): void {
    const t = this.tableOf(playerId);
    const bot = this.store.getPlayer(botId);
    if (!t || t.hostId !== playerId || t.phase === 'playing') return;
    if (!bot?.bot || bot.tableId !== t.id) return;
    this.leaveTable(botId, { quiet: true });
    this.store.deletePlayer(botId);
    this.nameBots(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  setBotDifficulty(playerId: string, botId: string, difficulty: number): void {
    const t = this.tableOf(playerId);
    const bot = this.store.getPlayer(botId);
    if (!t || t.hostId !== playerId || t.phase === 'playing') return;
    if (!bot?.bot || bot.tableId !== t.id || !Number.isFinite(difficulty)) return;
    const level = BOT_LEVELS.map((l) => l.difficulty).reduce((a, b) =>
      Math.abs(b - difficulty) < Math.abs(a - difficulty) ? b : a,
    );
    bot.bot = { ...bot.bot, difficulty: level };
    this.store.putPlayer(bot);
    this.nameBots(t);
    this.pushTable(t.id, []);
  }

  /** A fresh mind for each bot at the start of every match, all driven by one timer. */
  private startBots(t: TableRecord): void {
    this.stopBots(t.id);
    const brains = new Map<string, Brain>();
    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (p?.bot) brains.set(id, new Brain(id, p.bot.difficulty, p.bot.seed));
    }
    if (!brains.size) return;
    this.brains.set(t.id, brains);
    let last = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      const cur = this.store.getTable(t.id);
      if (!cur || cur.phase !== 'playing' || !cur.game) {
        this.stopBots(t.id);
        return;
      }
      for (const [id, brain] of brains) {
        if (cur.phase !== 'playing' || !cur.game) return;
        const action = brain.tick(cur.game, now, dt);
        if (action) this.claim(id, action.tileIds);
      }
    }, BOT_TICK_MS);
    this.botTickers.set(t.id, ticker);
  }

  private stopBots(tableId: string): void {
    const ticker = this.botTickers.get(tableId);
    if (ticker) clearInterval(ticker);
    this.botTickers.delete(tableId);
    this.brains.delete(tableId);
  }

  setColor(playerId: string, color: number): void {
    const t = this.tableOf(playerId);
    const p = this.store.getPlayer(playerId);
    if (!t || !p) return;
    if (color < 0 || color >= COLOR_COUNT) return;
    const taken = t.playerIds.some((id) => id !== playerId && this.store.getPlayer(id)?.color === color);
    if (taken) return;
    p.color = color;
    this.store.putPlayer(p);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  setReady(playerId: string, ready: boolean): void {
    const t = this.tableOf(playerId);
    const p = this.store.getPlayer(playerId);
    if (!t || !p || t.phase === 'playing') return;
    p.ready = ready;
    this.store.putPlayer(p);
    this.pushTable(t.id, []);

    // Everyone present has said yes. Count down rather than dropping the board on
    // them, and let anyone take it back by un-readying.
    const present = t.playerIds.map((id) => this.store.getPlayer(id)!).filter((x) => x?.connected);
    const agreed = present.length > 0 && present.every((x) => x.ready);
    if (agreed && t.startsAt === null) {
      const ms = this.timing.countdownMs(present.filter((x) => !x.bot).length, t.settings.endMode);
      if (ms === 0) return this.start(t.hostId);
      t.startsAt = Date.now() + ms;
      t.countdownMs = ms;
      this.clearStartTimer(t.id);
      this.startTimers.set(t.id, setTimeout(() => this.start(t.hostId), ms));
    } else if (!agreed && t.startsAt !== null) {
      t.startsAt = null;
      t.countdownMs = null;
      this.clearStartTimer(t.id);
    }
    this.store.putTable(t);
    this.pushTable(t.id, []);
  }

  /** Anyone at a finished table can take everyone back to the setup screen: one
   *  person wanting to change something is enough reason to stop and talk about it.
   *  Any rematch countdown is called off, and the people have to ready up again. */
  backToSetup(playerId: string): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'ended') return;
    t.phase = 'lobby';
    t.startsAt = null;
    t.countdownMs = null;
    this.clearStartTimer(t.id);
    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (p && !p.bot && p.ready) {
        p.ready = false;
        this.store.putPlayer(p);
      }
    }
    this.store.putTable(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  private clearStartTimer(tableId: string): void {
    const timer = this.startTimers.get(tableId);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(tableId);
  }

  chat(playerId: string, text: string): void {
    const t = this.tableOf(playerId);
    const p = this.store.getPlayer(playerId);
    if (!t || !p) return;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LEN);
    if (!clean) return;
    t.chat.push({
      id: `${t.id}-${t.chat.length}-${Date.now()}`,
      playerId,
      name: p.name,
      color: p.color,
      text: clean,
      at: Date.now(),
    });
    if (t.chat.length > MAX_CHAT) t.chat.splice(0, t.chat.length - MAX_CHAT);
    this.store.putTable(t);
    this.pushTable(t.id, []);
  }

  /** Starts the first match, and every rematch: a fresh board and fresh scores, but
   *  trophies carry over — they are the only thing that accumulates at a table. */
  start(playerId: string): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase === 'playing' || t.playerIds.length === 0) return;
    this.clearStartTimer(t.id);
    t.startsAt = null;
    t.countdownMs = null;
    t.phase = 'playing';
    t.startedAt = Date.now();
    t.log = new Map();
    t.recap = null;
    t.misses = new Map();
    t.requested = new Map();
    const who = t.playerIds.flatMap((id) => {
      const p = this.store.getPlayer(id);
      return p ? [this.who(p)] : [];
    });
    t.matchLog = new MatchLog(t.id, t.settings, t.startedAt, who);
    // Only a timed match carries a deadline; the other two end on a score or not at all.
    t.game = R.newGame(
      t.settings.gridSize,
      () => t.nextTileId++,
      t.settings.endMode === 'time' ? Date.now() + this.timing.gameMs(t.settings.gameMs) : null,
    );
    t.scout = new Scout();
    t.scout.look(t.game, Date.now());
    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (p) {
        p.score = 0;
        p.ready = false;
        this.store.putPlayer(p);
      }
    }
    if (t.game.endsAt !== null) this.scheduleEnd(t.id, t.game.endsAt);
    else this.clearEndTimer(t.id);
    this.store.putTable(t);
    this.startBots(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  private scheduleEnd(tableId: string, endsAt: number): void {
    this.clearEndTimer(tableId);
    this.endTimers.set(
      tableId,
      setTimeout(() => this.endGame(tableId), Math.max(0, endsAt - Date.now())),
    );
  }

  private clearEndTimer(tableId: string): void {
    const timer = this.endTimers.get(tableId);
    if (timer) clearTimeout(timer);
    this.endTimers.delete(tableId);
  }

  /** The match is over, however it got there. Everything still held pays out: the
   *  buzzer should not confiscate a claim nobody managed to break, and without this
   *  the last stretch of a match is dead time where claiming is pointless. */
  private endGame(tableId: string): void {
    this.endTimers.delete(tableId);
    const t = this.store.getTable(tableId);
    if (!t || t.phase !== 'playing' || !t.game) return;
    this.stopBots(tableId);

    for (const c of t.game.claims) {
      this.clearTimer(c.id);
      t.matchLog?.held(c.id);
      const holder = this.store.getPlayer(c.playerId);
      if (holder) {
        holder.score += c.tileIds.length;
        this.store.putPlayer(holder);
      }
    }
    t.game.claims = [];
    t.phase = 'ended';

    const standing = t.playerIds
      .map((id) => this.store.getPlayer(id))
      .filter((p): p is PlayerRecord => !!p)
      .map((p) => ({ id: p.id, score: p.score }));
    const medals = R.medalsFor(standing);

    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (!p) continue;
      const medal = medals[id];
      if (medal) p.trophies = { ...p.trophies, [medal]: p.trophies[medal] + 1 };
      p.ready = !!p.bot;
      this.store.putPlayer(p);
    }

    t.recap = {
      words: [...t.log.values()].map((w) => {
        const definition = define(w.word);
        return definition ? { ...w, definition } : w;
      }),
      durationMs: Date.now() - t.startedAt,
      missed: t.scout?.result() ?? [],
    };
    t.scout = null;
    t.misses = t.matchLog?.notWords() ?? new Map();
    t.requested = new Map();
    t.log = new Map();
    const finals = new Map(standing.map((p) => [p.id, { score: p.score, medal: medals[p.id] }]));
    const top = Math.max(0, ...standing.map((p) => p.score));
    const how = t.settings.endMode === 'points' && top >= t.settings.targetScore ? 'points' : 'time';
    this.printReport(t, how, finals);
    this.store.putTable(t);
    this.pushTable(t.id, [{ k: 'ended', medals }]);
    this.pushLobby();
  }

  // ------------------------------------------------------------------- play

  claim(playerId: string, tileIds: number[]): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'playing' || !t.game) return;
    const game = t.game;

    const err = R.validatePath(game, tileIds);
    if (err) {
      this.logMiss(t, playerId, R.wordOf(game, tileIds), err, true);
      // The client pre-validates, so reaching here means the board moved between
      // pressing claim and arriving. Worth saying so now that claiming is a
      // deliberate act — except for tiles that banked out from under the path,
      // which is self-evident on screen.
      if (err === 'not-long-enough') {
        this.send(playerId, { t: 'error', message: 'Someone got there first.' });
      } else if (err !== 'unknown-tile') {
        this.send(playerId, { t: 'error', message: `Invalid word path (${err}).` });
      }
      this.pushFor(playerId);
      return;
    }

    const word = R.wordOf(game, tileIds);
    if (!isWord(word)) {
      this.logMiss(t, playerId, word, 'not-a-word', true);
      return;
    }

    // A repeat of a claim you already hold is caught by validatePath above, since
    // an identical path is not strictly longer than itself.
    const now = Date.now();
    const { claim, broken } = R.applyClaim(
      game,
      tileIds,
      playerId,
      word,
      now,
      this.timing.holdMs(game.size),
      `${t.id}-${t.claimSeq++}`,
    );
    const me = this.store.getPlayer(playerId);
    for (const b of broken) {
      const was = t.log.get(b.id);
      if (was) was.brokenBy = playerId;
      if (me) t.matchLog?.broken(b.id, this.who(me), now);
    }
    t.log.set(claim.id, { playerId, word, at: now - t.startedAt, brokenBy: null });
    if (me) t.matchLog?.claimed(claim.id, this.who(me), word, now);
    t.scout?.playedWord(word);
    t.scout?.look(game, now);

    const fx: Fx[] = [];
    // Breaking is breaking, whoever held the claim — including you extending your
    // own word. Same rule, same animation.
    for (const b of broken) {
      this.clearTimer(b.id);
      fx.push({
        k: 'broken',
        playerId: b.playerId,
        byPlayerId: playerId,
        idx: b.tileIds.map((id) => R.tileIndex(game, id)).filter((i) => i >= 0),
        word: b.word,
      });
    }
    fx.push({
      k: 'claimed',
      playerId,
      idx: claim.tileIds.map((id) => R.tileIndex(game, id)).filter((i) => i >= 0),
      word,
    });

    this.scheduleBank(t.id, claim.id, claim.banksAt);
    this.store.putTable(t);
    this.pushTable(t.id, fx);
  }

  private scheduleBank(tableId: string, claimId: string, banksAt: number): void {
    this.clearTimer(claimId);
    const timer = setTimeout(() => this.bank(tableId, claimId), Math.max(0, banksAt - Date.now()));
    this.timers.set(claimId, timer);
  }

  private bank(tableId: string, claimId: string): void {
    this.timers.delete(claimId);
    const t = this.store.getTable(tableId);
    if (!t || !t.game) return;
    const claim = t.game.claims.find((c) => c.id === claimId);
    if (!claim) return;

    const { points, idx, letters } = R.bankClaim(t.game, claim, () => t.nextTileId++);
    t.matchLog?.banked(claimId, Date.now());
    t.scout?.look(t.game, Date.now());
    const p = this.store.getPlayer(claim.playerId);
    if (p) {
      p.score += points;
      this.store.putPlayer(p);
    }
    this.store.putTable(t);
    this.pushTable(t.id, [
      { k: 'banked', playerId: claim.playerId, idx, letters, word: claim.word, points },
    ]);

    if (t.settings.endMode === 'points' && p && p.score >= t.settings.targetScore) {
      this.endGame(t.id);
    }
  }

  // ------------------------------------------------------------- plumbing

  private tableOf(playerId: string): TableRecord | undefined {
    const p = this.store.getPlayer(playerId);
    return p?.tableId ? this.store.getTable(p.tableId) : undefined;
  }

  private freeColor(t: TableRecord): number {
    const taken = new Set(t.playerIds.map((id) => this.store.getPlayer(id)?.color));
    for (let c = 0; c < COLOR_COUNT; c++) if (!taken.has(c)) return c;
    return 0;
  }

  /** After a match, ask for one of your own refused words to be added, or take the
   *  ask back. Only words you actually tried count, so this cannot be used to stuff
   *  the requests with anything else. */
  requestWord(playerId: string, word: unknown, requested: unknown): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'ended' || typeof word !== 'string' || typeof requested !== 'boolean') return;
    if (!t.misses.get(playerId)?.has(word)) return;
    const mine = t.requested.get(playerId) ?? new Set<string>();
    if (mine.has(word) === requested) return;
    if (requested) mine.add(word);
    else mine.delete(word);
    t.requested.set(playerId, mine);
    console.log(`word-request ${JSON.stringify({ word, requested, table: t.id })}`);
    void this.db?.requestWord({ word, playerId, tableId: t.id }, requested);
    this.store.putTable(t);
    this.pushFor(playerId);
  }

  /** A word slid and let go of that was not one, as the player's client saw it. */
  missed(playerId: string, word: string, why: string): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'playing') return;
    if (typeof word !== 'string' || !/^[a-z]{1,25}$/.test(word)) return;
    if (!(MISS_REASONS as readonly string[]).includes(why)) return;
    this.logMiss(t, playerId, word, why as MissReason, false);
  }

  private logMiss(t: TableRecord, playerId: string, word: string, why: MissReason, server: boolean): void {
    const p = this.store.getPlayer(playerId);
    if (p) t.matchLog?.missed(this.who(p), word, why, Date.now(), server);
  }

  private who(p: PlayerRecord) {
    return { id: p.id, name: p.name, bot: p.bot?.difficulty ?? null, device: p.device ?? null };
  }

  /** Which guest each lobby player was last told they are, so a keystroke in the
   *  name field resends the board only when that changes. */
  private toldYou = new Map<string, string | null>();

  /** The leaderboard, to a player in the lobby, with their own row marked. */
  private pushLeaderboard(playerId: string, opts: { onlyIfYouChanged?: boolean } = {}): void {
    const p = this.store.getPlayer(playerId);
    if (!p || p.bot || p.tableId) return;
    const you = this.ledger.guestId(p.device, p.name);
    if (opts.onlyIfYouChanged && this.toldYou.get(playerId) === you) return;
    this.toldYou.set(playerId, you);
    this.send(playerId, { t: 'leaderboard', board: this.ledger.leaderboard(you) });
  }

  private pushLeaderboards(): void {
    for (const p of this.store.allPlayers()) if (!p.tableId && !p.bot) this.pushLeaderboard(p.id);
  }

  /** One JSON line per match, for the host's log viewer (src/server/matchlog.ts). */
  private printReport(
    t: TableRecord,
    how: 'time' | 'points' | 'abandoned',
    finals: Map<string, { score: number; medal?: Medal }>,
  ): void {
    if (!t.matchLog) return;
    const now = Date.now();
    const report = t.matchLog.report(how, now, finals);
    console.log(`match ${report}`);
    const seats = t.matchLog.seats().map((w) => ({
      device: w.device ?? null,
      name: w.name,
      bot: w.bot,
      score: finals.get(w.id)?.score ?? null,
    }));
    void this.ledger
      .record({ tableId: t.id, endedAt: new Date(now), how, seats, report })
      .then(() => this.pushLeaderboards())
      .catch((e) => console.error(`ledger: could not record match on ${t.id}: ${e}`));
    t.matchLog = null;
  }

  private clearTimer(claimId: string): void {
    const timer = this.timers.get(claimId);
    if (timer) clearTimeout(timer);
    this.timers.delete(claimId);
  }

  private destroyTable(t: TableRecord): void {
    if (t.phase === 'playing') this.printReport(t, 'abandoned', new Map());
    for (const c of t.game?.claims ?? []) this.clearTimer(c.id);
    this.clearEndTimer(t.id);
    this.clearStartTimer(t.id);
    this.stopBots(t.id);
    // Bots exist only at their table.
    for (const id of t.playerIds) if (this.store.getPlayer(id)?.bot) this.store.deletePlayer(id);
    this.store.deleteTable(t.id);
  }

  private playerView(id: string): Player | null {
    const p = this.store.getPlayer(id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      trophies: p.trophies,
      connected: p.connected,
      ready: p.ready,
      ...(p.bot ? { bot: { difficulty: p.bot.difficulty } } : {}),
    };
  }

  private tableView(t: TableRecord): TableView {
    return {
      id: t.id,
      name: t.name,
      hostId: t.hostId,
      phase: t.phase,
      settings: t.settings,
      players: t.playerIds.map((id) => this.playerView(id)).filter((x): x is Player => !!x),
      game: t.game,
      chat: t.chat,
      recap: t.recap,
      startsAt: t.startsAt,
      countdownMs: t.countdownMs,
    };
  }

  private lobbyView(): TableSummary[] {
    return this.store
      .allTables()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => ({
        id: t.id,
        name: t.name,
        phase: t.phase,
        playerCount: t.playerIds.length,
        settings: t.settings,
        players: t.playerIds
          .map((id) => this.store.getPlayer(id))
          .filter((p): p is PlayerRecord => !!p)
          .map((p) => ({ name: p.name, color: p.color })),
      }));
  }

  /** Whole-state snapshots. A 7x7 board with 10 players is a couple of KB, which is
   *  far cheaper than getting incremental diffs subtly wrong. */
  private pushTable(tableId: string, fx: Fx[]): void {
    const t = this.store.getTable(tableId);
    if (!t) return;
    const table = this.tableView(t);
    const serverNow = Date.now();
    // The same table to everyone, plus to each player alone their own misses.
    for (const id of t.playerIds) this.send(id, { t: 'table', table, serverNow, fx, mine: this.mine(t, id) });
  }

  private mine(t: TableRecord, playerId: string): MyRecap | undefined {
    if (t.phase !== 'ended') return undefined;
    const tally = t.misses.get(playerId);
    if (!tally?.size) return undefined;
    const asked = t.requested.get(playerId);
    return {
      misses: [...tally].map(([word, tries]) => ({ word, tries, requested: !!asked?.has(word) })),
    };
  }

  private pushLobby(): void {
    const msg: ServerMsg = { t: 'lobby', tables: this.lobbyView() };
    for (const p of this.store.allPlayers()) if (!p.tableId) this.send(p.id, msg);
  }

  private pushFor(playerId: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    if (p.tableId) this.pushTable(p.tableId, []);
    else {
      this.send(playerId, { t: 'lobby', tables: this.lobbyView() });
      this.pushLeaderboard(playerId);
    }
  }

  private reap(): void {
    const cutoff = Date.now() - DISCONNECT_GRACE_MS;
    for (const p of this.store.allPlayers()) {
      if (p.connected || p.lastSeen > cutoff) continue;
      this.leaveTable(p.id, { quiet: true });
      this.store.deletePlayer(p.id);
    }
    for (const t of this.store.allTables()) {
      if (t.playerIds.length === 0) this.destroyTable(t);
    }
    this.pushLobby();
  }
}
