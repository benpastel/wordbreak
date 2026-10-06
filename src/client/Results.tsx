import { useEffect, useRef, useState } from 'react';
import type { Fx, TableView } from '../shared/types';
import { burst } from './burst';
import type { BurstKind } from './burst';
import Chat from './Chat';
import ReadyButton from './ReadyButton';
import Trophies from './Trophies';

/** Vertical pixels per second of play. */
const PX_PER_S = 5;
/** A word's line height; words closer in time than this get nudged apart. */
const ROW = 20;

interface Props {
  table: TableView;
  meId: string;
  fx: { seq: number; items: Fx[] };
  onReady: (r: boolean) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
}

interface Tip {
  text: string;
  x: number;
  y: number;
  /** Low on the screen, so it opens upward instead of under the ready bar. */
  above: boolean;
}

/**
 * Between matches. The board is put away and the match is replayed as a timeline:
 * a column per player, each word at the moment it was found, struck through in the
 * colour of whoever broke it.
 */
export default function Results({ table, meId, fx, onReady, onChat, onLeave }: Props) {
  const me = table.players.find((p) => p.id === meId);
  const ranked = [...table.players].sort((a, b) => b.score - a.score);
  const waiting = table.players.filter((p) => p.connected && !p.ready).length;
  const popped = useRef(-1);
  const [tip, setTip] = useState<Tip | null>(null);

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

  const recap = table.recap;
  const colorOf = (id: string) => table.players.find((p) => p.id === id)?.color;

  // Each word sits at the moment it was found. Two found close together by the same
  // player would collide, so a later one slides down just far enough to clear.
  const columns = ranked.map((p) => {
    let floor = -Infinity;
    return (recap?.words ?? [])
      .filter((w) => w.playerId === p.id)
      .map((w) => {
        const top = Math.max((w.at / 1000) * PX_PER_S, floor);
        floor = top + ROW;
        return { ...w, top };
      });
  });

  const height = Math.max(
    ((recap?.durationMs ?? 0) / 1000) * PX_PER_S,
    ...columns.map((c) => (c.length ? c[c.length - 1].top + ROW : 0)),
  );

  const showTip = (e: React.PointerEvent<HTMLElement>, text: string | undefined) => {
    if (!text) return;
    const r = e.currentTarget.getBoundingClientRect();
    const above = r.bottom > window.innerHeight * 0.6;
    setTip({ text, x: r.left, y: above ? r.top - 6 : r.bottom + 6, above });
  };

  return (
    <div className="results">
      <section className="recap">
        <div className="recaphead">
          {ranked.map((p) => (
            <div
              key={p.id}
              className={`recapwho c${p.color}${p.id === meId ? ' isme' : ''}${
                p.ready ? ' setgo' : ''
              }`}
              data-player={p.id}
            >
              <span className="name">{p.name}</span>
              <span className="pts">{p.score}</span>
              <Trophies trophies={p.trophies} />
            </div>
          ))}
        </div>
        <div className="recapscroll" onScroll={() => setTip(null)}>
          <div className="recaptrack" style={{ height }}>
            {columns.map((words, i) => (
              <div key={ranked[i].id} className="recapcol">
                {words.map((w, j) => {
                  const by = w.brokenBy === null ? undefined : colorOf(w.brokenBy);
                  return (
                    <span
                      key={j}
                      className={`recapword c${ranked[i].color}`}
                      style={{ top: w.top }}
                      onPointerEnter={(e) => showTip(e, w.definition)}
                      onPointerLeave={() => setTip(null)}
                    >
                      {w.word}
                      {w.brokenBy !== null && (
                        <i className={`strike${by === undefined ? ' gone' : ` c${by}`}`} />
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Chat messages={table.chat} onSend={onChat} />

      <div className="readybar">
        <button className="leave" onClick={onLeave}>
          leave
        </button>
        <ReadyButton
          ready={!!me?.ready}
          waiting={waiting}
          color={me?.color ?? 0}
          startsAt={table.startsAt}
          countdownMs={table.countdownMs}
          onReady={onReady}
          idleLabel="ready for the next game"
        />
      </div>

      {tip && (
        <div
          className={`deftip${tip.above ? ' above' : ''}`}
          style={{ left: Math.max(8, Math.min(tip.x, window.innerWidth - 288)), top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
