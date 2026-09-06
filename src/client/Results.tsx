import { useEffect, useRef } from 'react';
import type { Award, AwardKind, Fx, TableView } from '../shared/types';
import { burst } from './burst';
import type { BurstKind } from './burst';
import Chat from './Chat';
import Countdown from './Countdown';
import Trophies from './Trophies';

const AWARD_LABEL: Record<AwardKind, string> = {
  longest: 'longest word',
  shortest: 'shortest word',
  hardest: 'hardest letters',
  obscure: 'most obscure',
  fastest: 'quickest off a new letter',
  repeat: 'kept going back to',
  thief: 'thief',
};

interface Props {
  table: TableView;
  meId: string;
  fx: { seq: number; items: Fx[] };
  onReady: (r: boolean) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
}

/**
 * Between matches. The board is gone — there is nothing live on it and it only
 * competes with the write-up — so the screen is the standings, what happened, and
 * the table talking about it.
 */
export default function Results({ table, meId, fx, onReady, onChat, onLeave }: Props) {
  const me = table.players.find((p) => p.id === meId);
  const ranked = [...table.players].sort((a, b) => b.score - a.score);
  const waiting = table.players.filter((p) => p.connected && !p.ready).length;
  const popped = useRef(-1);

  // Everyone gets a pop, in their medal's colour if they placed. Fired off the
  // 'ended' event rather than the phase, so reconnecting later does not replay it.
  useEffect(() => {
    const ended = fx.items.find((f) => f.k === 'ended');
    if (!ended || popped.current === fx.seq) return;
    popped.current = fx.seq;
    const kind: BurstKind = (ended.medals[meId] as BurstKind) ?? 'none';
    requestAnimationFrame(() =>
      burst(kind, document.querySelector<HTMLElement>(`[data-player="${meId}"]`)),
    );
  }, [fx.seq, fx.items, meId]);

  const awardsFor = (id: string): Award[] =>
    (table.stats?.awards ?? []).filter((a) => a.playerId === id);
  const nameOf = (id: string) => table.players.find((p) => p.id === id)?.name ?? 'someone';
  const colorOf = (id: string) => table.players.find((p) => p.id === id)?.color ?? 0;

  return (
    <div className="results">
      <div className="playtop">
        <span className="clock done">match over</span>
        <button className="leave" onClick={onLeave}>
          leave
        </button>
      </div>

      <ol className="standings">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`standing c${p.color}${p.id === meId ? ' isme' : ''}${
              p.ready ? ' setgo' : ''
            }`}
            data-player={p.id}
          >
            <span className="place">{i + 1}</span>
            <div className="who">
              <div className="playerhead">
                <span className="name">{p.name}</span>
                <span className="pts">{p.score}</span>
                <Trophies trophies={p.trophies} />
              </div>
              {awardsFor(p.id).length > 0 && (
                <ul className="awards">
                  {awardsFor(p.id).map((a) => (
                    <li key={a.kind}>
                      <span className="lab">{AWARD_LABEL[a.kind]}</span>
                      {a.word && <b className="word">{a.word}</b>}
                      {a.detail && <span className="det">{a.detail}</span>}
                      {a.definition && <span className="def">{a.definition}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      {table.stats && table.stats.breaks.length > 0 && (
        <section className="breaks">
          <h2>biggest breaks</h2>
          <ul>
            {table.stats.breaks.map((b, i) => (
              <li key={i}>
                <span className={`bw c${colorOf(b.overPlayerId)}`}>{b.overWord}</span>
                <span className="arrow">→</span>
                <span className={`bw c${colorOf(b.byPlayerId)}`}>{b.word}</span>
                <span className="by">{nameOf(b.byPlayerId)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Chat messages={table.chat} onSend={onChat} />

      <div className="readyrow">
        {table.startsAt !== null ? (
          <Countdown startsAt={table.startsAt} />
        ) : (
          <>
            <span className="readystate">
              {waiting === 1 ? '1 still deciding' : `${waiting} still deciding`}
            </span>
            <button
              className={`primary big${me?.ready ? ' on' : ''}`}
              onClick={() => onReady(!me?.ready)}
            >
              {me?.ready ? 'ready — waiting' : 'ready for the next game'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
