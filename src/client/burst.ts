// A short party-popper for the moment you place. Deliberately tiny and self-cleaning:
// spawned nodes animate once with the Web Animations API and remove themselves, so
// there is no library, no canvas, and nothing left behind afterwards.

import type { Medal } from '../shared/types';

/** Everyone gets a pop; placing just makes it your medal's colour. */
export type BurstKind = Medal | 'none';

const PALETTE: Record<BurstKind, string[]> = {
  gold: ['oklch(0.84 0.15 88)', 'oklch(0.72 0.14 72)', 'oklch(0.93 0.09 95)'],
  silver: ['oklch(0.86 0.015 250)', 'oklch(0.72 0.02 250)', 'oklch(0.95 0.008 250)'],
  bronze: ['oklch(0.70 0.11 52)', 'oklch(0.58 0.10 45)', 'oklch(0.82 0.08 60)'],
  none: ['oklch(0.72 0.13 250)', 'oklch(0.74 0.14 148)', 'oklch(0.72 0.15 25)', 'oklch(0.76 0.13 300)'],
};

const COUNT = 22;
const MS = 900;

/** Fires from `origin` (a player's own name), so the celebration is attached to the
 *  thing that just changed rather than floating in the middle. */
export function burst(kind: BurstKind, origin: HTMLElement | null): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const r = origin?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  const colors = PALETTE[kind];

  for (let i = 0; i < COUNT; i++) {
    const bit = document.createElement('i');
    const round = i % 3 === 0;
    const size = round ? 5 + Math.random() * 4 : 4 + Math.random() * 3;
    bit.className = 'confetti';
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.width = `${size * (round ? 1 : 1.8)}px`;
    bit.style.height = `${size}px`;
    bit.style.background = colors[i % colors.length];
    bit.style.borderRadius = round ? '50%' : '1px';
    document.body.appendChild(bit);

    // Upward-biased fan, then let it fall — a pop rather than a fountain.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
    const dist = 70 + Math.random() * 130;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = (Math.random() - 0.5) * 720;

    const anim = bit.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1, offset: 0 },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 90}px)) rotate(${spin}deg)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: MS + Math.random() * 260, easing: 'cubic-bezier(.15,.7,.4,1)', fill: 'forwards' },
    );
    anim.onfinish = () => bit.remove();
    anim.oncancel = () => bit.remove();
  }
}
