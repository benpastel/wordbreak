import { useState } from 'react';
import type { TableSummary } from '../shared/types';

interface Props {
  name: string;
  tables: TableSummary[];
  onSetName: (n: string) => void;
  onCreate: (n: string) => void;
  onJoin: (id: string) => void;
}

export default function Lobby({ name, tables, onSetName, onCreate, onJoin }: Props) {
  const [draft, setDraft] = useState(name);

  const commitName = () => {
    const n = draft.trim();
    if (n && n !== name) onSetName(n);
    else setDraft(name);
  };

  return (
    <div className="lobby">
      <header className="lobbyhead">
        <div>
          <h1>WordBreak</h1>
          <p className="tag">
            <a href="tutorial.html" target="_blank" rel="noreferrer">
              how to play
            </a>
          </p>
        </div>
        <label className="namefield">
          <span>you are</span>
          <input
            value={draft}
            maxLength={16}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      </header>

      <div className="tablehead">
        <h2>tables</h2>
        <button className="primary" onClick={() => onCreate(`${name}'s table`)}>
          new table
        </button>
      </div>

      {tables.length === 0 ? (
        <p className="empty">No tables yet — make one and send someone the link.</p>
      ) : (
        <ul className="tablelist">
          {tables.map((t) => (
            <li key={t.id}>
              <button className="tablerow" onClick={() => onJoin(t.id)}>
                <span className="tname">{t.name}</span>
                <span className="dots">
                  {t.players.map((p, i) => (
                    <i key={i} className={`dot c${p.color}`} title={p.name} />
                  ))}
                </span>
                <span className="meta">
                  {t.playerCount}/8 · {t.settings.gridSize}×{t.settings.gridSize} ·{' '}
                  {Math.round(t.settings.holdMs / 1000)}s
                </span>
                <span className={`phase ${t.phase}`}>{t.phase === 'playing' ? 'playing' : 'open'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
