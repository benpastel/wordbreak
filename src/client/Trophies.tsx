import { MEDALS } from '../shared/types';
import type { Medal, Trophies as T } from '../shared/types';

const CAP = 12;
const PLACE: Record<Medal, string> = { gold: '1', silver: '2', bronze: '3' };

/** A place medal: a disc with its place on it, hung from a ribbon. */
export function MedalIcon({ medal }: { medal: Medal }) {
  return (
    <svg viewBox="0 0 20 27" aria-hidden="true">
      <path className="ribbon" d="M3 0h5l4.5 11h-5z" />
      <path className="ribbon r2" d="M17 0h-5l-4.5 11h5z" />
      <circle className="rim" cx="10" cy="18" r="8.5" />
      <circle className="face" cx="10" cy="18" r="6.6" />
      <text x="10" y="18" dy="0.36em" textAnchor="middle">
        {PLACE[medal]}
      </text>
    </svg>
  );
}

/** One medal per one won, gold first. Collapses to a count only once a table has
 *  played long enough that a row of them would run off the line. */
export default function Trophies({ trophies }: { trophies: T }) {
  const pieces: Medal[] = [];
  for (const m of MEDALS) for (let i = 0; i < trophies[m]; i++) pieces.push(m);
  if (pieces.length === 0) return null;

  const shown = pieces.slice(0, CAP);
  const extra = pieces.length - shown.length;
  return (
    <span className="trophies">
      {shown.map((m, i) => (
        <span key={i} className={`trophy ${m}`} title={m}>
          <MedalIcon medal={m} />
        </span>
      ))}
      {extra > 0 && <b className="more">+{extra}</b>}
    </span>
  );
}
