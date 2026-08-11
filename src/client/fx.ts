// Bank animation: the claimed tiles detach and fly into the owner's score.
//
// The board itself is a pure render of server state, so by the time this runs the
// cells already hold their reseeded letters. The flyers are therefore built from
// scratch out of the letters carried on the fx event, and only borrow the tiles'
// screen positions — which are positional and so unaffected by the reseed.

import type { Fx } from '../shared/types';

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
    flyer.style.fontSize = `${r.width * 0.46}px`;
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
