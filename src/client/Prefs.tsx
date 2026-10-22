import { useEffect, useRef, useState } from 'react';
import { canSpeak, setSpeechOn, setSpeechVolume, speechOn, speechVolume } from './speech';

/**
 * Per-device preferences. Each is an attribute on <html> and the stylesheet does the
 * rest. index.html applies the stored values before first paint, so a dark-mode player
 * never sees a light flash; this keeps them in step after. The first choice is the
 * default.
 */
const PREFS = {
  theme: { key: 'wordbreak.theme', choices: ['light', 'dark'] },
  /** Slide to claim on letting go, or also tap letters in and claim by button. */
  input: { key: 'wordbreak.input', choices: ['slide', 'tap'] },
} as const;
type Pref = keyof typeof PREFS;

function stored(p: Pref): string {
  const { key, choices } = PREFS[p];
  let v: string | null = null;
  try {
    v = localStorage.getItem(key);
  } catch {
    // Storage blocked: fall back to the default for this visit.
  }
  return v && (choices as readonly string[]).includes(v) ? v : choices[0];
}

export default function Prefs() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => ({ theme: stored('theme'), input: stored('input') }));
  const [speaking, setSpeaking] = useState(speechOn);
  const [volume, setVolume] = useState(speechVolume);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    for (const p of Object.keys(PREFS) as Pref[]) root.dataset[p] = values[p];
  }, [values]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const pick = (p: Pref, v: string) => {
    try {
      localStorage.setItem(PREFS[p].key, v);
    } catch {
      // Applies for this visit only.
    }
    setValues((cur) => ({ ...cur, [p]: v }));
  };

  return (
    <div className="prefs" ref={ref}>
      {canSpeak && (
        <button
          className="prefsbtn"
          aria-label="read words aloud"
          aria-pressed={speaking}
          onClick={() => {
            setSpeechOn(!speaking);
            setSpeaking(!speaking);
          }}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor" />
            {speaking ? (
              <path
                d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.3a6.6 6.6 0 0 1 0 9.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ) : (
              <path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
        </button>
      )}
      <button
        className="prefsbtn"
        aria-label="preferences"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="6" r="2.6" fill="currentColor" />
          <circle cx="13" cy="14" r="2.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="prefspop">
          {(Object.keys(PREFS) as Pref[]).map((p) => (
            <div className="setting" key={p}>
              <label>{p}</label>
              <div className="segmented">
                {PREFS[p].choices.map((c) => (
                  <button key={c} className={values[p] === c ? 'on' : ''} onClick={() => pick(p, c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {canSpeak && (
            <div className="setting">
              <label htmlFor="volume">volume</label>
              <input
                id="volume"
                className="volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSpeechVolume(v);
                  setVolume(v);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
