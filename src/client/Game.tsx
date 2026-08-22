import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, Fx, GameState, TableView } from '../shared/types';
import * as R from '../shared/rules';
import * as S from '../shared/selection';
import { isWord } from './dict';
import { playBankFx } from './fx';
import { burst } from './burst';
import { serverTime } from './net';
import Trophies from './Trophies';

const GAP_RATIO = 0.1; // must match --gap in styles.css

const center = (i: number) => i * (1 + GAP_RATIO) + 0.5;
const viewBoxOf = (size: number) => size + (size - 1) * GAP_RATIO;

interface Props {
  table: TableView;
  meId: string;
  fx: { seq: number; items: Fx[] };
  onClaim: (tileIds: number[]) => void;
  onReady: (r: boolean) => void;
  onLeave: () => void;
}

export default function Game({ table, meId, fx, onClaim, onReady, onLeave }: Props) {
  const game = table.game!;
  const over = table.phase === 'ended';
  const boardRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [reseeding, setReseeding] = useState<Set<number>>(new Set());
  const [breaking, setBreaking] = useState<Set<number>>(new Set());
  const dragging = useRef(false);
  /** The tile the current press landed on, until the pointer leaves it. */
  const downTile = useRef<number | null>(null);

  const colorOf = useCallback(
    (pid: string) => table.players.find((p) => p.id === pid)?.color ?? 0,
    [table.players],
  );

  const claimByTile = useMemo(() => {
    const m = new Map<number, Claim>();
    for (const c of game.claims) for (const id of c.tileIds) m.set(id, c);
    return m;
  }, [game.claims]);

  // A bank under our feet can invalidate part of a loose selection. Keep the prefix
  // that still exists rather than dumping the whole thing.
  useEffect(() => {
    setSelection((sel) => {
      const kept: number[] = [];
      for (const id of sel) {
        if (game.grid.some((t) => t.id === id)) kept.push(id);
        else break;
      }
      return kept.length === sel.length ? sel : kept;
    });
  }, [game.grid]);

  // Claiming is explicit. Building a trail commits to nothing, so you can look at a
  // word before taking it — and nothing you touch is telegraphed to the table until
  // you do.
  const word = R.wordOf(game, selection);
  const pathError = selection.length ? R.validatePath(game, selection) : 'empty';
  const spellsWord = selection.length > 0 && isWord(word);
  const canClaim = spellsWord && pathError === null && !over;

  // When a real word is blocked, it is always the length rule — a disabled button
  // with no explanation is worse than saying how far you have to reach.
  const needs =
    spellsWord && pathError === 'not-long-enough'
      ? Math.max(...R.claimsTouching(game, selection).map((c) => c.tileIds.length)) + 1
      : null;

  const commit = useCallback(() => {
    if (!canClaim) return;
    onClaim(selection);
    setSelection([]);
  }, [canClaim, onClaim, selection]);

  // The key handler is bound once, so it reaches the live commit through a ref.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Animation hints from the server.
  useEffect(() => {
    if (!fx.items.length) return;
    const board = boardRef.current;
    const reseed = new Set<number>();
    const broke = new Set<number>();
    for (const f of fx.items) {
      if (f.k === 'ended') {
        setSelection([]);
        const mine = f.medals[meId];
        if (mine) {
          // After the render that put the trophy there, so it flies from the right spot.
          requestAnimationFrame(() =>
            burst(mine, document.querySelector<HTMLElement>(`[data-player="${meId}"]`)),
          );
        }
      } else if (f.k === 'banked') {
        if (board) playBankFx(board, f, colorOf(f.playerId));
        for (const i of f.idx) reseed.add(i);
      } else if (f.k === 'broken') {
        for (const i of f.idx) broke.add(i);
      }
    }
    if (reseed.size) {
      setReseeding(reseed);
      setTimeout(() => setReseeding(new Set()), 700);
    }
    if (broke.size) {
      setBreaking(broke);
      setTimeout(() => setBreaking(new Set()), 420);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx.seq]);

  const onTileDown = useCallback(
    (tileId: number) => {
      if (over) return;
      downTile.current = tileId;
      setSelection((sel) => S.pressTile(game, sel, tileId));
    },
    [game, over],
  );

  const onTileDrag = useCallback(
    (tileId: number) => {
      if (over) return;
      // A pointermove fires over the tile you just pressed. Without this guard, the
      // press that removed the head letter would immediately put it back.
      if (downTile.current !== null) {
        if (downTile.current === tileId) return;
        downTile.current = null;
      }
      setSelection((sel) => S.dragTile(game, sel, tileId));
    },
    [game, over],
  );

  useEffect(() => {
    const up = () => {
      dragging.current = false;
      downTile.current = null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection([]);
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRef.current();
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setSelection((s) => s.slice(0, -1));
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const selSet = useMemo(() => new Set(selection), [selection]);
  const vb = viewBoxOf(game.size);
  const idxOf = (id: number) => game.grid.findIndex((t) => t.id === id);

  return (
    <div className="play">
      <Clock endsAt={game.endsAt} over={over} />
      <div className="boardwrap" style={{ '--n': game.size } as React.CSSProperties}>
        <div
          className={`board${over ? ' over' : ''}`}
          ref={boardRef}
          onPointerMove={(e) => {
            // Hit-test rather than relying on pointerenter per tile: touch implicitly
            // captures the pointer to the tile you pressed, so enter events never fire
            // on its neighbours and dragging would silently do nothing on a phone.
            if (!dragging.current) return;
            const hit = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>('[data-idx]');
            if (!hit) return;
            const tile = game.grid[Number(hit.dataset.idx)];
            if (tile) onTileDrag(tile.id);
          }}
        >
          <svg className="trail" viewBox={`0 0 ${vb} ${vb}`} aria-hidden="true">
            {game.claims
              .filter((c) => !c.tileIds.every((id) => selSet.has(id)))
              .map((c) => (
                <polyline
                  key={c.id}
                  className={`c${colorOf(c.playerId)}`}
                  stroke="var(--pc)"
                  points={c.tileIds
                    .map((id) => idxOf(id))
                    .filter((i) => i >= 0)
                    .map((i) => `${center(i % game.size)},${center(Math.floor(i / game.size))}`)
                    .join(' ')}
                />
              ))}
            {selection.length > 1 && (
              <polyline
                className="sel"
                points={selection
                  .map((id) => idxOf(id))
                  .filter((i) => i >= 0)
                  .map((i) => `${center(i % game.size)},${center(Math.floor(i / game.size))}`)
                  .join(' ')}
              />
            )}
          </svg>

          {game.grid.map((tile, i) => (
            <TileView
              key={i}
              idx={i}
              letter={tile.letter}
              claim={claimByTile.get(tile.id)}
              color={claimByTile.get(tile.id) ? colorOf(claimByTile.get(tile.id)!.playerId) : null}
              selected={selSet.has(tile.id)}
              reseeding={reseeding.has(i)}
              breaking={breaking.has(i)}
              onDown={() => {
                dragging.current = true;
                onTileDown(tile.id);
              }}
            />
          ))}
        </div>

        <div className="readout">
          {over && <MatchOver table={table} meId={meId} onReady={onReady} />}
          {!over && selection.length > 0 && (
            <>
              <span className={`word${spellsWord ? ' real' : ''}`}>{word.toUpperCase()}</span>
              {needs !== null && <span className="needs">needs {needs}+</span>}
              <button className="claim" disabled={!canClaim} onClick={commit}>
                claim <kbd>⏎</kbd>
              </button>
              <button className="x" onClick={() => setSelection([])} title="clear (esc)">
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      <div className="scores">
        {table.players.map((p) => (
          <div
            key={p.id}
            className={`player c${p.color}${p.id === meId ? ' isme' : ''}${
              p.connected ? '' : ' gone'
            }${over && p.ready ? ' setgo' : ''}`}
            data-player={p.id}
          >
            <span className="name">{p.name}</span>
            <span className="pts">{p.score}</span>
            <Trophies trophies={p.trophies} />
          </div>
        ))}
      </div>

      <button className="leave" onClick={onLeave}>
        leave table
      </button>
    </div>
  );
}

interface TileProps {
  idx: number;
  letter: string;
  claim: Claim | undefined;
  color: number | null;
  selected: boolean;
  reseeding: boolean;
  breaking: boolean;
  onDown: () => void;
}

function TileView({ idx, letter, claim, color, selected, reseeding, breaking, onDown }: TileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const claimId = claim?.id ?? null;
  const claimedAt = claim?.claimedAt ?? 0;
  const banksAt = claim?.banksAt ?? 0;

  // The fill is a CSS transition on a registered custom property rather than a JS
  // frame loop: hand the browser the remaining milliseconds and let it interpolate.
  // Re-derived from the claim's own timestamps, so a reconnect mid-hold picks up at
  // the right point instead of restarting.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!claimId) {
      el.style.transition = 'none';
      el.style.setProperty('--p', '0%');
      return;
    }
    const total = Math.max(1, banksAt - claimedAt);
    const remaining = Math.max(0, banksAt - serverTime());
    const pct = Math.min(100, Math.max(0, (1 - remaining / total) * 100));
    el.style.transition = 'none';
    el.style.setProperty('--p', `${pct.toFixed(2)}%`);
    void el.offsetWidth; // commit the start value before arming the transition
    el.style.transition = `--p ${remaining}ms linear`;
    el.style.setProperty('--p', '100%');
    // Deliberately keyed on the claim's identity and timestamps, not the object: a
    // snapshot arrives on every action, and re-arming this on each one would force a
    // reflow per tile per message.
  }, [claimId, claimedAt, banksAt]);

  const cls = [
    'tile',
    claim ? `claimed c${color}` : '',
    selected ? 'sel' : '',
    reseeding ? 'reseed' : '',
    breaking ? 'broke' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      data-idx={idx}
      onPointerDown={(e) => {
        e.preventDefault();
        onDown();
      }}
    >
      <span>{letter}</span>
    </div>
  );
}

/** Counts down locally from the server's own timestamp, so it needs no traffic and
 *  stays honest across a reconnect. */
function Clock({ endsAt, over }: { endsAt: number; over: boolean }) {
  const [left, setLeft] = useState(() => Math.max(0, endsAt - serverTime()));
  useEffect(() => {
    if (over) return;
    const tick = () => setLeft(Math.max(0, endsAt - serverTime()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, over]);

  if (over) return <div className="clock done">time</div>;
  const total = Math.ceil(left / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return (
    <div className={`clock${left <= 30_000 ? ' low' : ''}`}>
      {mm}:{String(ss).padStart(2, '0')}
    </div>
  );
}

function MatchOver({
  table,
  meId,
  onReady,
}: {
  table: TableView;
  meId: string;
  onReady: (r: boolean) => void;
}) {
  const me = table.players.find((p) => p.id === meId);
  const waiting = table.players.filter((p) => p.connected && !p.ready).length;
  return (
    <div className="matchover">
      <span className="readystate">
        {waiting === 0 ? 'starting…' : `${waiting} still deciding`}
      </span>
      <button className={`primary${me?.ready ? ' on' : ''}`} onClick={() => onReady(!me?.ready)}>
        {me?.ready ? 'ready — waiting' : 'ready for the next game'}
      </button>
    </div>
  );
}

export type { GameState };
