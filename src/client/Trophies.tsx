import { MEDALS } from '../shared/types';
import type { Trophies as T } from '../shared/types';

const CAP = 12;

/** One piece per medal won, gold first. Collapses to a count only once a table has
 *  played long enough that a row of discs would run off the line. */
export default function Trophies({ trophies }: { trophies: T }) {
  const pieces: string[] = [];
  for (const m of MEDALS) for (let i = 0; i < trophies[m]; i++) pieces.push(m);
  if (pieces.length === 0) return null;

  const shown = pieces.slice(0, CAP);
  const extra = pieces.length - shown.length;
  return (
    <span className="trophies">
      {shown.map((m, i) => (
        <span key={i} className={`trophy ${m}`} title={m}>
          <i />
        </span>
      ))}
      {extra > 0 && <b className="more">+{extra}</b>}
    </span>
  );
}
