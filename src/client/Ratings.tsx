import type { RatingChange } from '../shared/types';
import Fold from './Fold';

/**
 * Under the wall, once the match is rated: everyone's rating now and how far this
 * match moved it, best score first, in the leaderboard's style. Bots never move,
 * so theirs shows no change. Someone who left is listed without a colour.
 */
export default function Ratings({
  ratings,
  meId,
  colorOf,
}: {
  ratings: RatingChange[];
  meId: string;
  colorOf: (id: string) => number | undefined;
}) {
  return (
    <Fold title="ratings" storageKey="wordbreak.ratings" className="ratings">
      <ol>
        {ratings.map((r) => {
          const c = colorOf(r.playerId);
          return (
            <li key={r.playerId} className={`${c === undefined ? 'gone' : `c${c}`}${r.playerId === meId ? ' you' : ''}`}>
              <span className="name">
                <span className="nametext">{r.name}</span>
                {r.bot && <span className="badge">bot</span>}
              </span>
              <span className="rating">{r.rating}</span>
              <span className={`change${r.change === null ? '' : r.change > 0 ? ' up' : r.change < 0 ? ' down' : ''}`}>
                {r.change === null ? '' : r.change > 0 ? `+${r.change}` : r.change < 0 ? `−${-r.change}` : '±0'}
              </span>
            </li>
          );
        })}
      </ol>
    </Fold>
  );
}
