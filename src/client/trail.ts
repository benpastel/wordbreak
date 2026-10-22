// Where a path runs on a board, in the board's SVG units: a tile is 1 wide and the
// gap between tiles is GAP_RATIO.

export const GAP_RATIO = 0.1; // must match --gap in styles.css

export const center = (i: number) => i * (1 + GAP_RATIO) + 0.5;
export const viewBoxOf = (size: number) => size + (size - 1) * GAP_RATIO;

export function points(idx: number[], size: number): string {
  return idx.map((i) => `${center(i % size)},${center(Math.floor(i / size))}`).join(' ');
}

/** Half a chevron's length along the path, and its half-width across it. Small
 *  enough to sit in the gap between two tiles, where the link is visible. */
const ALONG = 0.045;
const ACROSS = 0.055;

/**
 * A chevron halfway along each step of a path, pointing the way the word reads.
 * Halfway is always in the gap between the two tiles, straight or diagonal, so the
 * arrow lands on the one stretch of the link that is not under a tile.
 */
export function chevrons(idx: number[], size: number): string {
  let d = '';
  for (let k = 1; k < idx.length; k++) {
    const [ax, ay] = [center(idx[k - 1] % size), center(Math.floor(idx[k - 1] / size))];
    const [bx, by] = [center(idx[k] % size), center(Math.floor(idx[k] / size))];
    const len = Math.hypot(bx - ax, by - ay);
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
    const f = (n: number) => n.toFixed(3);
    d +=
      `M${f(mx - ux * ALONG - uy * ACROSS)} ${f(my - uy * ALONG + ux * ACROSS)}` +
      `L${f(mx + ux * ALONG)} ${f(my + uy * ALONG)}` +
      `L${f(mx - ux * ALONG + uy * ACROSS)} ${f(my - uy * ALONG - ux * ACROSS)}`;
  }
  return d;
}
