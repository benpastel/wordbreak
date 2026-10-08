// Plays whole matches between bots on a virtual clock, using the real rules, and
// reports how each difficulty played. For tuning knobs.ts.
//
//   npx tsx src/server/bot/sim.ts --bots 0.25,0.5,0.75 --games 20 --grid 4 --secs 180
//
// --log prints the first match move by move. --target N plays to points instead.

import * as R from '../../shared/rules';
import { HOLD_MS } from '../../shared/types';
import { isWord, loadDictionary } from '../dictionary';
import { corpusRank, loadFrequencies } from '../frequency';
import { Brain } from './brain';
import { seeded } from './rng';

const DT = 50;

interface Stat {
  score: number;
  claims: number;
  failed: number;
  banked: number;
  brokenByOthers: number;
  brokeOthers: number;
  extended: number;
  lengths: number[];
  gaps: number[];
  rare: number;
  words: string[];
}

const blank = (): Stat => ({
  score: 0, claims: 0, failed: 0, banked: 0, brokenByOthers: 0, brokeOthers: 0,
  extended: 0, lengths: [], gaps: [], rare: 0, words: [],
});

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const fmtT = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
};

function playOne(ds: number[], size: number, secs: number, target: number, seed: number, log: boolean): Stat[] {
  Math.random = seeded(seed); // the board's letters, so a match can be replayed
  let nextId = 1;
  const alloc = () => nextId++;
  const end = secs * 1000;
  const hold = HOLD_MS[size];
  const game = R.newGame(size, alloc, target ? null : end);
  const brains = ds.map((d, i) => new Brain(`b${i}`, d, seed * 7919 + i * 104729));
  const stats = ds.map(blank);
  const last = ds.map(() => -1);
  const order = ds.map((_, i) => i);
  const rng = seeded(seed ^ 0x5eed);
  const who = (id: string) => Number(id.slice(1));
  const name = (i: number) => `b${i}(${ds[i]})`;
  let seq = 1;
  let t = 0;

  for (; t < end; t += DT) {
    for (const c of [...game.claims]) {
      if (c.banksAt > t) continue;
      const i = who(c.playerId);
      const { points } = R.bankClaim(game, c, alloc);
      stats[i].score += points;
      stats[i].banked++;
    }
    if (target && stats.some((s) => s.score >= target)) break;

    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    for (const i of order) {
      const a = brains[i].tick(game, t, DT);
      if (!a) continue;
      if (R.validatePath(game, a.tileIds) !== null) {
        stats[i].failed++;
        if (log) console.log(`  ${fmtT(t)}  ${name(i).padEnd(9)} (too late)`);
        continue;
      }
      const word = R.wordOf(game, a.tileIds);
      if (!isWord(word)) {
        stats[i].failed++;
        continue;
      }
      const { broken } = R.applyClaim(game, a.tileIds, `b${i}`, word, t, hold, `c${seq++}`);
      const s = stats[i];
      s.claims++;
      s.lengths.push(word.length);
      s.words.push(word);
      if ((corpusRank(word) ?? Infinity) > 20_000) s.rare++;
      if (last[i] >= 0) s.gaps.push(t - last[i]);
      last[i] = t;
      const notes: string[] = [];
      for (const b of broken) {
        const owner = who(b.playerId);
        if (owner === i) {
          s.extended++;
          notes.push(`extends own ${b.word.toUpperCase()}`);
        } else {
          s.brokeOthers++;
          stats[owner].brokenByOthers++;
          const fill = Math.round(((t - b.claimedAt) / (b.banksAt - b.claimedAt)) * 100);
          notes.push(`breaks ${name(owner)} ${b.word.toUpperCase()} at ${fill}%`);
        }
      }
      if (log) console.log(`  ${fmtT(t)}  ${name(i).padEnd(9)} ${word.toUpperCase().padEnd(10)} ${notes.join(', ')}`);
    }
  }
  // The buzzer pays out whatever is still held.
  for (const c of game.claims) stats[who(c.playerId)].score += c.tileIds.length;
  if (log) console.log(`  ${fmtT(t)}  end — ${stats.map((s, i) => `${name(i)} ${s.score}`).join(', ')}\n`);
  return stats;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function main() {
  loadDictionary();
  loadFrequencies();
  const ds = arg('bots', '0.5').split(',').map(Number);
  const games = Number(arg('games', '10'));
  const size = Number(arg('grid', '4'));
  const secs = Number(arg('secs', '180'));
  const target = Number(arg('target', '0'));
  const seed = Number(arg('seed', '1'));
  const log = process.argv.includes('--log');

  console.log(
    `${games} × ${size}x${size}, ${target ? `to ${target} points` : `${secs}s`}, bots ${ds.join(' / ')}\n`,
  );
  const all: Stat[][] = [];
  for (let g = 0; g < games; g++) all.push(playOne(ds, size, secs, target, seed * 1000 + g, log && g === 0));

  const wins = ds.map(() => 0);
  for (const st of all) {
    const top = Math.max(...st.map((s) => s.score));
    st.forEach((s, i) => s.score === top && wins[i]++);
  }
  const mins = target ? NaN : secs / 60;

  for (let i = 0; i < ds.length; i++) {
    const st = all.map((g) => g[i]);
    const lengths = st.flatMap((s) => s.lengths);
    const hist: string[] = [];
    for (let L = 2; L <= 8; L++) {
      const n = lengths.filter((x) => (L === 8 ? x >= 8 : x === L)).length;
      hist.push(`${L === 8 ? '8+' : L}:${Math.round((n / Math.max(1, lengths.length)) * 100)}%`);
    }
    const claims = st.reduce((a, s) => a + s.claims, 0);
    const banked = st.reduce((a, s) => a + s.banked, 0);
    console.log(`b${i}  difficulty ${ds[i]}`);
    console.log(
      `  score ${mean(st.map((s) => s.score)).toFixed(1)}  (wins ${wins[i]}/${games})` +
        `   claims/min ${(claims / games / mins).toFixed(1)}   failed/game ${(st.reduce((a, s) => a + s.failed, 0) / games).toFixed(1)}`,
    );
    console.log(
      `  median gap ${(median(st.flatMap((s) => s.gaps)) / 1000).toFixed(1)}s   banked ${Math.round((banked / Math.max(1, claims)) * 100)}%` +
        `   breaks others ${(st.reduce((a, s) => a + s.brokeOthers, 0) / games).toFixed(1)}/game` +
        `   broken by others ${(st.reduce((a, s) => a + s.brokenByOthers, 0) / games).toFixed(1)}/game` +
        `   extends own ${(st.reduce((a, s) => a + s.extended, 0) / games).toFixed(1)}/game`,
    );
    console.log(
      `  length ${mean(lengths).toFixed(2)}  ${hist.join(' ')}   rarer than top 20k: ${Math.round((st.reduce((a, s) => a + s.rare, 0) / Math.max(1, claims)) * 100)}%`,
    );
    console.log(`  e.g. ${st[0].words.slice(0, 18).join(' ')}\n`);
  }
}

if (require.main === module) main();
