import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Fx, MissKind, PlayedWord, TableView } from '../shared/types';
import { burst, rain } from './burst';
import type { BurstKind } from './burst';
import MiniBoard from './MiniBoard';
import TableShell from './TableShell';
import Trophies from './Trophies';

interface Props {
  table: TableView;
  meId: string;
  fx: { seq: number; items: Fx[] };
  onReady: (r: boolean) => void;
  onBackToSetup: () => void;
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

const MISS_LABEL: Record<MissKind, string> = {
  longest: 'longest unfound',
  biggest: 'biggest break',
  easiest: 'easiest break',
};

/**
 * Between matches. The board is put away and each player's words stack up into a
 * tower of tiles, first word at the bottom, standing on a plinth with their score.
 * A broken word keeps its place as an empty outline, struck through in the colour of
 * whoever broke it. Below, a few words that were there and nobody played.
 */
export default function Results({ table, meId, fx, onReady, onBackToSetup, onChat, onLeave }: Props) {
  const ranked = [...table.players].sort((a, b) => b.score - a.score);
  const popped = useRef(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const plinth = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // Confetti over the whole screen and a pop from your own name, in your medal's
  // colours if you placed. Fired off the 'ended' event rather than the phase, so
  // reconnecting later does not replay it.
  useEffect(() => {
    const ended = fx.items.find((f) => f.k === 'ended');
    if (!ended || popped.current === fx.seq) return;
    popped.current = fx.seq;
    const kind: BurstKind = (ended.medals[meId] as BurstKind) ?? 'none';
    requestAnimationFrame(() => {
      rain(kind);
      burst(kind, document.querySelector<HTMLElement>(`[data-player="${meId}"]`));
    });
  }, [fx.seq, fx.items, meId]);

  const recap = table.recap;

  // The towers grow upward from the scores, so a tall match opens scrolled down to
  // the plinth rather than at the top of the tallest tower.
  useLayoutEffect(() => {
    const s = scroller.current;
    const p = plinth.current;
    if (!s || !p) return;
    s.scrollTop = Math.max(0, p.offsetTop + p.offsetHeight - s.clientHeight);
  }, [recap]);

  const colorOf = (id: string) => table.players.find((p) => p.id === id)?.color;
  const wordsOf = (id: string) => (recap?.words ?? []).filter((w) => w.playerId === id);
  const size = table.settings.gridSize;

  const showTip = (e: React.PointerEvent<HTMLElement>, text: string | undefined) => {
    if (!text) return;
    const r = e.currentTarget.getBoundingClientRect();
    const above = r.bottom > window.innerHeight * 0.6;
    setTip({ text, x: r.left, y: above ? r.top - 6 : r.bottom + 6, above });
  };

  const row = (w: PlayedWord, j: number) => {
    const by = w.brokenBy === null ? undefined : colorOf(w.brokenBy);
    return (
      <div
        key={j}
        className={`wallrow${w.brokenBy !== null ? ' broken' : ''}`}
        onPointerEnter={(e) => showTip(e, w.definition)}
        onPointerLeave={() => setTip(null)}
      >
        {w.word.split('').map((l, k) => (
          <span key={k} className="wt">
            <span>{l}</span>
          </span>
        ))}
        {w.brokenBy !== null && <i className={`strike${by === undefined ? ' gone' : ` c${by}`}`} />}
      </div>
    );
  };

  return (
    <TableShell
      table={table}
      meId={meId}
      onReady={onReady}
      onBackToSetup={onBackToSetup}
      onChat={onChat}
      onLeave={onLeave}
    >
      <section className="recap">
        <div className="recapscroll" ref={scroller} onScroll={() => setTip(null)}>
          <div className="wall">
            {ranked.map((p) => {
              const words = wordsOf(p.id);
              const longest = Math.max(5, ...words.map((w) => w.word.length));
              return (
                <div
                  key={p.id}
                  className={`tower c${p.color}`}
                  style={{ '--len': longest } as React.CSSProperties}
                >
                  {words.map(row)}
                </div>
              );
            })}
          </div>
          <div className="recaphead plinth" ref={plinth}>
            {ranked.map((p) => (
              <div
                key={p.id}
                className={`recapwho c${p.color}${p.ready ? ' setgo' : ''}`}
                data-player={p.id}
              >
                <span className="name">{p.name}</span>
                <span className="pts">{p.score}</span>
                <Trophies trophies={p.trophies} />
              </div>
            ))}
          </div>
          {recap && recap.missed.length > 0 && (
            <div className="missed">
              {recap.missed.map((m) => (
                <figure key={m.kind}>
                  <MiniBoard board={m.board} size={size} path={m.idx} colorOf={colorOf} />
                  <span className="missword">{m.word}</span>
                  <span className="misskind">{MISS_LABEL[m.kind]}</span>
                  {m.breaks.length > 0 && (
                    <span className="missbreaks">
                      {m.breaks.map((b, k) => {
                        const c = colorOf(b.playerId);
                        return (
                          <span key={k} className={c === undefined ? 'gone' : `c${c}`}>
                            {b.word}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>

      {tip && (
        <div
          className={`deftip${tip.above ? ' above' : ''}`}
          style={{ left: Math.max(8, Math.min(tip.x, window.innerWidth - 288)), top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </TableShell>
  );
}
