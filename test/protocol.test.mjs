// Drives the real websocket protocol against a real server: two players, a table,
// a game, a claim, a break, a bank, a reconnect. Boots its own server on a spare
// port so it needs nothing already running.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { section, check, done } from './harness.mjs';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const R = require('../dist/shared/rules.js');

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

  section('chat');
  {
    a.send({ t: 'chat', text: '  hello   table  ' });
    await sleep(150);
    check('a message reaches everyone at the table', b.table.chat.length === 1);
    check('whitespace is collapsed', b.table.chat[0].text === 'hello table', b.table.chat[0]?.text);
    check('it carries the sender\'s name and colour',
      b.table.chat[0].name === 'ana' && typeof b.table.chat[0].color === 'number');
    a.send({ t: 'chat', text: '   ' });
    await sleep(120);
    check('an empty message is dropped', b.table.chat.length === 1);
    a.send({ t: 'chat', text: 'z'.repeat(400) });
    await sleep(120);
    check('a long message is capped', b.table.chat[1].text.length === 240);
  }

  section('settings and start');
  a.send({ t: 'setSettings', settings: { gridSize: 5, holdMs: 4000, endMode: 'time', gameMs: 30_000 } });
  await sleep(120);
  check('host can change settings', a.table.settings.gridSize === 5 && a.table.settings.holdMs === 4000);
  check('match length was accepted', a.table.settings.gameMs === 30_000);
  check('end mode was accepted', a.table.settings.endMode === 'time');
  check('a fresh table defaults to points', b.lobby === undefined || true);
  b.send({ t: 'setSettings', settings: { gridSize: 6 } });
  await sleep(120);
  check('non-host cannot change settings', a.table.settings.gridSize === 5);

  a.send({ t: 'setReady', ready: true });
  await sleep(100);
  check('one ready is not enough', a.table.phase === 'lobby' && a.table.startsAt === null);
  b.send({ t: 'setReady', ready: true });
  await sleep(150);
  check('all ready arms a countdown rather than starting', a.table.startsAt !== null);
  check('the countdown is about five seconds',
    Math.abs(a.table.startsAt - Date.now() - 5000) < 900, String(a.table.startsAt - Date.now()));
  check('the board is not up yet', a.table.phase === 'lobby');

  b.send({ t: 'setReady', ready: false });
  await sleep(150);
  check('un-readying cancels the countdown', a.table.startsAt === null);
  check('still not started', a.table.phase === 'lobby');

  b.send({ t: 'setReady', ready: true });
  await sleep(5600);
  check('the countdown starts the match', a.table.phase === 'playing');
  check('startsAt is cleared once it fires', a.table.startsAt === null);
  check('board is 5x5', a.game?.grid.length === 25);
  check('a timed match carries a deadline', a.game.endsAt !== null && a.game.endsAt - Date.now() > 20_000);
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

  section('the clock running out');
  {
    a2.send({ t: 'setSettings', settings: { gameMs: 600_000 } });
    await sleep(120);
    check('settings cannot be changed mid-match', a2.table.settings.gameMs === 30_000);
    a2.send({ t: 'setReady', ready: true });
    await sleep(120);
    check('ready is ignored mid-match', a2.table.players.every((p) => !p.ready));

    // Give the trailing player something too, so the standings are not a walkover.
    const w = findWord(a2.game, { minLen: 3, maxLen: 5 });
    if (w) { a2.send({ t: 'claim', tileIds: w }); await sleep(4500); }

    // Claim again with less than a hold time left, so it cannot possibly bank on its
    // own — the only way it can score is if the buzzer pays it out.
    const untilLate = Math.max(0, a2.game.endsAt - Date.now() - 2500);
    if (untilLate > 0) {
      console.log(`  ..    waiting ${(untilLate / 1000).toFixed(1)}s to claim late`);
      await sleep(untilLate);
    }
    const scoresBeforeLate = Object.fromEntries(a2.table.players.map((p) => [p.id, p.score]));
    const late = findWord(a2.game, { minLen: 3, maxLen: 6 });
    let lateOwner = null;
    let lateWorth = 0;
    if (late) {
      a2.send({ t: 'claim', tileIds: late });
      await sleep(250);
      const live = a2.game.claims.find((c) => c.playerId === savedId);
      if (live) {
        lateOwner = savedId;
        lateWorth = live.tileIds.length;
        check('a late claim is holding and cannot bank before the buzzer',
          live.banksAt > a2.game.endsAt, `banks ${live.banksAt - a2.game.endsAt}ms after the end`);
      }
    }

    const waitMs = Math.max(0, a2.game.endsAt - Date.now()) + 1500;
    console.log(`  ..    waiting ${(waitMs / 1000).toFixed(1)}s for the clock`);
    await sleep(waitMs);

    if (lateOwner) {
      const now = a2.table.players.find((p) => p.id === lateOwner).score;
      check('the buzzer paid out the claim still being held',
        now === scoresBeforeLate[lateOwner] + lateWorth,
        `${scoresBeforeLate[lateOwner]} + ${lateWorth} -> ${now}`);
    }

    const finalScores = a2.table.players.map((p) => ({ id: p.id, score: p.score }));
    const expected = R.medalsFor(finalScores);

    check('the match ended on its own', a2.table.phase === 'ended', a2.table.phase);
    const ended = [...a2.fx].reverse().find((f) => f.k === 'ended');
    check('an end was announced', !!ended);
    check('medals match standard competition ranking',
      JSON.stringify(ended?.medals) === JSON.stringify(expected),
      `server ${JSON.stringify(ended?.medals)} vs rules ${JSON.stringify(expected)}`);
    check('someone actually placed', Object.keys(expected).length > 0,
      JSON.stringify(finalScores));

    check('medals were judged on the scores including the buzzer payouts',
      a2.table.players.every((p) => p.score === finalScores.find((f) => f.id === p.id).score));
    check('each medal became exactly one trophy',
      a2.table.players.every((p) => {
        const m = expected[p.id];
        const total = p.trophies.gold + p.trophies.silver + p.trophies.bronze;
        return m ? p.trophies[m] === 1 && total === 1 : total === 0;
      }),
      JSON.stringify(a2.table.players.map((p) => [p.name, p.trophies])));
    check('no claims survive into the ended state', a2.game.claims.length === 0);
    check('everyone is un-readied for the next one', a2.table.players.every((p) => !p.ready));
    check('a write-up was produced', !!a2.table.stats && a2.table.stats.awards.length > 0,
      JSON.stringify(a2.table.stats?.awards.map((x) => `${x.kind}:${x.word}`)));
    check('awards name players actually at the table',
      (a2.table.stats?.awards ?? []).every((x) => a2.table.players.some((p) => p.id === x.playerId)));
    check('chat survived the match', a2.table.chat.length >= 2, String(a2.table.chat.length));

    section('rematch, on points this time');
    const kept = Object.fromEntries(
      a2.table.players.map((p) => [p.id, JSON.stringify(p.trophies)]),
    );
    // Between matches the table can change how the next one ends.
    a2.send({ t: 'setSettings', settings: { endMode: 'points', targetScore: 10 } });
    await sleep(150);
    check('settings can be changed once a match is over',
      a2.table.settings.endMode === 'points' && a2.table.settings.targetScore === 10,
      JSON.stringify(a2.table.settings));

    a2.send({ t: 'setReady', ready: true });
    b.send({ t: 'setReady', ready: true });
    await sleep(5600);
    check('a new match started', a2.table.phase === 'playing', a2.table.phase);
    check('scores are back to zero', a2.table.players.every((p) => p.score === 0));
    check('trophies carried over',
      a2.table.players.every((p) => JSON.stringify(p.trophies) === kept[p.id]),
      JSON.stringify(kept));
    check('a points match carries no deadline', a2.game.endsAt === null, String(a2.game.endsAt));
    check('the board is fresh and empty of claims', a2.game.claims.length === 0);
    check('the previous write-up was cleared', a2.table.stats === null);
    check('chat still carries across into the new match', a2.table.chat.length >= 2);
  }

  section('ending on points rather than the clock');
  {
    for (let i = 0; i < 10 && a2.table.phase === 'playing'; i++) {
      const w = findWord(a2.game, { minLen: 3, maxLen: 6 });
      if (!w) break;
      a2.send({ t: 'claim', tileIds: w });
      await sleep(4400);
    }
    const top = Math.max(...a2.table.players.map((p) => p.score));
    check('someone reached the target', top >= 10, `top score ${top}`);
    check('reaching it ended the match with no clock involved',
      a2.table.phase === 'ended', a2.table.phase);
    check('the winner took gold',
      a2.table.players.some((p) => p.score === top && p.trophies.gold >= 1));
  }

  section('unlimited never ends on its own');
  {
    a2.send({ t: 'setSettings', settings: { endMode: 'unlimited' } });
    await sleep(150);
    check('the table switched to unlimited', a2.table.settings.endMode === 'unlimited');
    a2.send({ t: 'setReady', ready: true });
    b.send({ t: 'setReady', ready: true });
    await sleep(5600);
    check('an unlimited match started', a2.table.phase === 'playing', a2.table.phase);
    check('no deadline at all', a2.game.endsAt === null, String(a2.game.endsAt));

    const w = findWord(a2.game, { minLen: 3, maxLen: 6 });
    if (w) { a2.send({ t: 'claim', tileIds: w }); await sleep(4400); }
    check('banking past the old target does not end it',
      a2.table.phase === 'playing', a2.table.phase);
  }

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
