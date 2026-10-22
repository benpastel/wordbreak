// Banked words, read aloud by the browser's own voice. Per device and off by
// default: the switch sits beside the preferences button, the volume inside it.

const ON_KEY = 'wordbreak.speech';
const VOLUME_KEY = 'wordbreak.volume';
/** Words waiting beyond this are dropped: hearing one late is worse than not at all. */
const MAX_WAITING = 2;

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

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

let on = read(ON_KEY) === 'on';
let volume = (() => {
  const v = Number(read(VOLUME_KEY));
  return read(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 1;
})();
let waiting = 0;

/** False where the browser has no speech at all, so the switch can stay away. */
export const canSpeak = !!synth;

export const speechOn = () => on;
export const speechVolume = () => volume;

/** Switching on happens inside the tap, which is what lets iOS speak later: it
 *  only allows speech that a gesture started, and an empty utterance counts. */
export function setSpeechOn(v: boolean): void {
  on = v;
  write(ON_KEY, v ? 'on' : 'off');
  if (!synth) return;
  if (v) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } else {
    synth.cancel();
    waiting = 0;
  }
}

export function setSpeechVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  write(VOLUME_KEY, String(volume));
}

/** An English voice, preferring the device's default among them. Voices load late
 *  on some browsers, so this is asked each time rather than once. */
function voice(): SpeechSynthesisVoice | undefined {
  const en = synth?.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')) ?? [];
  return en.find((v) => v.default) ?? en.find((v) => v.localService) ?? en[0];
}

export function say(word: string): void {
  if (!on || !synth || volume === 0 || waiting > MAX_WAITING) return;
  const u = new SpeechSynthesisUtterance(word.toLowerCase());
  u.volume = volume;
  u.lang = 'en-US';
  const v = voice();
  if (v) u.voice = v;
  waiting++;
  u.onend = u.onerror = () => {
    waiting = Math.max(0, waiting - 1);
  };
  synth.speak(u);
}
