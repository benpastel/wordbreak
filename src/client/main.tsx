import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { sfx, soundPrefs, wakeAudio } from './sound';
import { FLUSH } from './TableShell';
import './styles.css';

// The page itself goes white with the flush layout, not just the table screens.
document.documentElement.classList.toggle('flush', FLUSH);

// Every button ticks, and the first tap or key anywhere wakes audio, which browsers
// hold back until someone has touched the page. The sound switch is left to wake it
// itself, and only when switching on: a first tap that switches sound off should be
// silent, not a moment of music and a tick.
const isSoundSwitch = (e: Event) => !!(e.target as Element | null)?.closest?.('[aria-label="sound"]');
const wake = (e: Event) => {
  if (isSoundSwitch(e)) return;
  wakeAudio();
  document.removeEventListener('pointerdown', wake, true);
  document.removeEventListener('keydown', wake, true);
};
document.addEventListener('pointerdown', wake, true);
document.addEventListener('keydown', wake, true);
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (b && !b.disabled && !isSoundSwitch(e)) sfx('click');
  },
  { capture: true },
);
// Sound left on from an earlier visit: set the music going now, so it begins from
// the top as soon as the browser allows, at once where the page may play and at the
// first tap where it may not.
if (soundPrefs().on) wakeAudio();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
