// Board animations: a bank, and a break (further down).
//
// Bank animation: the claimed tiles detach and fly into the owner's score.
//
// The board itself is a pure render of server state, so by the time this runs the
// cells already hold their reseeded letters. The flyers are therefore built from
// scratch out of the letters carried on the fx event, and only borrow the tiles'
// screen positions — which are positional and so unaffected by the reseed.

import type { Fx } from '../shared/types';
import { BREAK_FALL_MS } from './sound';
import { center, viewBoxOf } from './trail';

const FLY_MS = 620;
const STAGGER_MS = 40;

export function playBankFx(
  board: HTMLElement,
  f: Extract<Fx, { k: 'banked' }>,
  color: number,
): void {
  const target = document.querySelector<HTMLElement>(`[data-player="${f.playerId}"] .pts`);
  const tr = target?.getBoundingClientRect();

  f.idx.forEach((i, n) => {
    const el = board.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();

    const flyer = document.createElement('div');
    flyer.className = `flyer c${color}`;
    flyer.textContent = f.letters[n] ?? '';
    flyer.style.left = `${r.left}px`;
    flyer.style.top = `${r.top}px`;
    flyer.style.width = `${r.width}px`;
    flyer.style.height = `${r.height}px`;
    flyer.style.setProperty('--fly', `${r.width}px`);
    document.body.appendChild(flyer);

    const dx = tr ? tr.left + tr.width / 2 - (r.left + r.width / 2) : 0;
    const dy = tr ? tr.top + tr.height / 2 - (r.top + r.height / 2) : -80;

    const anim = flyer.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
        { transform: 'translate(0,0) scale(1.1)', opacity: 1, offset: 0.16 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px,${dy}px) scale(0.18)`, opacity: 0, offset: 1 },
      ],
      { duration: FLY_MS, delay: n * STAGGER_MS, easing: 'cubic-bezier(.4,0,.25,1)', fill: 'both' },
    );
    anim.onfinish = () => flyer.remove();
    anim.oncancel = () => flyer.remove();
  });

  if (target) {
    target.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }],
      {
        duration: 340,
        delay: FLY_MS * 0.75,
        easing: 'ease-out',
      },
    );
  }
}

// Break animation: a claim snaps, cracks and falls apart.
//
// By the time this runs the board already shows what broke it (the breaker's claim
// over most of the same tiles), so the broken claim is drawn again on top, briefly,
// to come apart: the line joining its tiles snaps in the middle of each step; a
// crack runs out from a point on each tile, one after the next along the word; then
// its colour falls away in exactly the pieces the crack cut. The letters never move.

const CRACK_MS = 90;
const BREAK_STAGGER_MS = 35;
const FALL_MS = 430;
const SVG = 'http://www.w3.org/2000/svg';

type Pt = [number, number];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** A jagged line from P out to the tile's edge at angle a, in the tile's 0-100 square. */
function ray(P: Pt, a: number): Pt[] {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const tx = dx > 1e-6 ? (100 - P[0]) / dx : dx < -1e-6 ? -P[0] / dx : Infinity;
  const ty = dy > 1e-6 ? (100 - P[1]) / dy : dy < -1e-6 ? -P[1] / dy : Infinity;
  const len = Math.min(tx, ty);
  const steps = 3 + Math.floor(Math.random() * 2);
  const pts: Pt[] = [P];
  for (let i = 1; i < steps; i++) {
    const j = rnd(-1, 1) * 9;
    pts.push([clamp(P[0] + dx * len * (i / steps) - dy * j), clamp(P[1] + dy * len * (i / steps) + dx * j)]);
  }
  pts.push([clamp(P[0] + dx * len), clamp(P[1] + dy * len)]);
  return pts;
}

/** How far round the edge a point is, clockwise from the top-left corner: 0 to 400. */
function around([x, y]: Pt): number {
  if (y <= 0.01) return x;
  if (x >= 99.99) return 100 + y;
  if (y >= 99.99) return 200 + (100 - x);
  return 300 + (100 - y);
}
const CORNERS: [number, Pt][] = [[100, [100, 0]], [200, [100, 100]], [300, [0, 100]], [400, [0, 0]]];

/** A crack of four or five rays from somewhere near the middle, and the pieces it
 *  cuts: each the stretch of tile between two neighbouring rays, corners included,
 *  with the way it should fall (out from the crack's centre). */
function shatter(): { rays: Pt[][]; pieces: { poly: Pt[]; dir: Pt }[] } {
  const P: Pt = [rnd(35, 65), rnd(35, 65)];
  const count = Math.random() < 0.5 ? 4 : 5;
  const base = rnd(0, Math.PI * 2);
  const rays = Array.from({ length: count }, (_, i) =>
    ray(P, base + (i * 2 * Math.PI) / count + rnd(-0.35, 0.35) * (Math.PI / count)),
  );
  const pieces = rays.map((r, i) => {
    const next = rays[(i + 1) % count];
    const a = around(r[r.length - 1]);
    let b = around(next[next.length - 1]);
    if (b <= a) b += 400;
    const corners = [...CORNERS, ...CORNERS.map(([t, c]): [number, Pt] => [t + 400, c])]
      .filter(([t]) => t > a && t < b)
      .map(([, c]) => c);
    const poly = [...r, ...corners, ...[...next].reverse().slice(0, -1)];
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const d = Math.hypot(cx - P[0], cy - P[1]) || 1;
    return { poly, dir: [(cx - P[0]) / d, (cy - P[1]) / d] as Pt };
  });
  return { rays, pieces };
}

/**
 * `idx` are the broken claim's cells in word order, `fill` how far it had got
 * towards banking (0 to 1), and `color` its owner's.
 */
export function playBreakFx(board: HTMLElement, idx: number[], size: number, color: number, fill: number): void {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const p = `${(Math.min(1, Math.max(0, fill)) * 100).toFixed(1)}%`;
  const done = (el: Element, a: Animation) => {
    a.onfinish = () => el.remove();
    a.oncancel = () => el.remove();
  };

  // The line snaps: each step breaks in the middle and its halves spring apart.
  if (idx.length > 1 && !still) {
    const svg = document.createElementNS(SVG, 'svg');
    const vb = viewBoxOf(size);
    svg.setAttribute('class', `trail breaklinks c${color}`);
    svg.setAttribute('viewBox', `0 0 ${vb} ${vb}`);
    board.appendChild(svg);
    const at = (i: number): Pt => [center(i % size), center(Math.floor(i / size))];
    let last: Animation | null = null;
    for (let k = 1; k < idx.length; k++) {
      const [a, b] = [at(idx[k - 1]), at(idx[k])];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const [end, sign] of [[a, 1], [b, -1]] as [Pt, number][]) {
        const half = document.createElementNS(SVG, 'polyline');
        half.setAttribute('points', `${end.join(',')} ${mid.join(',')}`);
        half.setAttribute('stroke', 'var(--pc)');
        half.style.transformOrigin = `${end[0]}px ${end[1]}px`;
        half.style.transformBox = 'view-box';
        svg.appendChild(half);
        last = half.animate(
          [
            { transform: 'rotate(0) scale(1)', opacity: 1 },
            { transform: `rotate(${sign * 24}deg) scale(0.75)`, opacity: 0 },
          ],
          { duration: 360, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'both' },
        );
      }
    }
    if (last) done(svg, last);
  }

  idx.forEach((i, k) => {
    const tile = board.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    if (!tile) return;
    const delay = k * BREAK_STAGGER_MS;

    if (still) {
      const ghost = document.createElement('div');
      ghost.className = `breakshard c${color}`;
      ghost.style.setProperty('--p', p);
      tile.appendChild(ghost);
      done(ghost, ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'both' }));
      return;
    }

    // A one-pixel jolt as it gives.
    tile.animate([{ transform: 'none' }, { transform: 'translateY(1.5px)', offset: 0.3 }, { transform: 'none' }], {
      duration: 150,
      delay,
    });

    const { rays, pieces } = shatter();
    // The pieces, whole at first, under the crack.
    const shards = pieces.map(({ poly }) => {
      const shard = document.createElement('div');
      shard.className = `breakshard c${color}`;
      shard.style.setProperty('--p', p);
      shard.style.clipPath = `polygon(${poly.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(',')})`;
      tile.appendChild(shard);
      return shard;
    });

    // The crack runs out from its centre along every ray at once.
    const crack = document.createElementNS(SVG, 'svg');
    crack.setAttribute('class', `breakcrack c${color}`);
    crack.setAttribute('viewBox', '0 0 100 100');
    crack.setAttribute('preserveAspectRatio', 'none');
    for (const r of rays) {
      const line = document.createElementNS(SVG, 'polyline');
      line.setAttribute('points', r.map((pt) => pt.join(',')).join(' '));
      line.setAttribute('pathLength', '1');
      crack.appendChild(line);
      line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: CRACK_MS,
        delay,
        easing: 'ease-out',
        fill: 'both',
      });
    }
    tile.appendChild(crack);
    done(crack, crack.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, delay: BREAK_FALL_MS + delay, fill: 'both' }));

    // Then they come apart along it and fall.
    shards.forEach((shard, j) => {
      const [dx, dy] = pieces[j].dir;
      done(
        shard,
        shard.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: `translate(${dx * 6}px, ${dy * 6 + 16}px) rotate(${rnd(-14, 14)}deg)`, opacity: 0 },
          ],
          {
            duration: FALL_MS,
            delay: BREAK_FALL_MS + delay + rnd(0, 40),
            easing: 'cubic-bezier(.4,0,.8,.6)',
            fill: 'both',
          },
        ),
      );
    });
  });
}
