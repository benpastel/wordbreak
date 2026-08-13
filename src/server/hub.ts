// The authoritative game hub. Owns every table, every claim, and every hold-time
// timer. Clients send intents; the hub validates against current state and pushes
// a fresh snapshot plus a few animation hints.

import {
  COLOR_COUNT,
  DEFAULT_GRID,
  DEFAULT_HOLD_MS,
  MAX_HOLD_MS,
  MAX_PLAYERS,
  MIN_HOLD_MS,
} from '../shared/types';
import type { Fx, Player, ServerMsg, Settings, TableSummary, TableView } from '../shared/types';
import * as R from '../shared/rules';
import { isWord } from './dictionary';
import { MemoryStore } from './store';
import type { PlayerRecord, Store, TableRecord } from './store';

type Send = (playerId: string, msg: ServerMsg) => void;

const DISCONNECT_GRACE_MS = 120_000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes, these end up in URLs

function rid(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function cleanName(raw: string, fallback: string): string {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length ? n : fallback;
}

export class Hub {
  private store: Store = new MemoryStore();
  /** claimId -> pending bank. Cleared the moment a claim is broken, so a broken
   *  claim can never bank late. */
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private send: Send) {
    setInterval(() => this.reap(), 30_000).unref();
  }

  // ---------------------------------------------------------------- identity

  /** A returning player keeps their seat, score and colour: the client holds its own
   *  id in localStorage, so a refresh mid-game is not a new player.
   *
   *  `bind` runs once the id is known but before anything is sent, so the caller can
   *  wire up the socket in time to receive the welcome. */
  hello(existingId: string | null, name: string, bind: (playerId: string) => void): string {
    let p = existingId ? this.store.getPlayer(existingId) : undefined;
    if (!p) {
      const id = rid(12);
      p = {
        id,
        name: cleanName(name, 'player'),
        color: 0,
        score: 0,
        connected: true,
        ready: false,
        tableId: null,
        lastSeen: Date.now(),
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
    p.name = cleanName(name, p.name);
    this.store.putPlayer(p);
    if (p.tableId) this.pushTable(p.tableId, []);
    this.pushLobby();
  }

  // ------------------------------------------------------------------ tables

  createTable(playerId: string, name: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    this.leaveTable(playerId, { quiet: true });

    const t: TableRecord = {
      id: rid(5),
      name: cleanName(name, `${p.name}'s table`),
      hostId: playerId,
      phase: 'lobby',
      settings: { gridSize: DEFAULT_GRID, holdMs: DEFAULT_HOLD_MS },
      playerIds: [],
      game: null,
      nextTileId: 1,
      claimSeq: 1,
      createdAt: Date.now(),
    };
    this.store.putTable(t);
    this.joinTable(playerId, t.id);
  }

  joinTable(playerId: string, tableId: string): void {
    const p = this.store.getPlayer(playerId);
    const t = this.store.getTable(tableId);
    if (!p) return;
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
      if (t.playerIds.length === 0) {
        this.destroyTable(t);
      } else {
        if (t.hostId === playerId) t.hostId = t.playerIds[0];
        this.store.putTable(t);
        this.pushTable(t.id, []);
      }
    }

    if (!opts.quiet) {
      this.send(playerId, { t: 'left' });
      this.pushLobby();
    }
  }

  setSettings(playerId: string, patch: Partial<Settings>): void {
    const t = this.tableOf(playerId);
    if (!t || t.hostId !== playerId || t.phase !== 'lobby') return;
    const next = R.clampSettings(
      patch.gridSize ?? t.settings.gridSize,
      patch.holdMs ?? t.settings.holdMs,
      MIN_HOLD_MS,
      MAX_HOLD_MS,
    );
    t.settings = next;
    this.store.putTable(t);
    this.pushTable(t.id, []);
    this.pushLobby();
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
    if (!t || !p || t.phase !== 'lobby') return;
    p.ready = ready;
    this.store.putPlayer(p);
    this.pushTable(t.id, []);

    // Everyone present has said yes — no need to make the host click again.
    const present = t.playerIds.map((id) => this.store.getPlayer(id)!).filter((x) => x?.connected);
    if (present.length > 0 && present.every((x) => x.ready)) this.start(t.hostId);
  }

  start(playerId: string): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'lobby' || t.playerIds.length === 0) return;
    t.phase = 'playing';
    t.game = R.newGame(t.settings.gridSize, () => t.nextTileId++);
    for (const id of t.playerIds) {
      const p = this.store.getPlayer(id);
      if (p) {
        p.score = 0;
        p.ready = false;
        this.store.putPlayer(p);
      }
    }
    this.store.putTable(t);
    this.pushTable(t.id, []);
    this.pushLobby();
  }

  // ------------------------------------------------------------------- play

  claim(playerId: string, tileIds: number[]): void {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'playing' || !t.game) return;
    const game = t.game;

    const err = R.validatePath(game, tileIds);
    if (err) {
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
    if (!isWord(word)) return;

    // A repeat of a claim you already hold is caught by validatePath above, since
    // an identical path is not strictly longer than itself.
    const { claim, broken } = R.applyClaim(
      game,
      tileIds,
      playerId,
      word,
      Date.now(),
      t.settings.holdMs,
      `${t.id}-${t.claimSeq++}`,
    );

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
    const p = this.store.getPlayer(claim.playerId);
    if (p) {
      p.score += points;
      this.store.putPlayer(p);
    }
    this.store.putTable(t);
    this.pushTable(t.id, [
      { k: 'banked', playerId: claim.playerId, idx, letters, word: claim.word, points },
    ]);
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

  private clearTimer(claimId: string): void {
    const timer = this.timers.get(claimId);
    if (timer) clearTimeout(timer);
    this.timers.delete(claimId);
  }

  private destroyTable(t: TableRecord): void {
    for (const c of t.game?.claims ?? []) this.clearTimer(c.id);
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
      connected: p.connected,
      ready: p.ready,
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

  /** Whole-state snapshots. A 7x7 board with 8 players is a couple of KB, which is
   *  far cheaper than getting incremental diffs subtly wrong. */
  private pushTable(tableId: string, fx: Fx[]): void {
    const t = this.store.getTable(tableId);
    if (!t) return;
    const msg: ServerMsg = { t: 'table', table: this.tableView(t), serverNow: Date.now(), fx };
    for (const id of t.playerIds) this.send(id, msg);
  }

  private pushLobby(): void {
    const msg: ServerMsg = { t: 'lobby', tables: this.lobbyView() };
    for (const p of this.store.allPlayers()) if (!p.tableId) this.send(p.id, msg);
  }

  private pushFor(playerId: string): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    if (p.tableId) this.pushTable(p.tableId, []);
    else this.send(playerId, { t: 'lobby', tables: this.lobbyView() });
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
