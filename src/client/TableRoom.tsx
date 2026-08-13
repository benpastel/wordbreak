import { useState } from 'react';
import { COLOR_COUNT, MAX_GRID, MIN_GRID } from '../shared/types';
import type { Settings, TableView } from '../shared/types';

interface Props {
  table: TableView;
  meId: string;
  onSettings: (s: Partial<Settings>) => void;
  onColor: (c: number) => void;
  onReady: (r: boolean) => void;
  onLeave: () => void;
}

const HOLD_CHOICES = [10, 20, 30, 40, 60];

export default function TableRoom({
  table,
  meId,
  onSettings,
  onColor,
  onReady,
  onLeave,
}: Props) {
  const [copied, setCopied] = useState(false);
  const me = table.players.find((p) => p.id === meId);
  const isHost = table.hostId === meId;
  const taken = new Set(table.players.filter((p) => p.id !== meId).map((p) => p.color));
  const link = `${location.origin}${location.pathname}#/t/${table.id}`;

  const copy = () => {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };

  return (
    <div className="room">
      <header className="roomhead">
        <h1>{table.name}</h1>
        <button className="ghost" onClick={onLeave}>
          leave
        </button>
      </header>

      <section className="card">
        <h2>players</h2>
        <ul className="seats">
          {table.players.map((p) => (
            <li key={p.id} className={`seat c${p.color}${p.connected ? '' : ' gone'}`}>
              <i className="dot" />
              <span className="nm">{p.name}</span>
              {p.id === table.hostId && <span className="badge">host</span>}
              {p.ready && <span className="tick">ready</span>}
            </li>
          ))}
        </ul>

        {me && (
          <div className="colorpick">
            <span>your colour</span>
            <div className="swatches">
              {Array.from({ length: COLOR_COUNT }, (_, c) => (
                <button
                  key={c}
                  className={`sw c${c}${me.color === c ? ' on' : ''}`}
                  disabled={taken.has(c)}
                  onClick={() => onColor(c)}
                  title={taken.has(c) ? 'taken' : `colour ${c + 1}`}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>settings {!isHost && <em>— host only</em>}</h2>

        <div className="setting">
          <label>board</label>
          <div className="segmented">
            {Array.from({ length: MAX_GRID - MIN_GRID + 1 }, (_, k) => MIN_GRID + k).map((n) => (
              <button
                key={n}
                className={table.settings.gridSize === n ? 'on' : ''}
                disabled={!isHost}
                onClick={() => onSettings({ gridSize: n })}
              >
                {n}×{n}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <label>hold time</label>
          <div className="segmented">
            {HOLD_CHOICES.map((s) => (
              <button
                key={s}
                className={table.settings.holdMs === s * 1000 ? 'on' : ''}
                disabled={!isHost}
                onClick={() => onSettings({ holdMs: s * 1000 })}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>invite</h2>
        <div className="linkrow">
          <code>{link}</code>
          <button className="ghost" onClick={copy}>
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </section>

      <div className="startrow">
        <button className={`primary big${me?.ready ? ' on' : ''}`} onClick={() => onReady(!me?.ready)}>
          {me?.ready ? 'ready — waiting for others' : "I'm ready"}
        </button>
      </div>
    </div>
  );
}
