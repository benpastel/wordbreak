import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { Leaderboard, LeaderRow } from '../shared/types';
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
 * Any row opens that player's card: the estimate behind the rating and how sure it
 * is. Yours is also where you link another browser, a phone say, to play as you.
 */
export default function LeaderboardView({ board, linkOffer, onLink, onCloseLink }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const row = board.rows.find((r) => r.id === open);
  const close = () => {
    setOpen(null);
    onCloseLink();
  };
  return (
    <Fold title="leaderboard" storageKey="wordbreak.leaderboard" className="leaders">
      <ol>
        {board.rows.map((r, i) => (
          <li key={r.id} className={r.id === board.you ? 'you' : undefined}>
            {i > 0 && r.rank !== board.rows[i - 1].rank + 1 && <span className="gap" aria-hidden="true" />}
            <button className="leaderrow" onClick={() => setOpen(r.id)}>
              <span className="rank">{r.rank}</span>
              <span className="name">
                <span className="nametext">{r.name}</span>
                {r.bot && <span className="badge">bot</span>}
              </span>
              <span className="rating">{r.rating}</span>
            </button>
          </li>
        ))}
      </ol>
      {row && (
        <PlayerCard
          row={row}
          you={row.id === board.you}
          devices={board.devices ?? 1}
          linkOffer={linkOffer}
          onLink={onLink}
          onCloseLink={onCloseLink}
          onClose={close}
        />
      )}
    </Fold>
  );
}

function PlayerCard({
  row,
  you,
  devices,
  linkOffer,
  onLink,
  onCloseLink,
  onClose,
}: {
  row: LeaderRow;
  you: boolean;
  devices: number;
  linkOffer: { code: string; expiresAt: number } | null;
  onLink: () => void;
  onCloseLink: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modalback" onClick={onClose}>
      <div className="modalcard playercard" role="dialog" aria-label={row.name} onClick={(e) => e.stopPropagation()}>
        <h3 className="pcname">
          {row.name}
          {row.bot && <span className="badge">bot</span>}
        </h3>
        <div className="pcrating">{row.rating}</div>
        <dl className="pcstats">
          <dt>estimate</dt>
          {/* Two RDs either side, so the rating above is exactly its low end. */}
          <dd>{row.bot ? `${row.estimate}, fixed` : `${row.estimate} ± ${2 * row.rd}`}</dd>
          {!row.bot && (
            <>
              <dt>matches</dt>
              <dd>{row.matches}</dd>
            </>
          )}
          {you && devices > 1 && (
            <>
              <dt>devices</dt>
              <dd>{devices}</dd>
            </>
          )}
        </dl>
        {you &&
          (linkOffer ? (
            <LinkCode {...linkOffer} onExpire={onCloseLink} />
          ) : (
            <button className="ghost pclink" onClick={onLink}>
              link another device
            </button>
          ))}
      </div>
    </div>
  );
}

/** A QR code to scan on the other device, with its address to type if there is no
 *  camera. Gone once it expires. */
function LinkCode({ code, expiresAt, onExpire }: { code: string; expiresAt: number; onExpire: () => void }) {
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
    const t = setTimeout(onExpire, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [expiresAt, onExpire]);

  return (
    <div className="linkcode">
      {/* A margin of four modules all round, as scanners expect. */}
      <svg viewBox={`-4 -4 ${qr.n + 8} ${qr.n + 8}`} className="qr" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="-4" y="-4" width={qr.n + 8} height={qr.n + 8} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <code className="linkurl">
        {location.host}/link/{code}
      </code>
    </div>
  );
}
