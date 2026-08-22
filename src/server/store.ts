// Everything lives in memory on a single dyno, so a restart or a deploy ends every
// game in progress. That is fine for a prototype, but all state access goes through
// this interface so that adding a real store later is a contained change rather than
// a rewrite: the rules in src/shared stay pure, and the hub only ever talks to a Store.

import type { GameState, Phase, Settings, Trophies } from '../shared/types';

export interface PlayerRecord {
  id: string;
  name: string;
  color: number;
  score: number;
  trophies: Trophies;
  connected: boolean;
  ready: boolean;
  tableId: string | null;
  lastSeen: number;
}

export interface TableRecord {
  id: string;
  name: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  playerIds: string[];
  game: GameState | null;
  nextTileId: number;
  claimSeq: number;
  createdAt: number;
}

export interface Store {
  getPlayer(id: string): PlayerRecord | undefined;
  putPlayer(p: PlayerRecord): void;
  allPlayers(): PlayerRecord[];
  deletePlayer(id: string): void;

  getTable(id: string): TableRecord | undefined;
  putTable(t: TableRecord): void;
  allTables(): TableRecord[];
  deleteTable(id: string): void;
}

export class MemoryStore implements Store {
  private players = new Map<string, PlayerRecord>();
  private tables = new Map<string, TableRecord>();

  getPlayer(id: string) {
    return this.players.get(id);
  }
  putPlayer(p: PlayerRecord) {
    this.players.set(p.id, p);
  }
  allPlayers() {
    return [...this.players.values()];
  }
  deletePlayer(id: string) {
    this.players.delete(id);
  }

  getTable(id: string) {
    return this.tables.get(id);
  }
  putTable(t: TableRecord) {
    this.tables.set(t.id, t);
  }
  allTables() {
    return [...this.tables.values()];
  }
  deleteTable(id: string) {
    this.tables.delete(id);
  }
}
