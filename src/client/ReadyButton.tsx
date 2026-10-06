import { useEffect, useRef } from 'react';
import { COUNTDOWN_MS } from '../shared/types';
import { serverTime } from './net';

interface Props {
  ready: boolean;
  /** Connected players who have not said yes yet. */
  waiting: number;
  startsAt: number | null;
  onReady: (ready: boolean) => void;
  /** The table room asks you to start; the results screen asks you to go again. */
  idleLabel?: string;
}

/**
 * One control for the whole agreement, rather than a button that disappears and is
 * replaced by a countdown widget. It carries three states in place:
 *
 *   not ready        →  "I'm ready"
 *   ready, others not→  "waiting for 2 others"      (green)
 *   everyone agreed  →  "starting…" filling over 5s (green, sweeping)
 *
 * It deliberately stays clickable while it fills. The server has always cancelled a
 * pending start when someone un-readies; swapping the button out for a countdown was
 * the only reason that was unreachable.
 */
export default function ReadyButton({ ready, waiting, startsAt, onReady, idleLabel = "I'm ready" }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const counting = startsAt !== null;

  // Painted from the server's clock, so every screen at the table fills in step.
  useEffect(() => {
    const el = ref.current;
    if (!counting || startsAt === null || !el) return;
    let raf = 0;
    const paint = () => {
      const left = Math.max(0, startsAt - serverTime());
      const pct = Math.min(100, Math.max(0, 100 - (left / COUNTDOWN_MS) * 100));
      el.style.setProperty('--p', `${pct}%`);
      if (left > 0) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [counting, startsAt]);

  // The server pushes the table once before it sets startsAt, so there is a frame
  // where everyone is ready and the countdown has not landed yet. "waiting for 0
  // others" would flash there.
  const label = counting
    ? 'starting…'
    : ready
      ? waiting > 0
        ? `waiting for ${waiting} ${waiting === 1 ? 'other' : 'others'}`
        : 'ready'
      : idleLabel;

  return (
    <button
      ref={ref}
      className={`primary big${ready ? ' on' : ''}${counting ? ' filling' : ''}`}
      onClick={() => onReady(!ready)}
    >
      {label}
    </button>
  );
}
