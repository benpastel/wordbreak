// How a trail is edited. Pure, so the behaviour can be exercised without a browser —
// pointer plumbing (which button is down, whether we are mid-drag) stays in the
// component; this is only the resulting state.

import { canAppend } from './rules';
import type { GameState } from './types';

/**
 * Pressing a letter.
 *
 * Pressing the head of the trail takes it back off, which is the same undo as
 * backspace but reachable with the hand already on the board. Anything else legal
 * extends, and anything unreachable abandons the trail and starts again there.
 */
export function pressTile(game: GameState, sel: number[], tileId: number): number[] {
  if (sel.length > 0 && sel[sel.length - 1] === tileId) return sel.slice(0, -1);
  if (canAppend(game, sel, tileId)) return [...sel, tileId];
  return [tileId];
}

/**
 * Dragging across a letter.
 *
 * Differs from pressing in two ways. Dragging back over a letter already in the
 * trail rewinds to it, rather than removing only the head — that is the gesture
 * people expect when they overshoot. And an unreachable letter is ignored instead of
 * restarting, because mid-drag it is always a slip of the hand, never an intent.
 *
 * Returns the same array when nothing changes, so React can skip the render.
 */
export function dragTile(game: GameState, sel: number[], tileId: number): number[] {
  const at = sel.indexOf(tileId);
  if (at >= 0) return at === sel.length - 1 ? sel : sel.slice(0, at + 1);
  if (canAppend(game, sel, tileId)) return [...sel, tileId];
  return sel;
}
