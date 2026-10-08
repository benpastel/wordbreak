import { useEffect, useRef } from 'react';
import { serverTime } from './net';

interface Props {
  ready: boolean;
  /** Connected players who have not said yes yet. */
  waiting: number;
  /** Your seat colour — the countdown fills the button in it, as if banking a tile. */
  color: number;
  startsAt: number | null;
  /** The span startsAt closes, sent by the server so the fill never guesses it. */
  countdownMs: number | null;
  onReady: (ready: boolean) => void;
  /** The table room asks you to start; the results screen asks you to go again. */
  idleLabel?: string;
}

/**
 * One control for the whole agreement, rather than a button that disappears and is
 * replaced by a countdown widget. It carries three states in place:
 *
 *   not ready         →  "ready"
 *   ready, others not →  "waiting for 2 others"  (green)
 *   everyone agreed   →  "starting…"             (a tile of yours, banking)
 *
 * The countdown is short solo and a beat longer with company; the server decides
 * which, and sends the span so the fill lands exactly when the board does.
 *
 * It deliberately stays clickable while it fills. The server has always cancelled a
 * pending start when someone un-readies; swapping the button out for a countdown was
 * the only reason that was unreachable.
 */
export default function ReadyButton({
  ready,
  waiting,
  color,
  startsAt,
  countdownMs,
  onReady,
  idleLabel = 'ready',
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const counting = startsAt !== null;

  // Painted from the server's clock, so every screen at the table fills in step.
  useEffect(() => {
    const el = ref.current;
    if (!counting || startsAt === null || !countdownMs || !el) return;
    let raf = 0;
    const paint = () => {
      const left = Math.max(0, startsAt - serverTime());
      const pct = Math.min(100, Math.max(0, 100 - (left / countdownMs) * 100));
      el.style.setProperty('--p', `${pct}%`);
      if (left > 0) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [counting, startsAt, countdownMs]);

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
      className={`primary big c${color}${ready ? ' on' : ''}${counting ? ' filling' : ''}`}
      onClick={() => onReady(!ready)}
    >
      {label}
    </button>
  );
}
