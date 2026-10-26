import type { Leaderboard } from '../shared/types';
import Fold from './Fold';

/**
 * Everyone rated, best first, bots among them at their fixed ratings. The rating
 * shown is the cautious one, so a newcomer starts low and climbs as they play. Your
 * own row is marked, and added at the bottom if you are further down than the list.
 */
export default function LeaderboardView({ board }: { board: Leaderboard }) {
  return (
    <Fold title="leaderboard" storageKey="wordbreak.leaderboard" className="leaders">
      <ol>
        {board.rows.map((r, i) => (
          <li key={r.id} className={r.id === board.you ? 'you' : undefined}>
            {i > 0 && r.rank !== board.rows[i - 1].rank + 1 && <span className="gap" aria-hidden="true" />}
            <span className="rank">{r.rank}</span>
            <span className="name">
              {r.name}
              {r.bot && <span className="badge">bot</span>}
            </span>
            <span className="rating">{r.rating}</span>
          </li>
        ))}
      </ol>
    </Fold>
  );
}
