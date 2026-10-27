import { useEffect, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import type { Leaderboard } from '../shared/types';
import Fold from './Fold';

interface Props {
  board: Leaderboard;
  /** The code you are showing, for another browser to play as you. */
  linkOffer: { code: string; expiresAt: number } | null;
  onLink: () => void;
  onCloseLink: () => void;
}

/**
 * Everyone rated, best first, bots among them at their fixed ratings. The rating
 * shown is the cautious one, so a newcomer starts low and climbs as they play. Your
 * own row is marked, and added at the bottom if you are further down than the list.
 *
 * Your row is also where you link another browser, a phone say, to play as you: a
 * QR code to scan there, with its address to type if there is no camera.
 */
export default function LeaderboardView({ board, linkOffer, onLink, onCloseLink }: Props) {
  return (
    <Fold title="leaderboard" storageKey="wordbreak.leaderboard" className="leaders">
      <ol>
        {board.rows.map((r, i) => (
          <li key={r.id} className={r.id === board.you ? 'you' : undefined}>
            {i > 0 && r.rank !== board.rows[i - 1].rank + 1 && <span className="gap" aria-hidden="true" />}
            <span className="rank">{r.rank}</span>
            <span className="name">
              <span className="nametext">{r.name}</span>
              {r.bot && <span className="badge">bot</span>}
              {r.id === board.you && (
                <button className="linkbtn" aria-label="play as you on another device" onClick={onLink}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path
                      d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l1-1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </span>
            <span className="rating">{r.rating}</span>
          </li>
        ))}
      </ol>
      {linkOffer && <LinkDialog {...linkOffer} onClose={onCloseLink} />}
    </Fold>
  );
}

function LinkDialog({ code, expiresAt, onClose }: { code: string; expiresAt: number; onClose: () => void }) {
  const url = `${location.origin}/link/${code}`;
  const qr = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return { n, d };
  }, [url]);

  useEffect(() => {
    const t = setTimeout(onClose, Math.max(0, expiresAt - Date.now()));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [expiresAt, onClose]);

  return (
    <div className="linkback" onClick={onClose}>
      <div className="linkcard" role="dialog" aria-label="link another device" onClick={(e) => e.stopPropagation()}>
        {/* A margin of four modules all round, as scanners expect. */}
        <svg viewBox={`-4 -4 ${qr.n + 8} ${qr.n + 8}`} className="qr" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="-4" y="-4" width={qr.n + 8} height={qr.n + 8} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
        <code className="linkurl">
          {location.host}/link/{code}
        </code>
      </div>
    </div>
  );
}
