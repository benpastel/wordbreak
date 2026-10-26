import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Where the choice is remembered, per device. Open until someone folds it. */
  storageKey: string;
  className: string;
  children: ReactNode;
}

function storedFolded(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'folded';
  } catch {
    return false;
  }
}

/**
 * A front-page section that folds away under its own heading: the whole heading row
 * is the switch, with a chevron at its end. Folded, its contents are not drawn at all.
 */
export default function Fold({ title, storageKey, className, children }: Props) {
  const [folded, setFolded] = useState(() => storedFolded(storageKey));
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(storageKey, next ? 'folded' : 'open');
    } catch {
      // Applies for this visit only.
    }
  };
  return (
    <section className={`fold ${className}${folded ? ' folded' : ''}`}>
      <h2>
        <button className="foldtoggle" aria-expanded={!folded} onClick={toggle}>
          {title}
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </h2>
      {!folded && children}
    </section>
  );
}
