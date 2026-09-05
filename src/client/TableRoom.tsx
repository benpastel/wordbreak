import { useState } from 'react';
import { COLOR_COUNT, MAX_GRID, MIN_GRID } from '../shared/types';
import type { EndMode, Settings, TableView } from '../shared/types';
import NameField from './NameField';
import Chat from './Chat';
import Countdown from './Countdown';

interface Props {
  table: TableView;
  meId: string;
  onSetName: (n: string) => void;
  onSettings: (s: Partial<Settings>) => void;
  onColor: (c: number) => void;
  onReady: (r: boolean) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
}

const HOLD_CHOICES = [10, 20, 30, 40, 60];
const TIME_CHOICES = [3, 5, 10, 15];
const POINT_CHOICES = [30, 50, 100, 200];
const END_MODES: { mode: EndMode; label: string }[] = [
  { mode: 'time', label: 'by time' },
  { mode: 'points', label: 'by points' },
  { mode: 'unlimited', label: 'unlimited' },
];

export default function TableRoom({
  table,
  meId,
  onSetName,
  onSettings,
  onColor,
  onReady,
  onChat,
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
          <div className="youare">
            <NameField name={me.name} onSetName={onSetName} label="your name" />
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
          <label>ends</label>
          <div className="segmented">
            {END_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                className={table.settings.endMode === mode ? 'on' : ''}
                disabled={!isHost}
                onClick={() => onSettings({ endMode: mode })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {table.settings.endMode === 'time' && (
          <div className="setting">
            <label>length</label>
            <div className="segmented">
              {TIME_CHOICES.map((m) => (
                <button
                  key={m}
                  className={table.settings.gameMs === m * 60_000 ? 'on' : ''}
                  disabled={!isHost}
                  onClick={() => onSettings({ gameMs: m * 60_000 })}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
        )}

        {table.settings.endMode === 'points' && (
          <div className="setting">
            <label>target</label>
            <div className="segmented">
              {POINT_CHOICES.map((n) => (
                <button
                  key={n}
                  className={table.settings.targetScore === n ? 'on' : ''}
                  disabled={!isHost}
                  onClick={() => onSettings({ targetScore: n })}
                >
                  {n} pts
                </button>
              ))}
            </div>
          </div>
        )}

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

      <Chat messages={table.chat} onSend={onChat} />

      <div className="startrow">
        {table.startsAt !== null ? (
          <Countdown startsAt={table.startsAt} />
        ) : (
          <button
            className={`primary big${me?.ready ? ' on' : ''}`}
            onClick={() => onReady(!me?.ready)}
          >
            {me?.ready ? 'ready — waiting for others' : "I'm ready"}
          </button>
        )}
      </div>
    </div>
  );
}
