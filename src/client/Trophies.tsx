import { MEDALS } from '../shared/types';
import type { Trophies as T } from '../shared/types';

/** Little stacked discs, one per medal won, counted rather than repeated once a
 *  player has a few. Rendered as playing pieces so they sit with the tiles. */
export default function Trophies({ trophies }: { trophies: T }) {
  const won = MEDALS.filter((m) => trophies[m] > 0);
  if (won.length === 0) return null;
  return (
    <span className="trophies">
      {won.map((m) => (
        <span key={m} className={`trophy ${m}`} title={`${trophies[m]} ${m}`}>
          <i />
          {trophies[m] > 1 && <b>{trophies[m]}</b>}
        </span>
      ))}
    </span>
  );
}
