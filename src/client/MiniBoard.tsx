import type { BoardShot } from '../shared/types';
import { chevrons, points, viewBoxOf } from './trail';


interface Props {
  board: BoardShot;
  size: number;
  /** A word's path to draw over the board, dashed: one that was there and not played. */
  path: number[];
  colorOf: (playerId: string) => number | undefined;
}

/**
 * A board as it stood at one moment, small, for looking at rather than playing:
 * the claims on it filled as far as they had got, and a path through it. The path
 * runs over the tile faces but under the letters, so every letter it passes stays
 * readable.
 */
export default function MiniBoard({ board, size, path, colorOf }: Props) {
  const vb = viewBoxOf(size);
  const pts = (idx: number[]) => points(idx, size);
  const owner = new Map<number, { color: number | undefined; fill: number }>();
  for (const c of board.claims) {
    for (const i of c.idx) owner.set(i, { color: colorOf(c.playerId), fill: c.fill });
  }
  const [sx, sy] = pts(path.slice(0, 1)).split(',');

  return (
    <div className="miniboard" style={{ '--n': size } as React.CSSProperties}>
      {board.letters.split('').map((l, i) => {
        const c = owner.get(i);
        return (
          <div
            key={i}
            className={c ? `mt claimed${c.color === undefined ? ' gone' : ` c${c.color}`}` : 'mt'}
            style={c ? ({ '--p': `${Math.round(c.fill * 100)}%` } as React.CSSProperties) : undefined}
          >
            <span>{l}</span>
          </div>
        );
      })}
      <svg viewBox={`0 0 ${vb} ${vb}`} aria-hidden="true">
        {board.claims.map((c, k) =>
          c.idx.length > 1 ? (
            <g key={k} className={`link c${colorOf(c.playerId) ?? ''}`}>
              <polyline points={pts(c.idx)} />
              <path className="dir" d={chevrons(c.idx, size)} />
            </g>
          ) : null,
        )}
        <polyline className="path" points={pts(path)} />
        <circle className="start" cx={sx} cy={sy} r={0.11} />
      </svg>
    </div>
  );
}
