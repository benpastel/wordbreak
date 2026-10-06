import { useState } from 'react';
import { COLOR_COUNT, MAX_GRID, MIN_GRID } from '../shared/types';
import type { EndMode, Settings, TableView } from '../shared/types';
import TableShell from './TableShell';

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

const GRID_CHOICES = Array.from({ length: MAX_GRID - MIN_GRID + 1 }, (_, k) => MIN_GRID + k);
const HOLD_CHOICES = [10, 20, 30, 40, 60];
const TIME_CHOICES = [3, 5, 10, 15];
const POINT_CHOICES = [30, 50, 100, 200];
const END_MODES: [EndMode, string][] = [
  ['time', 'by time'],
  ['points', 'by points'],
  ['unlimited', 'unlimited'],
];

/** One labelled row of mutually exclusive choices. Only the host can change them. */
function Setting<T extends string | number>({
  label,
  value,
  choices,
  disabled,
  onPick,
}: {
  label: string;
  value: T;
  choices: [T, string][];
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="setting">
      <label>{label}</label>
      <div className="segmented">
        {choices.map(([v, text]) => (
          <button
            key={v}
            className={value === v ? 'on' : ''}
            disabled={disabled}
            onClick={() => onPick(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your own name in the player list. Click it to rename yourself; Enter or leaving
 *  the field keeps the change, Escape drops it. */
function EditableName({ name, onSetName }: { name: string; onSetName: (n: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button className="name mine" onClick={() => setDraft(name)}>
        {name}
      </button>
    );
  }
  const commit = () => {
    const n = draft.trim();
    if (n && n !== name) onSetName(n);
    setDraft(null);
  };
  return (
    <input
      className="name"
      value={draft}
      autoFocus
      maxLength={20}
      spellCheck={false}
      autoComplete="off"
      aria-label="Your name"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

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
  const s = table.settings;
  const locked = table.hostId !== meId;
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
    <TableShell table={table} meId={meId} onReady={onReady} onChat={onChat} onLeave={onLeave}>
      <section className="card">
        <ul className="seats">
          {table.players.map((p) => (
            <li
              key={p.id}
              className={`seat c${p.color}${p.connected ? '' : ' gone'}${p.ready ? ' setgo' : ''}`}
            >
              {p.id === meId ? (
                <EditableName name={p.name} onSetName={onSetName} />
              ) : (
                <span className="name">{p.name}</span>
              )}
              {p.id === table.hostId && <span className="badge">host</span>}
            </li>
          ))}
        </ul>

        {me && (
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
        )}
      </section>

      <section className="card">
        <Setting
          label="board"
          value={s.gridSize}
          choices={GRID_CHOICES.map((n): [number, string] => [n, `${n}×${n}`])}
          disabled={locked}
          onPick={(gridSize) => onSettings({ gridSize })}
        />
        <Setting
          label="ends"
          value={s.endMode}
          choices={END_MODES}
          disabled={locked}
          onPick={(endMode) => onSettings({ endMode })}
        />
        {s.endMode === 'time' && (
          <Setting
            label="length"
            value={s.gameMs}
            choices={TIME_CHOICES.map((m): [number, string] => [m * 60_000, `${m} min`])}
            disabled={locked}
            onPick={(gameMs) => onSettings({ gameMs })}
          />
        )}
        {s.endMode === 'points' && (
          <Setting
            label="target"
            value={s.targetScore}
            choices={POINT_CHOICES.map((n): [number, string] => [n, `${n} pts`])}
            disabled={locked}
            onPick={(targetScore) => onSettings({ targetScore })}
          />
        )}
        <Setting
          label="hold time"
          value={s.holdMs}
          choices={HOLD_CHOICES.map((sec): [number, string] => [sec * 1000, `${sec}s`])}
          disabled={locked}
          onPick={(holdMs) => onSettings({ holdMs })}
        />
      </section>

      <section className="card linkrow">
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button className="ghost" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
      </section>
    </TableShell>
  );
}
