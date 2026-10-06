import type { TableSummary } from '../shared/types';
import NameField from './NameField';

interface Props {
  name: string;
  tables: TableSummary[];
  onSetName: (n: string) => void;
  onCreate: (n: string) => void;
  onJoin: (id: string) => void;
}

export default function Lobby({ name, tables, onSetName, onCreate, onJoin }: Props) {
  // Nothing at a table happens anonymously, so the name gates both ways in.
  const named = name.trim().length > 0;

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
        <NameField name={name} onSetName={onSetName} big />
      </header>

      <div className="tablehead">
        <h2>tables</h2>
        <button
          className="primary"
          disabled={!named}
          onClick={() => onCreate(`${name}'s table`)}
        >
          new table
        </button>
      </div>

      {tables.length > 0 && (
        <ul className="tablelist">
          {tables.map((t) => (
            <li key={t.id}>
              <button className="tablerow" disabled={!named} onClick={() => onJoin(t.id)}>
                <span className="tname">{t.name}</span>
                <span className="dots">
                  {t.players.map((p, i) => (
                    <i key={i} className={`dot c${p.color}`} title={p.name} />
                  ))}
                </span>
                <span className="meta">
                  {t.playerCount}/8 · {t.settings.gridSize}×{t.settings.gridSize} ·{' '}
                  {t.settings.endMode === 'time'
                    ? `${Math.round(t.settings.gameMs / 60_000)} min`
                    : t.settings.endMode === 'points'
                      ? `${t.settings.targetScore} pts`
                      : 'unlimited'}{' '}
                  · {Math.round(t.settings.holdMs / 1000)}s hold
                </span>
                <span className={`phase${t.phase === 'playing' ? ' on' : ''}`}>
                  {t.phase === 'playing' ? 'playing' : 'open'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
