import { useEffect, useRef, useState } from 'react';
import { setSoundPrefs, soundPrefs, wakeAudio } from './sound';
import type { SoundPrefs } from './sound';
import { canSpeak, hushSpeech, primeSpeech } from './speech';

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

// Full screen. Safari on iPad still uses the webkit-prefixed names; iPhone offers
// none at all for a page, so there the button is never shown.
type WebkitDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
const doc = document as WebkitDoc;
const canFullscreen = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
const isFullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

function toggleFullscreen(): void {
  if (isFullscreen()) {
    void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
  } else {
    const el = document.documentElement as WebkitEl;
    void (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.())?.catch?.(() => {
      // Refused (no gesture, or the browser said no): nothing to undo.
    });
  }
}

export default function Prefs() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => ({ theme: stored('theme'), input: stored('input') }));
  const [sound, setSound] = useState(soundPrefs);
  const [full, setFull] = useState(isFullscreen);

  // Kept in step with the browser, which also leaves full screen on Escape or a
  // swipe, without this button being involved.
  useEffect(() => {
    const sync = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  const change = (patch: Partial<SoundPrefs>) => {
    setSoundPrefs(patch);
    setSound(soundPrefs());
  };
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
      {/* Everything audible at once: spoken words, effects and music, each also with its
          own checkbox and volume in the menu. Switching on happens inside the tap,
          which is what browsers need before they will make any sound. */}
      <button
        className="prefsbtn"
        aria-label="sound"
        aria-pressed={sound.on}
        onClick={() => {
          if (!sound.on) {
            wakeAudio();
            primeSpeech();
          } else {
            hushSpeech();
          }
          change({ on: !sound.on });
        }}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor" />
          {sound.on ? (
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
      {canFullscreen && (
        <button
          className="prefsbtn"
          aria-label={full ? 'leave full screen' : 'full screen'}
          aria-pressed={full}
          onClick={toggleFullscreen}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path
              d={
                full
                  ? 'M7.5 3v4.5H3M12.5 3v4.5H17M7.5 17v-4.5H3M12.5 17v-4.5H17'
                  : 'M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5'
              }
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
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
            <div className="setting sound">
              <label className="check">
                <input
                  type="checkbox"
                  checked={sound.spoken}
                  onChange={(e) => change({ spoken: e.target.checked })}
                />
                spoken words
              </label>
              <input
                aria-label="spoken words volume"
                className="volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sound.spokenVolume}
                disabled={!sound.spoken}
                onChange={(e) => change({ spokenVolume: Number(e.target.value) })}
              />
            </div>
          )}
          <div className="setting sound">
            <label className="check">
              <input type="checkbox" checked={sound.sfx} onChange={(e) => change({ sfx: e.target.checked })} />
              sound effects
            </label>
            <input
              aria-label="sound effects volume"
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sound.sfxVolume}
              disabled={!sound.sfx}
              onChange={(e) => change({ sfxVolume: Number(e.target.value) })}
            />
          </div>
          <div className="setting sound">
            <label className="check">
              <input type="checkbox" checked={sound.music} onChange={(e) => change({ music: e.target.checked })} />
              music
            </label>
            <input
              aria-label="music volume"
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sound.musicVolume}
              disabled={!sound.music}
              onChange={(e) => change({ musicVolume: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
