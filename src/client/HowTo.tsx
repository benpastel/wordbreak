import { useEffect, useState } from 'react';
import { center, chevrons, points, viewBoxOf } from './trail';

// How to play, as three looping demos on one 4x4 board, drawn with the game's own
// tiles. You are blue, and red already holds DUG along the bottom:
//
//   1. you slide O-A-T (a diagonal, then back up) and claim it
//   2. with OAT still yours, you slide H-U-G-S across red's DUG and break it
//   3. OAT fills, flies into your score, and new letters drop in; HUGS fills on
//
// The fills carry on from one step to the next, so the three read as one game.
// Each demo is a pure function from time to a frame, so a loop is just time
// modulo its length, and reduced motion shows one telling frame, still.

const N = 4;
const LETTERS = 'STOPRANELIDEHUGS'.split('');
const BLUE = 0;
const RED = 1;

const OAT = [2, 5, 1];
const DUG = [10, 13, 14];
const HUGS = [12, 13, 14, 15];
/** What drops into OAT's tiles once it has banked. */
const RESEED: Record<number, string> = { 2: 'I', 5: 'E', 1: 'W' };

/** Fade out at the end of a loop and back in at the start. */
const FADE_MS = 300;
/** A slide's pace from one tile to the next. */
const STEP_MS = 520;

interface Claim {
  idx: number[];
  color: number;
  /** 0 to 1 through its hold. */
  fill: number;
}

interface Frame {
  letters: string[];
  claims: Claim[];
  sel: number[];
  /** Where the finger or cursor is, in cell units from the board's corner. */
  pointer: { x: number; y: number; down: boolean } | null;
  broke: number[];
  reseed: number[];
  score: number | null;
  flyers: { x: number; y: number; letter: string }[];
}

interface Demo {
  ms: number;
  /** Shown instead of the loop to anyone who asks for less motion. */
  still: number;
  frame: (t: number) => Frame;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2);
/** A tile's centre in cell units, measured from the board's outer corner. */
const at = (i: number) => ({ x: center(i % N) + 0.1, y: center(Math.floor(i / N)) + 0.1 });

/** A slide along `path` starting at `start`: where the pointer is and how many
 *  tiles it has picked up so far. Before the start it waits just off the first tile. */
function slide(path: number[], start: number, t: number) {
  if (t < start) {
    const p = at(path[0]);
    return { x: p.x + 0.55, y: p.y + 0.7, picked: 0 };
  }
  const k = (t - start) / STEP_MS;
  const seg = Math.min(path.length - 1, Math.floor(k));
  const from = at(path[seg]);
  const to = at(path[Math.min(path.length - 1, seg + 1)]);
  const f = seg >= path.length - 1 ? 0 : ease(k - seg);
  return {
    x: from.x + (to.x - from.x) * f,
    y: from.y + (to.y - from.y) * f,
    picked: Math.min(path.length, seg + 1 + (f > 0.6 ? 1 : 0)),
  };
}

const blank = (): Frame => ({
  letters: LETTERS,
  claims: [],
  sel: [],
  pointer: null,
  broke: [],
  reseed: [],
  score: null,
  flyers: [],
});

const CLAIM: Demo = {
  ms: 4200,
  still: 2600,
  frame: (t) => {
    const f = blank();
    const start = 600;
    const release = start + STEP_MS * (OAT.length - 1) + 250;
    const s = slide(OAT, start, t);
    const dug: Claim = { idx: DUG, color: RED, fill: 0.15 + (t / 4200) * 0.15 };
    if (t < release) {
      f.claims = [dug];
      f.sel = OAT.slice(0, s.picked);
      f.pointer = { x: s.x, y: s.y, down: t >= start };
    } else {
      f.claims = [dug, { idx: OAT, color: BLUE, fill: ((t - release) / (4200 - release)) * 0.2 }];
      if (t < release + 500) f.pointer = { x: s.x + 0.2 * ((t - release) / 500), y: s.y + 0.3 * ((t - release) / 500), down: false };
    }
    return f;
  },
};

const BREAK: Demo = {
  ms: 5000,
  still: 3500,
  frame: (t) => {
    const f = blank();
    const start = 700;
    const release = start + STEP_MS * (HUGS.length - 1) + 250;
    const s = slide(HUGS, start, t);
    const oat: Claim = { idx: OAT, color: BLUE, fill: 0.2 + (t / 5000) * 0.3 };
    if (t < release) {
      f.claims = [oat, { idx: DUG, color: RED, fill: 0.3 + (t / 5000) * 0.25 }];
      f.sel = HUGS.slice(0, s.picked);
      f.pointer = { x: s.x, y: s.y, down: t >= start };
    } else {
      f.claims = [oat, { idx: HUGS, color: BLUE, fill: ((t - release) / (5000 - release)) * 0.15 }];
      // The broken tiles shake once, as on the board.
      if (t < release + 420) f.broke = DUG;
      if (t < release + 500) f.pointer = { x: s.x + 0.2 * ((t - release) / 500), y: s.y + 0.3 * ((t - release) / 500), down: false };
    }
    return f;
  },
};

/** Where the score sits, under the board's middle, in cell units. */
const SCORE_AT = { x: (N * 1.1 + 0.1) / 2, y: N * 1.1 + 0.1 + 0.75 };

const POINTS: Demo = {
  ms: 5200,
  still: 3600,
  frame: (t) => {
    const f = blank();
    const full = 2600;
    const flyMs = 560;
    const stagger = 90;
    // HUGS carries on filling underneath the whole time.
    const hugs: Claim = { idx: HUGS, color: BLUE, fill: 0.15 + (t / 5200) * 0.45 };
    if (t < full) {
      f.claims = [{ idx: OAT, color: BLUE, fill: 0.5 + 0.5 * ease(t / full) }, hugs];
      f.score = 0;
      return f;
    }
    // Banked: each letter flies to the score, and new letters come in behind it.
    f.claims = [hugs];
    const letters = [...LETTERS];
    for (const [i, l] of Object.entries(RESEED)) letters[Number(i)] = l;
    f.letters = letters;
    if (t < full + 700) f.reseed = OAT;
    let landed = 0;
    OAT.forEach((i, n) => {
      const k = clamp01((t - full - n * stagger) / flyMs);
      if (k >= 1) {
        landed++;
        return;
      }
      const p = at(i);
      const e = ease(k);
      f.flyers.push({ x: p.x + (SCORE_AT.x - p.x) * e, y: p.y + (SCORE_AT.y - p.y) * e, letter: LETTERS[i] });
    });
    f.score = landed;
    return f;
  },
};

function useClock(ms: number, still: number): number {
  const [t, setT] = useState(still);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setT((now - t0) % ms);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return t;
}

function DemoBoard({ demo, touch }: { demo: Demo; touch: boolean }) {
  const t = useClock(demo.ms, demo.still);
  const f = demo.frame(t);
  const fade = Math.min(clamp01(t / FADE_MS), clamp01((demo.ms - t) / FADE_MS));
  const owner = new Map<number, Claim>();
  for (const c of f.claims) for (const i of c.idx) owner.set(i, c);
  const vb = viewBoxOf(N);
  const cu = (v: number) => `calc(var(--cell) * ${v.toFixed(3)})`;

  return (
    <div className={f.score !== null ? 'demo scored' : 'demo'} style={{ opacity: fade }}>
      <div className="board" aria-hidden="true">
        <svg className="trail" viewBox={`0 0 ${vb} ${vb}`}>
          {f.claims.map((c, k) => (
            <g key={k} className={`c${c.color}`} stroke="var(--pc)">
              <polyline points={points(c.idx, N)} />
              <path className="dir" d={chevrons(c.idx, N)} />
            </g>
          ))}
          {f.sel.length > 1 && <polyline className="sel" points={points(f.sel, N)} />}
        </svg>
        {f.letters.map((l, i) => {
          const c = owner.get(i);
          const cls = [
            'tile',
            c ? `claimed c${c.color}` : '',
            f.sel.includes(i) ? 'sel' : '',
            f.broke.includes(i) ? 'broke' : '',
            f.reseed.includes(i) ? 'reseed' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={i}
              className={cls}
              style={c ? ({ '--p': `${(clamp01(c.fill) * 100).toFixed(1)}%` } as React.CSSProperties) : undefined}
            >
              <span>{l}</span>
            </div>
          );
        })}
      </div>
      {f.flyers.map((fl, k) => (
        <div
          key={k}
          className="demoflyer c0"
          style={{ left: cu(fl.x), top: cu(fl.y) }}
          aria-hidden="true"
        >
          {fl.letter}
        </div>
      ))}
      {f.score !== null && (
        <div className="demoscore c0" style={{ left: cu(SCORE_AT.x), top: cu(SCORE_AT.y) }}>
          {f.score}
        </div>
      )}
      {f.pointer && (
        <div
          className={`demopointer${touch ? ' touch' : ''}${f.pointer.down ? ' down' : ''}`}
          style={{ left: cu(f.pointer.x), top: cu(f.pointer.y) }}
          aria-hidden="true"
        >
          {!touch && (
            <svg viewBox="0 0 16 22" width="18" height="24">
              <path d="M1 1v17l4.5-4.2 3 6.7 3-1.4-3-6.6h6.2z" fill="var(--ink)" stroke="var(--tile-face)" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}
    </div>
  );
}

export default function HowTo() {
  // A phone gets a finger and the word "slide"; a mouse gets a cursor.
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  return (
    <section className="howto">
      <h2>how to play</h2>
      <ol>
        <li>
          <p>{touch ? 'Slide to claim a word' : 'Click-and-drag to claim a word'}</p>
          <DemoBoard demo={CLAIM} touch={touch} />
        </li>
        <li>
          <p>
            <span>
              <strong>LONGER</strong> words break claims
            </span>
          </p>
          <DemoBoard demo={BREAK} touch={touch} />
        </li>
        <li>
          <p>When filled, you get points</p>
          <DemoBoard demo={POINTS} touch={touch} />
        </li>
      </ol>
    </section>
  );
}
