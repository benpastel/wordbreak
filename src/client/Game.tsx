import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, Fx, GameState, TableView } from '../shared/types';
import * as R from '../shared/rules';
import { isWord } from './dict';
import { playBankFx } from './fx';
import { serverTime } from './net';

const GAP_RATIO = 0.1; // must match --gap in styles.css

const center = (i: number) => i * (1 + GAP_RATIO) + 0.5;
const viewBoxOf = (size: number) => size + (size - 1) * GAP_RATIO;

interface Props {
  table: TableView;
  meId: string;
  fx: { seq: number; items: Fx[] };
  onClaim: (tileIds: number[]) => void;
  onLeave: () => void;
}

export default function Game({ table, meId, fx, onClaim, onLeave }: Props) {
  const game = table.game!;
  const boardRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [reseeding, setReseeding] = useState<Set<number>>(new Set());
  const [breaking, setBreaking] = useState<Set<number>>(new Set());
  const dragging = useRef(false);
  const lastSent = useRef<string>('');

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

  // Auto-claim: the moment the trail spells a word, take it. The trail stays live so
  // you can keep reaching for a longer one.
  useEffect(() => {
    if (selection.length === 0) {
      lastSent.current = '';
      return;
    }
    const word = R.wordOf(game, selection);
    if (word.length !== selection.length || !isWord(word)) return;
    if (R.validatePath(game, selection) !== null) return;
    const key = selection.join(',');
    if (key === lastSent.current) return;
    lastSent.current = key;
    onClaim(selection);
  }, [selection, game, meId, onClaim]);

  // Animation hints from the server.
  useEffect(() => {
    if (!fx.items.length) return;
    const board = boardRef.current;
    const reseed = new Set<number>();
    const broke = new Set<number>();
    for (const f of fx.items) {
      if (f.k === 'banked') {
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

  const tryAppend = useCallback(
    (tileId: number) => {
      setSelection((sel) => {
        if (R.canAppend(game, sel, tileId)) return [...sel, tileId];
        if (sel.length && sel[sel.length - 1] === tileId) return sel;
        // Clicking somewhere unreachable starts a fresh trail there instead.
        return [tileId];
      });
    },
    [game],
  );

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection([]);
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
  const word = R.wordOf(game, selection).toUpperCase();
  const me = table.players.find((p) => p.id === meId);

  return (
    <div className="play">
      <div className="playtop">
        <span className="tablename">{table.name}</span>
        <button className="ghost" onClick={onLeave}>
          leave table
        </button>
      </div>

      <div className="boardwrap">
        <div
          className="board"
          ref={boardRef}
          style={{ '--n': game.size } as React.CSSProperties}
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
            if (tile) tryAppend(tile.id);
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
                tryAppend(tile.id);
              }}
            />
          ))}
        </div>

        <div className="readout">
          {selection.length > 0 ? (
            <>
              <span className="word">{word}</span>
              <button className="x" onClick={() => setSelection([])} title="clear (esc)">
                ✕
              </button>
            </>
          ) : (
            <span className="hint">click or drag adjacent letters</span>
          )}
        </div>
      </div>

      <div className="scores">
        {table.players.map((p) => (
          <div
            key={p.id}
            className={`player c${p.color}${p.id === meId ? ' isme' : ''}${p.connected ? '' : ' gone'}`}
            data-player={p.id}
          >
            <span className="name">{p.name}</span>
            <span className="pts">{p.score}</span>
          </div>
        ))}
      </div>

      {me && (
        <p className="playfoot">
          hold {Math.round(table.settings.holdMs / 1000)}s · <kbd>backspace</kbd> undo ·{' '}
          <kbd>esc</kbd> clear · <a href="tutorial.html" target="_blank" rel="noreferrer">how to play</a>
        </p>
      )}
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

export type { GameState };
