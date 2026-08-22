import { useEffect, useState } from 'react';

interface Props {
  name: string;
  onSetName: (n: string) => void;
  label?: string;
  /** Lobby treatment: large enough to read as the first thing to do. */
  big?: boolean;
}

/**
 * Editing your own name. Shared so that arriving by an invite link — which skips
 * the lobby entirely — still gives you somewhere to set it.
 *
 * Focusing selects the whole value, because the field is prefilled with a random
 * default and typing over it should not require clearing it first.
 */
export default function NameField({ name, onSetName, label = 'Name', big }: Props) {
  const [draft, setDraft] = useState(name);

  // The server normalises names (trims, caps length), so follow what it settled on.
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const n = draft.trim();
    if (n && n !== name) onSetName(n);
    else setDraft(name);
  };

  return (
    <label className={`namefield${big ? ' big' : ''}`}>
      <span>{label}</span>
      <input
        value={draft}
        maxLength={20}
        spellCheck={false}
        autoComplete="off"
        placeholder="your name"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}
