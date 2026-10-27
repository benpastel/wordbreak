// A standing population of varied bots and every game they have played, for rating
// bots against each other and for asking what makes one stronger.
//
// Each bot is a full set of knobs (knobs.ts), not just a point on the difficulty
// dial: a base difficulty, with every knob then nudged at random and now and again
// drawn from anywhere in its range, so the population covers styles the dial never
// produces (a fast spotter with slow hands, a careful reader who never extends...).
// The named levels are members too, at exactly their dial settings.
//
// Games vary as much: board size, points or time, target or length, two to four bots.
// Opponents are chosen near each other's current rating, so most games are close
// enough to say something. Every game is kept with its seed, so it can be replayed.
//
// Ratings are fitted to all the games at once (Bradley-Terry, on the usual 400-point
// scale) with intermediate pinned at 1500, so they share a scale with the players'
// Glicko-2 ratings. Only games played by the current bot code count: change the
// brain and earlier games no longer describe these bots, so the previous ratings
// become the starting point and new games refine them.
//
// Everything lives in data/bots/ and is committed:
//   population.json  every bot and its knobs
//   games.jsonl      every game: bots, board, seed, scores, bot code version
//   ratings.json     the latest fit, with standard errors
//
//   npm run tournament -- grow --bots 200        add bots to the population
//   npm run tournament -- play --games 20000     play, in parallel, refitting as it goes
//   npm run tournament -- fit                    refit from the games
//   npm run tournament -- report                 what the knobs and boards do to strength
//   npm run tournament -- pick 0,800,1500,2200   bots nearest those ratings

import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOT_LEVELS, HOLD_MS } from '../../shared/types';
import { loadDictionary } from '../dictionary';
import { loadFrequencies } from '../frequency';
import { ANCHORS, knobsFor } from './knobs';
import type { Knobs } from './knobs';
import { normal, seeded } from './rng';
import type { Rng } from './rng';
import { playOne } from './sim';

const DIR = path.join(process.cwd(), 'data', 'bots');
const POPULATION = path.join(DIR, 'population.json');
const GAMES = path.join(DIR, 'games.jsonl');
const RATINGS = path.join(DIR, 'ratings.json');

const ANCHOR = 'intermediate';
const ANCHOR_RATING = 1500;
/** Elo/Glicko scale: 400 points is tenfold odds. */
const K = Math.LN10 / 400;
/** How far a previous version's rating is trusted as a starting point. */
const CARRIED_SD = 250;
/** Games between refits while playing, so pairing follows the ratings as they firm up. */
const REFIT_EVERY = 1000;
/** A points game stops here if nobody has reached the target; the leader wins. */
const POINTS_CAP_SECS = 1200;

interface Bot {
  id: string;
  /** Set for the named levels, which sit exactly on the dial. */
  level?: string;
  /** The dial setting it started from before its knobs were varied. */
  base: number;
  knobs: Knobs;
}

interface Game {
  id: number;
  version: string;
  bots: string[];
  grid: number;
  mode: 'points' | 'time';
  /** Points to win, or seconds of play. */
  length: number;
  seed: number;
  scores: number[];
}

interface Fit {
  version: string;
  fittedAt: string;
  games: number;
  bots: Record<string, { rating: number; se: number; games: number }>;
}

// ------------------------------------------------------------------ storage

function loadPopulation(): Bot[] {
  return fs.existsSync(POPULATION) ? JSON.parse(fs.readFileSync(POPULATION, 'utf8')) : [];
}

function savePopulation(bots: Bot[]): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(POPULATION, `${JSON.stringify(bots, null, 1)}\n`);
}

function loadGames(): Game[] {
  if (!fs.existsSync(GAMES)) return [];
  return fs
    .readFileSync(GAMES, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function loadFit(): Fit | null {
  return fs.existsSync(RATINGS) ? JSON.parse(fs.readFileSync(RATINGS, 'utf8')) : null;
}

/** Everything that decides how a bot plays, so games from different code are told
 *  apart: the brain, its knobs and helpers, the rules and the word lists it reads. */
function botVersion(): string {
  const files = [
    'src/server/bot/brain.ts',
    'src/server/bot/knobs.ts',
    'src/server/bot/finder.ts',
    'src/server/bot/wordlists.ts',
    'src/server/bot/rng.ts',
    'src/server/bot/sim.ts',
    'src/shared/rules.ts',
    'src/shared/letters.ts',
    'public/words.txt',
    'data/word-frequency.txt',
    'data/bot-short-words.txt',
    'data/bot-blocked-words.txt',
  ];
  const h = createHash('sha256');
  for (const f of files) h.update(fs.readFileSync(path.join(process.cwd(), f)));
  // Of the shared constants, only the hold times change how a game plays out; the
  // file they live in also holds the bots' fitted ratings, which must not count.
  h.update(JSON.stringify(HOLD_MS));
  return h.digest('hex').slice(0, 12);
}

// ------------------------------------------------------------------ bots

/** Four significant figures: plenty, and what is stored is exactly what plays. */
const sig = (v: number) => Number(v.toPrecision(4));

/** A knob's range across the dial, from easy to hard, leaving out the superhuman end. */
function range(key: keyof Knobs): [number, number] {
  const a = (ANCHORS[key] as readonly number[]).slice(0, 4);
  return [Math.min(...a), Math.max(...a)];
}

function sampleKnobs(rng: Rng, base: number): Knobs {
  const k = knobsFor(base);
  for (const key of Object.keys(k) as (keyof Knobs)[]) {
    const [lo, hi] = range(key);
    let v = k[key];
    if (rng() < 0.15) {
      // Now and again, anywhere in the knob's range: geometric where it can be.
      v = lo > 0 ? lo * (hi / lo) ** rng() : lo + (hi - lo) * rng();
    } else if (v > 0) {
      v *= Math.exp(normal(rng) * 0.3);
    }
    k[key] = sig(key === 'memory' ? Math.min(0.95, v) : v);
  }
  return k;
}

function grow(n: number): void {
  const bots = loadPopulation();
  for (const l of BOT_LEVELS) {
    if (!bots.some((b) => b.level === l.name)) {
      bots.push({ id: l.name, level: l.name, base: l.difficulty, knobs: knobsFor(l.difficulty) });
    }
  }
  const rng = seeded(bots.length * 7919 + 17);
  let next = bots.filter((b) => !b.level).length;
  for (let i = 0; i < n; i++) {
    const base = sig(rng() * 0.9);
    next++;
    bots.push({ id: `v${String(next).padStart(4, '0')}`, base, knobs: sampleKnobs(rng, base) });
  }
  savePopulation(bots);
  console.log(`population: ${bots.length} bots`);
}

// ------------------------------------------------------------------ fitting

/** Every game as pairs: each two bots in it, the higher score winning and an equal
 *  score a draw. A game of n bots counts each pair 1/(n-1), so a four-bot game is
 *  not worth three head-to-heads. */
function pairs(games: Game[]): { a: string; b: string; s: number; w: number }[] {
  const out: { a: string; b: string; s: number; w: number }[] = [];
  for (const g of games) {
    const w = 1 / (g.bots.length - 1);
    for (let i = 0; i < g.bots.length; i++) {
      for (let j = i + 1; j < g.bots.length; j++) {
        const s = g.scores[i] > g.scores[j] ? 1 : g.scores[i] < g.scores[j] ? 0 : 0.5;
        out.push({ a: g.bots[i], b: g.bots[j], s, w });
      }
    }
  }
  return out;
}

/** Bradley-Terry ratings by Newton's method, one bot at a time, each pulled gently
 *  towards a prior: the previous version's rating where there is one, else 1500. */
function fitRatings(bots: Bot[], games: Game[], prior: Fit | null, version: string): Fit {
  const ps = pairs(games);
  const r = new Map<string, number>();
  const priorMean = new Map<string, number>();
  const priorSd = new Map<string, number>();
  for (const b of bots) {
    const old = prior?.bots[b.id];
    const carried = old && prior!.version !== version;
    priorMean.set(b.id, old ? old.rating : ANCHOR_RATING);
    priorSd.set(b.id, carried ? CARRIED_SD : 2000);
    r.set(b.id, old ? old.rating : ANCHOR_RATING);
  }
  const by = new Map<string, typeof ps>();
  for (const p of ps) {
    if (!r.has(p.a) || !r.has(p.b)) continue;
    (by.get(p.a) ?? by.set(p.a, []).get(p.a)!).push(p);
    (by.get(p.b) ?? by.set(p.b, []).get(p.b)!).push({ a: p.b, b: p.a, s: 1 - p.s, w: p.w });
  }
  const hess = new Map<string, number>();
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    for (const b of bots) {
      const ri = r.get(b.id)!;
      const sd = priorSd.get(b.id)!;
      let grad = -(ri - priorMean.get(b.id)!) / (sd * sd);
      let h = 1 / (sd * sd);
      for (const p of by.get(b.id) ?? []) {
        const e = 1 / (1 + Math.exp(-K * (ri - r.get(p.b)!)));
        grad += p.w * K * (p.s - e);
        h += p.w * K * K * e * (1 - e);
      }
      const step = Math.max(-200, Math.min(200, grad / h));
      r.set(b.id, ri + step);
      hess.set(b.id, h);
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 0.01) break;
  }
  const shift = ANCHOR_RATING - (r.get(ANCHOR) ?? ANCHOR_RATING);
  const played = new Map<string, number>();
  for (const g of games) for (const id of g.bots) played.set(id, (played.get(id) ?? 0) + 1);
  const out: Fit = { version, fittedAt: new Date().toISOString(), games: games.length, bots: {} };
  for (const b of bots) {
    out.bots[b.id] = {
      rating: Math.round(r.get(b.id)! + shift),
      se: Math.round(1 / Math.sqrt(hess.get(b.id)!)),
      games: played.get(b.id) ?? 0,
    };
  }
  return out;
}

function fit(): Fit {
  const version = botVersion();
  const bots = loadPopulation();
  const games = loadGames().filter((g) => g.version === version);
  const result = fitRatings(bots, games, loadFit(), version);
  fs.writeFileSync(RATINGS, `${JSON.stringify(result, null, 1)}\n`);
  return result;
}

// ------------------------------------------------------------------ playing

function pick<T>(rng: Rng, items: [T, number][]): T {
  let x = rng() * items.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1][0];
}

/** A game's board and length, and who plays it: one bot (favouring the least
 *  played), then opponents near its rating. */
function design(rng: Rng, bots: Bot[], fitNow: Fit | null, played: Map<string, number>, id: number, version: string): Game {
  const grid = pick(rng, [[4, 0.55], [5, 0.3], [6, 0.15]]);
  const mode = rng() < 0.6 ? 'points' : 'time';
  const length =
    mode === 'points'
      ? pick(rng, [[30, 0.6], [50, 0.3], [100, 0.1]])
      : pick(rng, [[60, 0.2], [120, 0.3], [180, 0.3], [300, 0.2]]);
  const n = pick(rng, [[2, 0.75], [3, 0.15], [4, 0.1]]);
  const guess = (b: Bot) => fitNow?.bots[b.id]?.rating ?? -800 + (b.base / 0.62) * 3600;
  const first = pick(rng, bots.map((b) => [b, 1 / (1 + (played.get(b.id) ?? 0)) ** 2] as [Bot, number]));
  const chosen = [first];
  while (chosen.length < n) {
    const pool = bots.filter((b) => !chosen.includes(b));
    chosen.push(pick(rng, pool.map((b) => [b, Math.exp(-(((guess(b) - guess(first)) / 350) ** 2)) + 1e-6] as [Bot, number])));
  }
  for (const b of chosen) played.set(b.id, (played.get(b.id) ?? 0) + 1);
  return { id, version, bots: chosen.map((b) => b.id), grid, mode, length, seed: Math.floor(rng() * 2 ** 31), scores: [] };
}

async function play(total: number, workers: number): Promise<void> {
  const version = botVersion();
  const bots = loadPopulation();
  if (bots.length < 4) throw new Error('grow the population first');
  const byId = new Map(bots.map((b) => [b.id, b]));
  const existing = loadGames();
  let nextId = existing.reduce((m, g) => Math.max(m, g.id), 0) + 1;
  const played = new Map<string, number>();
  for (const g of existing) if (g.version === version) for (const b of g.bots) played.set(b, (played.get(b) ?? 0) + 1);
  const rng = seeded(nextId * 104729 + 3);
  let fitNow = loadFit();

  console.log(`playing ${total} games on ${workers} workers, bot version ${version}`);
  const procs = Array.from({ length: workers }, () => fork(process.argv[1], ['worker'], { execArgv: process.execArgv }));
  let done = 0;
  let sinceFit = 0;
  const t0 = Date.now();
  const queue: Game[] = [];
  const refill = () => {
    while (queue.length < workers * 4 && done + queue.length + inFlight < total) queue.push(design(rng, bots, fitNow, played, nextId++, version));
  };
  let inFlight = 0;
  await new Promise<void>((resolve) => {
    const feed = (p: (typeof procs)[number]) => {
      refill();
      const g = queue.shift();
      if (!g) {
        if (inFlight === 0) resolve();
        return;
      }
      inFlight++;
      p.send({ game: g, knobs: g.bots.map((id) => byId.get(id)!.knobs) });
    };
    for (const p of procs) {
      p.on('message', (msg: { game: Game }) => {
        inFlight--;
        done++;
        sinceFit++;
        fs.appendFileSync(GAMES, `${JSON.stringify(msg.game)}\n`);
        if (sinceFit >= REFIT_EVERY) {
          sinceFit = 0;
          fitNow = fit();
          const rate = done / ((Date.now() - t0) / 1000);
          console.log(`  ${done}/${total} games, ${rate.toFixed(1)}/s, refitted`);
        }
        feed(p);
      });
      feed(p);
    }
  });
  for (const p of procs) p.kill();
  fit();
  console.log(`played ${done} games in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
}

function worker(): void {
  loadDictionary();
  loadFrequencies();
  process.on('message', ({ game, knobs }: { game: Game; knobs: Knobs[] }) => {
    const secs = game.mode === 'time' ? game.length : POINTS_CAP_SECS;
    const target = game.mode === 'points' ? game.length : 0;
    const stats = playOne(knobs, game.grid, secs, target, game.seed, false);
    process.send!({ game: { ...game, scores: stats.map((s) => s.score) } });
  });
}

// ------------------------------------------------------------------ reading

function report(): void {
  const version = botVersion();
  const bots = loadPopulation();
  const result = loadFit();
  if (!result) throw new Error('nothing fitted yet');
  const games = loadGames().filter((g) => g.version === version);
  const rated = bots.filter((b) => result.bots[b.id]?.games);
  console.log(`${rated.length} bots, ${games.length} games at bot version ${version}${result.version !== version ? ` (fit is from ${result.version})` : ''}\n`);

  console.log('named levels');
  for (const b of bots.filter((b) => b.level)) {
    const f = result.bots[b.id];
    console.log(`  ${b.level!.padEnd(13)} ${String(f.rating).padStart(5)} ± ${f.se}   (${f.games} games)`);
  }

  // How much each knob moves strength: rating regressed on every knob at once (log
  // knobs where they are all positive), each coefficient the change in rating for
  // one standard deviation of that knob across the population.
  const keys = Object.keys(bots[0].knobs) as (keyof Knobs)[];
  const x = (b: Bot, k: keyof Knobs) => (range(k)[0] > 0 ? Math.log(b.knobs[k]) : b.knobs[k]);
  const cols = keys.map((k) => {
    const v = rated.map((b) => x(b, k));
    const m = v.reduce((a, c) => a + c, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, c) => a + (c - m) ** 2, 0) / v.length) || 1;
    return v.map((c) => (c - m) / sd);
  });
  const y = rated.map((b) => result.bots[b.id].rating);
  const beta = ols(cols, y);
  console.log('\nrating per standard deviation of each knob, all knobs together');
  keys
    .map((k, i) => [k, beta[i + 1]] as const)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .forEach(([k, c]) => console.log(`  ${k.padEnd(13)} ${c >= 0 ? '+' : ''}${Math.round(c)}`));

  // How often the higher-rated bot wins, by board: how much each kind of game
  // rewards being better.
  console.log('\nhigher-rated bot wins, head-to-head, by board');
  const buckets = new Map<string, [number, number]>();
  for (const g of games) {
    if (g.bots.length !== 2) continue;
    const [a, b] = g.bots.map((id) => result.bots[id].rating);
    if (Math.abs(a - b) < 50 || g.scores[0] === g.scores[1]) continue;
    const key = `${g.grid}x${g.grid} ${g.mode === 'points' ? `to ${g.length}` : `${g.length}s`}`;
    const t = buckets.get(key) ?? [0, 0];
    t[0] += (a > b) === (g.scores[0] > g.scores[1]) ? 1 : 0;
    t[1]++;
    buckets.set(key, t);
  }
  for (const [k, [w, n]] of [...buckets].sort()) console.log(`  ${k.padEnd(14)} ${((w / n) * 100).toFixed(0)}%  of ${n}`);
}

/** Least squares with an intercept, by the normal equations. */
function ols(cols: number[][], y: number[]): number[] {
  const n = y.length;
  const X = Array.from({ length: n }, (_, i) => [1, ...cols.map((c) => c[i])]);
  const p = X[0].length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((s, row, r) => s + row[i] * y[r], 0));
  for (let i = 0; i < p; i++) A[i][i] += 1e-6;
  // Gaussian elimination.
  for (let i = 0; i < p; i++) {
    let m = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]];
    [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < p; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < p; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const out = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < p; c++) s -= A[i][c] * out[c];
    out[i] = s / A[i][i];
  }
  return out;
}

/** Bots near each target rating, the best measured first, with how each differs
 *  most from the plain dial at its base: candidates for a named level. */
function pickBots(targets: number[]): void {
  const bots = loadPopulation();
  const result = loadFit();
  if (!result) throw new Error('nothing fitted yet');
  for (const t of targets) {
    console.log(`\nnear ${t}`);
    bots
      .filter((b) => result.bots[b.id]?.games)
      .map((b) => ({ b, f: result.bots[b.id] }))
      .sort((a, c) => Math.abs(a.f.rating - t) + a.f.se - (Math.abs(c.f.rating - t) + c.f.se))
      .slice(0, 5)
      .forEach(({ b, f }) => {
        const plain = knobsFor(b.base);
        const odd = (Object.keys(b.knobs) as (keyof Knobs)[])
          .filter((k) => plain[k] > 0 && b.knobs[k] > 0)
          .map((k) => [k, b.knobs[k] / plain[k]] as const)
          .sort((a, c) => Math.abs(Math.log(c[1])) - Math.abs(Math.log(a[1])))
          .slice(0, 3)
          .map(([k, r]) => `${k} x${r.toFixed(2)}`);
        console.log(`  ${b.id.padEnd(13)} ${String(f.rating).padStart(5)} ± ${String(f.se).padEnd(4)} base ${b.base.toFixed(3)}  ${b.level ? '(named)' : odd.join(', ')}`);
      });
  }
}

// ------------------------------------------------------------------ command line

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'worker') return worker();
  if (cmd === 'grow') return grow(Number(arg('bots', '100')));
  if (cmd === 'play') return play(Number(arg('games', '1000')), Number(arg('workers', String(Math.max(1, os.cpus().length - 1)))));
  if (cmd === 'fit') {
    const f = fit();
    return console.log(`fitted ${Object.keys(f.bots).length} bots on ${f.games} games`);
  }
  if (cmd === 'report') return report();
  if (cmd === 'pick') return pickBots(String(process.argv[3] ?? '1500').split(',').map(Number));
  console.log('usage: tournament grow|play|fit|report|pick (see the top of tournament.ts)');
}

void main();
