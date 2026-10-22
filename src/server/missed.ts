// The words nobody played. Every time the board changes, every word on it is looked
// at as a claim someone could have made then, and the best few of each kind are kept
// with the board as it stood. When the match ends, any word somebody did play at
// some point is struck off, and one of each kind is left for the recap.
//
// A full scan is a millisecond or two even on 6x6, and the board only changes on a
// claim or a bank, so there is no need to be cleverer than that.

import * as R from '../shared/rules';
import type { BoardShot, GameState, MissKind, MissedWord } from '../shared/types';
import { findPaths } from './bot/finder';
import { corpusRank } from './frequency';

/** Long enough for anything a board will realistically hold. */
const MAX_LEN = 12;
/** Kept per kind, so the best can lose a few to words played later and still leave one. */
const KEEP = 24;
/** Rarer than this and nobody would feel they missed it. */
const KNOWN_LONGEST = 25_000;
const KNOWN_BIGGEST = 20_000;
const EASIEST_MAX_LEN = 4;

interface Candidate extends Omit<MissedWord, 'kind'> {
  rank: number;
  /** Letters of the claims it breaks. */
  broken: number;
}

/** Lower sorts first. */
const ORDER: Record<MissKind, (a: Candidate, b: Candidate) => number> = {
  longest: (a, b) => b.word.length - a.word.length || a.rank - b.rank,
  biggest: (a, b) => b.broken - a.broken || a.word.length - b.word.length || a.rank - b.rank,
  easiest: (a, b) => a.rank - b.rank || b.broken - a.broken,
};

const FITS: Record<MissKind, (c: Candidate) => boolean> = {
  longest: (c) => c.word.length >= 3 && c.rank < KNOWN_LONGEST,
  biggest: (c) => c.breaks.length > 0 && c.rank < KNOWN_BIGGEST,
  easiest: (c) => c.breaks.length >= 2 && c.word.length <= EASIEST_MAX_LEN,
};

const KINDS: MissKind[] = ['longest', 'biggest', 'easiest'];

export class Scout {
  private best: Record<MissKind, Candidate[]> = { longest: [], biggest: [], easiest: [] };
  private played = new Set<string>();

  /** A word somebody played, which can never be a miss. */
  playedWord(word: string): void {
    this.played.add(word);
  }

  /** Everything that could be claimed on the board as it stands. */
  look(game: GameState, now: number): void {
    const letters = game.grid.map((t) => t.letter);
    const owner = new Map<number, (typeof game.claims)[number]>();
    for (const c of game.claims) for (const id of c.tileIds) owner.set(R.tileIndex(game, id), c);
    let shot: BoardShot | null = null;

    for (const f of findPaths(letters, game.size, 2, MAX_LEN)) {
      const touching = [...new Set(f.idx.flatMap((i) => owner.get(i) ?? []))];
      if (touching.some((c) => c.word.length >= f.word.length)) continue;
      shot ??= {
        letters: letters.join(''),
        claims: game.claims.map((c) => ({
          playerId: c.playerId,
          idx: c.tileIds.map((id) => R.tileIndex(game, id)),
          fill: Math.min(1, Math.max(0, (now - c.claimedAt) / (c.banksAt - c.claimedAt))),
        })),
      };
      const cand: Candidate = {
        word: f.word,
        idx: f.idx,
        board: shot,
        breaks: touching.map((c) => ({ playerId: c.playerId, word: c.word })),
        rank: corpusRank(f.word) ?? Infinity,
        broken: touching.reduce((n, c) => n + c.word.length, 0),
      };
      for (const k of KINDS) if (FITS[k](cand)) this.offer(k, cand);
    }
  }

  private offer(kind: MissKind, cand: Candidate): void {
    const list = this.best[kind];
    const order = ORDER[kind];
    // One sighting per word, the best of them.
    const same = list.findIndex((c) => c.word === cand.word);
    if (same >= 0) {
      if (order(cand, list[same]) >= 0) return;
      list.splice(same, 1);
    }
    if (list.length >= KEEP && order(cand, list[list.length - 1]) >= 0) return;
    list.push(cand);
    list.sort(order);
    if (list.length > KEEP) list.pop();
  }

  /** One of each kind that somebody could have played and nobody did, each a
   *  different word. */
  result(): MissedWord[] {
    const out: MissedWord[] = [];
    const used = new Set<string>();
    for (const kind of KINDS) {
      const c = this.best[kind].find((c) => !this.played.has(c.word) && !used.has(c.word));
      if (!c) continue;
      used.add(c.word);
      out.push({ kind, word: c.word, idx: c.idx, board: c.board, breaks: c.breaks });
    }
    return out;
  }
}
