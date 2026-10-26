// Claimed words, read aloud by the browser's own voice: one of the two kinds of
// sound under the sound switch (sound.ts), with its own checkbox and volume.

import { soundPrefs } from './sound';

/** Words waiting beyond this are dropped: hearing one late is worse than not at all. */
const MAX_WAITING = 2;

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let waiting = 0;

/** False where the browser has no speech at all, so its controls can stay away. */
export const canSpeak = !!synth;

/** Run inside the tap that switches sound on, which is what lets iOS speak later: it
 *  only allows speech that a gesture started, and an empty utterance counts. */
export function primeSpeech(): void {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
}

/** Silence anything still queued, as when sound is switched off. */
export function hushSpeech(): void {
  synth?.cancel();
  waiting = 0;
}

/** An English voice, preferring the device's default among them. Voices load late
 *  on some browsers, so this is asked each time rather than once. */
function voice(): SpeechSynthesisVoice | undefined {
  const en = synth?.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')) ?? [];
  return en.find((v) => v.default) ?? en.find((v) => v.localService) ?? en[0];
}

export function say(word: string): void {
  const p = soundPrefs();
  if (!p.on || !p.spoken || !synth || p.spokenVolume === 0 || waiting > MAX_WAITING) return;
  const u = new SpeechSynthesisUtterance(word.toLowerCase());
  u.volume = p.spokenVolume;
  u.lang = 'en-US';
  const v = voice();
  if (v) u.voice = v;
  waiting++;
  u.onend = u.onerror = () => {
    waiting = Math.max(0, waiting - 1);
  };
  synth.speak(u);
}
