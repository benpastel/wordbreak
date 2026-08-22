// Drives the real websocket protocol against a real server: two players, a table,
// a game, a claim, a break, a bank, a reconnect. Boots its own server on a spare
// port so it needs nothing already running.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { section, check, done } from './harness.mjs';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const PORT = 8100 + Math.floor(Math.random() * 800);
const WS = `ws://localhost:${PORT}/ws`;
const WORDS = new Set(
  readFileSync(new URL('../public/words.txt', import.meta.url), 'utf8')
    .split('\n').map((s) => s.trim()).filter(Boolean),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    Object.assign(this, { name, table: null, id: null, lobby: [], fx: [], errors: [] });
  }
  connect(asId = null) {
    return new Promise((resolve) => {
      this.ws = new WebSocket(WS);
      this.ws.on('open', () => this.send({ t: 'hello', playerId: asId, name: this.name }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.t === 'welcome') { this.id = m.playerId; resolve(); }
        if (m.t === 'lobby') { this.lobby = m.tables; this.table = null; }
        if (m.t === 'table') { this.table = m.table; if (m.fx.length) this.fx.push(...m.fx); }
        if (m.t === 'left') this.table = null;
        if (m.t === 'error') this.errors.push(m.message);
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  close() { this.ws.close(); }
  get game() { return this.table && this.table.game; }
}

/** Depth-first hunt for a real word on the board, optionally through a given cell. */
function findWord(game, { minLen = 2, maxLen = 9, mustInclude = null } = {}) {
  const n = game.size;
  const adj = (i) => {
    const r = Math.floor(i / n), c = i % n, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
    return out;
  };
  let best = null;
  const walk = (path, word) => {
    if (best) return;
    if (word.length >= minLen && WORDS.has(word) && (!mustInclude || path.includes(mustInclude))) {
      best = [...path]; return;
    }
    if (word.length >= maxLen) return;
    for (const nx of adj(path[path.length - 1])) {
      if (path.includes(nx)) continue;
      walk([...path, nx], word + game.grid[nx].letter.toLowerCase());
      if (best) return;
    }
  };
  for (let i = 0; i < n * n && !best; i++) walk([i], game.grid[i].letter.toLowerCase());
  return best ? best.map((i) => game.grid[i].id) : null;
}
const wordOf = (game, ids) => ids.map((id) => game.grid.find((t) => t.id === id).letter).join('');

const server = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

(async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) break; } catch {}
    await sleep(150);
  }

  section('connect and lobby');
  const a = new Client('ana'), b = new Client('benji');
  await a.connect(); await b.connect();
  check('both players got ids', !!a.id && !!b.id);

  a.send({ t: 'createTable', name: 'test table' });
  await sleep(150);
  check('creator is seated at their own table', a.table?.players.length === 1);
  check('creator is host', a.table?.hostId === a.id);
  const tableId = a.table.id;
  check('the table shows up in the lobby for others', b.lobby.some((t) => t.id === tableId));

  b.send({ t: 'joinTable', tableId });
  await sleep(150);
  check('second player joined', a.table.players.length === 2);
  check('colours are distinct', a.table.players[0].color !== a.table.players[1].color);

  section('names');
  b.send({ t: 'setName', name: '  clever   badger  ' });
  await sleep(120);
  check('a two-word name survives, whitespace collapsed',
    a.table.players.some((p) => p.name === 'clever badger'),
    a.table.players.map((p) => p.name).join(', '));
  b.send({ t: 'setName', name: 'z'.repeat(40) });
  await sleep(120);
  check('an over-long name is capped at 20',
    a.table.players.some((p) => p.name === 'z'.repeat(20)));
  b.send({ t: 'setName', name: 'benji' });
  await sleep(120);

  section('settings and start');
  a.send({ t: 'setSettings', settings: { gridSize: 5, holdMs: 4000 } });
  await sleep(120);
  check('host can change settings', a.table.settings.gridSize === 5 && a.table.settings.holdMs === 4000);
  b.send({ t: 'setSettings', settings: { gridSize: 6 } });
  await sleep(120);
  check('non-host cannot change settings', a.table.settings.gridSize === 5);

  a.send({ t: 'setReady', ready: true });
  await sleep(100);
  check('one ready is not enough', a.table.phase === 'lobby');
  b.send({ t: 'setReady', ready: true });
  await sleep(200);
  check('all ready auto-starts', a.table.phase === 'playing');
  check('board is 5x5', a.game?.grid.length === 25);
  check('tile ids are unique', new Set(a.game.grid.map((t) => t.id)).size === 25);

  section('claiming and breaking');
  const first = findWord(a.game, { minLen: 3, maxLen: 4 });
  check('found a word on the board', !!first, first ? wordOf(a.game, first) : 'none');
  a.send({ t: 'claim', tileIds: first });
  await sleep(180);
  check('claim registered', a.game.claims.length === 1);
  check('opponent sees it too', b.game.claims.length === 1);
  const claim = a.game.claims[0];
  check('hold window matches the setting', claim.banksAt - claim.claimedAt === 4000);

  b.send({ t: 'claim', tileIds: [claim.tileIds[0]] });
  await sleep(150);
  check('a shorter word cannot take a claimed letter', a.game.claims[0]?.id === claim.id);

  a.send({ t: 'claim', tileIds: claim.tileIds });
  await sleep(150);
  check('re-claiming your own identical word is rejected', a.game.claims[0]?.id === claim.id);

  const cell = a.game.grid.findIndex((t) => t.id === claim.tileIds[0]);
  const longer = findWord(a.game, { minLen: claim.tileIds.length + 1, mustInclude: cell });
  if (longer) {
    b.send({ t: 'claim', tileIds: longer });
    await sleep(180);
    check('a strictly longer word breaks the claim',
      a.game.claims.length === 1 && a.game.claims[0].playerId === b.id,
      `${wordOf(a.game, longer)} over ${claim.word.toUpperCase()}`);
    check('a break was announced', a.fx.some((f) => f.k === 'broken'));
    check('claims stay disjoint',
      new Set(a.game.claims.flatMap((c) => c.tileIds)).size ===
      a.game.claims.reduce((n, c) => n + c.tileIds.length, 0));
  } else {
    console.log('  skip  no longer word reaches that cell on this board');
  }

  section('banking');
  const live = a.game.claims[0];
  const owner = live.playerId, letters = live.tileIds.length;
  const before = a.table.players.find((p) => p.id === owner).score;
  await sleep(4500);
  const after = a.table.players.find((p) => p.id === owner).score;
  check('banked one point per letter', after === before + letters, `${before} -> ${after}`);
  check('bank carried the old letters', a.fx.some((f) => f.k === 'banked' && f.letters.length === letters));
  check('board refilled', a.game.grid.length === 25);
  check('reseeded cells got fresh ids', Math.max(...a.game.grid.map((t) => t.id)) > 25);

  section('reconnect');
  const savedId = a.id;
  // Snapshot every score, not just the reconnecting player's: the interesting
  // property is that a dropped socket disturbs nothing on the table.
  const board = Object.fromEntries(a.table.players.map((p) => [p.id, p.score]));
  a.close();
  await sleep(250);
  const a2 = new Client('ana');
  await a2.connect(savedId);
  await sleep(250);
  check('same identity', a2.id === savedId);
  check('lands back at the table mid-game',
    a2.table?.id === tableId && a2.table.phase === 'playing');
  const now = Object.fromEntries(a2.table.players.map((p) => [p.id, p.score]));
  check('every score survived', JSON.stringify(now) === JSON.stringify(board),
    `${JSON.stringify(board)} -> ${JSON.stringify(now)}`);
  check('the scoreboard was not empty, so that check meant something',
    Object.values(board).some((v) => v > 0), JSON.stringify(board));

  section('leaving');
  b.send({ t: 'leaveTable' });
  await sleep(200);
  check('leaver is removed', a2.table.players.length === 1);
  a2.send({ t: 'leaveTable' });
  await sleep(250);
  check('the empty table is cleaned up', !a2.lobby.some((t) => t.id === tableId));

  a2.close(); b.close();
  done();
  stop();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
})().catch((e) => { console.error(e); stop(); process.exit(1); });
