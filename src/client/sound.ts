// Everything the game plays aloud: spoken words (speech.ts), small sound effects,
// and music, all under one switch beside the preferences button, each with its own
// checkbox and volume inside the menu. Per device; off until switched on.
//
// The effects are synthesized, not recorded: a few lines of Web Audio each, so
// there is nothing to download and every one can be tuned right here. Any of them
// can later become a sample without anything that calls sfx() changing.

import { MENU_MUSIC } from './menuMusic';

const KEYS = {
  on: 'wordbreak.sound',
  spoken: 'wordbreak.spoken',
  spokenVolume: 'wordbreak.volume',
  sfx: 'wordbreak.sfx',
  sfxVolume: 'wordbreak.sfxVolume',
  music: 'wordbreak.music',
  musicVolume: 'wordbreak.musicVolume',
} as const;
/** Before effects, the switch was for spoken words alone, kept under this key. */
const LEGACY_SPEECH_KEY = 'wordbreak.speech';

export interface SoundPrefs {
  /** The one switch, beside the preferences button: everything, or nothing. */
  on: boolean;
  spoken: boolean;
  spokenVolume: number;
  sfx: boolean;
  sfxVolume: number;
  music: boolean;
  musicVolume: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Applies for this visit only.
  }
}

function readVolume(key: string, fallback: number): number {
  const raw = read(key);
  const v = Number(raw);
  return raw !== null && v >= 0 && v <= 1 ? v : fallback;
}

let prefs: SoundPrefs = {
  on: (read(KEYS.on) ?? read(LEGACY_SPEECH_KEY)) === 'on',
  spoken: read(KEYS.spoken) !== 'off',
  spokenVolume: readVolume(KEYS.spokenVolume, 0.7),
  sfx: read(KEYS.sfx) !== 'off',
  sfxVolume: readVolume(KEYS.sfxVolume, 0.7),
  music: read(KEYS.music) !== 'off',
  musicVolume: readVolume(KEYS.musicVolume, 0.7),
};

export const soundPrefs = (): SoundPrefs => prefs;

export function setSoundPrefs(patch: Partial<SoundPrefs>): void {
  prefs = { ...prefs, ...patch };
  for (const [k, v] of Object.entries(patch) as [keyof SoundPrefs, SoundPrefs[keyof SoundPrefs]][]) {
    write(KEYS[k], typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
  }
  syncMusic(0.3);
}

// ------------------------------------------------------------------ effects

export type Sfx = 'click' | 'claim' | 'invalid' | 'blocked' | 'bank' | 'break' | 'won' | 'ended';

let ctx: AudioContext | null = null;

/** Browsers start audio suspended until a tap; any tap will do, so the first one
 *  anywhere wakes it, and the sound switch does too. Called before any tap, it sets
 *  things up to start the moment the browser lets them. */
export function wakeAudio(): void {
  if (typeof AudioContext === 'undefined') return;
  if (!ctx) {
    ctx = new AudioContext();
    syncMusic(0.3);
  }
  // Refused until the page has been touched; the next tap asks again.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

interface Tone {
  freq: number;
  /** Seconds after now. */
  at?: number;
  /** Seconds to fade to silence. */
  dur: number;
  gain: number;
  type?: OscillatorType;
  /** Where the pitch falls (or rises) to over the tone. */
  slideTo?: number;
}

function tone(out: AudioNode, { freq, at = 0, dur, gain, type = 'sine', slideTo }: Tone): void {
  const t = ctx!.currentTime + at;
  const osc = ctx!.createOscillator();
  const env = ctx!.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  // A 3ms attack rather than none, so nothing clicks on starting.
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;

/** A burst of filtered noise: the stuff of cracks and snaps, which have no pitch. */
function hiss(
  out: AudioNode,
  { at = 0, dur, gain, type = 'bandpass', freq, q = 1 }:
    { at?: number; dur: number; gain: number; type?: BiquadFilterType; freq: number; q?: number },
): void {
  const c = ctx!;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const env = c.createGain();
  src.buffer = noiseBuffer;
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// Every pitched effect is in D minor, the key of the music (a hang drum in D Kurd:
// D, E, F, G, A, B flat, C), and tuned to it: the drum sits about 6 cents above
// A = 440. So an effect over the music lands as a note of it rather than beside it.
const A4 = 441.5;
/** A note, in semitones from A4. */
const note = (n: number) => A4 * 2 ** (n / 12);
const [A2, F3, C4, D4, E5, F5, A5, Bb5, D6] = [-24, -16, -9, -7, 7, 8, 12, 13, 17].map(note);

/** When a break's pieces start to fall (fx.ts), for the patter to land with them. */
export const BREAK_FALL_MS = 170;

/** The bank chime, a rising fourth: `lo` then `hi` just after. */
function chime(out: AudioNode, lo: number, hi: number, at = 0): void {
  tone(out, { freq: lo, at, dur: 0.32, gain: 0.18 });
  tone(out, { freq: hi, at: at + 0.07, dur: 0.38, gain: 0.16 });
  tone(out, { freq: hi * 2, at: at + 0.07, dur: 0.2, gain: 0.03 });
}

/** Each effect, as tones into the effects' volume. Quiet and short on purpose. */
const EFFECTS: Record<Sfx, (out: AudioNode) => void> = {
  // A soft tick: high, tiny, gone in a blink. Too short to hear as a note.
  click: (out) => tone(out, { freq: 1900, dur: 0.035, gain: 0.12, type: 'triangle' }),
  // A wooden tock, falling a little, like a tile set down: A to E.
  claim: (out) => {
    tone(out, { freq: A5, slideTo: E5, dur: 0.11, gain: 0.32 });
    tone(out, { freq: 2200, dur: 0.02, gain: 0.06, type: 'triangle' });
  },
  // A muted thud, low and short: not a word. Phone and laptop speakers barely play
  // anything this low, so two quiet overtones go with it; from those the ear still
  // hears the low note the speaker cannot make, and on headphones they hardly
  // change the sound.
  invalid: (out) => {
    tone(out, { freq: F3, slideTo: A2, dur: 0.14, gain: 0.35 });
    tone(out, { freq: F3 * 2, slideTo: A2 * 2, dur: 0.12, gain: 0.1 });
    tone(out, { freq: F3 * 3, slideTo: A2 * 3, dur: 0.09, gain: 0.05 });
  },
  // Two dull taps, D then C: a word, but something longer is in the way. Each with a
  // faint octave above, for the same reason.
  blocked: (out) => {
    tone(out, { freq: D4, dur: 0.06, gain: 0.22, type: 'triangle' });
    tone(out, { freq: D4 * 2, dur: 0.05, gain: 0.06 });
    tone(out, { freq: C4, at: 0.075, dur: 0.07, gain: 0.22, type: 'triangle' });
    tone(out, { freq: C4 * 2, at: 0.075, dur: 0.06, gain: 0.06 });
  },
  // A small rising chime, E to A: your claim banked.
  bank: (out) => chime(out, E5, A5),
  // Anyone's claim broken, timed to the picture (fx.ts): a stick-snap as the line
  // between its tiles snaps, a dry crack, then a soft patter of dull knocks as the
  // pieces land. No pitch to speak of, so no key.
  break: (out) => {
    hiss(out, { dur: 0.018, gain: 0.36, type: 'highpass', freq: 1800 });
    tone(out, { freq: 700, slideTo: 260, dur: 0.05, gain: 0.15, type: 'triangle' });
    hiss(out, { at: 0.015, dur: 0.06, gain: 0.4, freq: 2800, q: 1.4 });
    hiss(out, { at: 0.027, dur: 0.035, gain: 0.2, freq: 5200, q: 2 });
    for (let i = 0; i < 6; i++) {
      tone(out, {
        freq: 280 + Math.random() * 240,
        at: (BREAK_FALL_MS + 120 + Math.random() * 350) / 1000,
        dur: 0.035,
        gain: 0.07,
        type: 'triangle',
      });
    }
  },
  // The match over, and you won: the bank chime three times, climbing, coming home
  // to D.
  won: (out) => {
    chime(out, E5, A5);
    chime(out, F5, Bb5, 0.16);
    chime(out, A5, D6, 0.32);
  },
  // The match over, for everyone else: the bank chime, once.
  ended: (out) => chime(out, E5, A5),
};

export function sfx(name: Sfx): void {
  if (!prefs.on || !prefs.sfx || prefs.sfxVolume === 0) return;
  wakeAudio();
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.value = prefs.sfxVolume;
  out.connect(ctx.destination);
  EFFECTS[name](out);
}

// -------------------------------------------------------------------- music

/** Music at full volume plays at this loudness, in LUFS: a little under a game's
 *  usual, since this is a page people may have open beside other things. The file
 *  says how loud it is, so a re-cut or re-levelled loop keeps its place. */
const MUSIC_LUFS = -23;

let wanted = false;
let buffer: Promise<AudioBuffer | null> | null = null;
let playing: { src: AudioBufferSourceNode; gain: GainNode; stopping?: number } | null = null;

function loadMusic(): Promise<AudioBuffer | null> {
  buffer ??= fetch(MENU_MUSIC.url)
    .then((r) => r.arrayBuffer())
    .then((b) => ctx!.decodeAudioData(b))
    .catch(() => {
      buffer = null; // Try again the next time music is wanted.
      return null;
    });
  return buffer;
}

const musicGain = () => prefs.musicVolume * 10 ** ((MUSIC_LUFS - MENU_MUSIC.lufs) / 20);

/** Where the music should be playing. Whatever stands in its way (the switch, its
 *  checkbox, a browser not yet tapped) is checked here, so the screens only say what
 *  they want. Coming in again before a fade has finished picks up where it is;
 *  starting from silence always starts from the top. */
export function music(want: boolean, fade = 1): void {
  wanted = want;
  syncMusic(fade);
}

function syncMusic(fade: number): void {
  if (!ctx) return;
  const audible = wanted && prefs.on && prefs.music && prefs.musicVolume > 0;
  const now = ctx.currentTime;
  if (playing) {
    const g = playing.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(audible ? musicGain() : 0, now + (audible ? 0.1 : fade));
    clearTimeout(playing.stopping);
    playing.stopping = undefined;
    if (!audible) {
      const p = playing;
      p.stopping = window.setTimeout(() => {
        p.src.stop();
        if (playing === p) playing = null;
      }, fade * 1000 + 50);
    }
    return;
  }
  if (!audible) return;
  void loadMusic().then((b) => {
    if (!b || !ctx || playing || !(wanted && prefs.on && prefs.music && prefs.musicVolume > 0)) return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = b;
    // The file is the loop and then its own head again, so any loop-length span
    // inside it repeats seamlessly. This one starts clear of the most padding any
    // browser leaves (about 35ms), in the quiet ring just before the first note,
    // where jumping between the two encoded copies is furthest below hearing.
    src.loop = true;
    src.loopStart = 0.06;
    src.loopEnd = src.loopStart + MENU_MUSIC.loopSeconds;
    // From silence, straight into the first note: the ring before it only belongs
    // when the loop comes round.
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(musicGain(), ctx.currentTime + 0.004);
    src.connect(gain).connect(ctx.destination);
    src.start(0, MENU_MUSIC.firstNoteSeconds);
    playing = { src, gain };
  });
}
