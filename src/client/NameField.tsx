import { useEffect, useState } from 'react';

interface Props {
  name: string;
  onSetName: (n: string) => void;
  /** Lobby treatment: large enough to read as the first thing to do. */
  big?: boolean;
}

/**
 * Editing your own name. Shared so that arriving by an invite link — which skips
 * the lobby entirely — still gives you somewhere to set it.
 *
 * Reports every keystroke rather than waiting for blur. Whether you have a name
 * gates the rest of the lobby, so a name that exists only in this component's
 * local state leaves the controls outside it disabled while the box plainly has
 * something in it — and clicking one of them blurs the field, which commits the
 * name and enables the button underneath the very click that looked ignored.
 */
export default function NameField({ name, onSetName, big }: Props) {
  const [draft, setDraft] = useState(name);

  // The server normalises names (trims, caps length), so follow what it settled on.
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const n = draft.trim();
    if (n !== name) onSetName(n);
    else setDraft(name);
  };

  return (
    <div className={`namefield${big ? ' big' : ''}`}>
      <input
        value={draft}
        aria-label="Your name"
        // Nothing can be done until this is filled, so it takes the caret.
        autoFocus={!name}
        maxLength={20}
        spellCheck={false}
        autoComplete="off"
        placeholder="your name"
        onChange={(e) => {
          setDraft(e.target.value);
          onSetName(e.target.value.trim());
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
