import { useState } from 'react';
import type { MyRecap } from '../shared/types';

interface Props {
  mine: MyRecap;
  onRequest: (word: string, requested: boolean) => void;
}

/**
 * The words you tried that were not words, for asking that any be let in. Folded to
 * a count until opened, so it stays out of the way of anyone who does not care.
 * Only ever your own: nobody else is sent them.
 */
export default function Misses({ mine, onRequest }: Props) {
  const [open, setOpen] = useState(false);
  const n = mine.misses.length;
  return (
    <section className={open ? 'misses open' : 'misses'}>
      <button className="misseshead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {n} {n === 1 ? 'miss' : 'misses'}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <ul>
          {mine.misses.map((m) => (
            <li key={m.word} className={m.requested ? 'on' : undefined}>
              <span className="w">{m.word}</span>
              {m.tries > 1 && <span className="tries">×{m.tries}</span>}
              <button aria-pressed={m.requested} onClick={() => onRequest(m.word, !m.requested)}>
                {m.requested ? 'Requested' : 'Request inclusion'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
