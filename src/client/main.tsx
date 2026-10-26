import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { sfx, wakeAudio } from './sound';
import { FLUSH } from './TableShell';
import './styles.css';

// The page itself goes white with the flush layout, not just the table screens.
document.documentElement.classList.toggle('flush', FLUSH);

// Every button ticks, and the first tap anywhere wakes audio, which browsers hold
// back until someone has touched the page.
document.addEventListener('pointerdown', wakeAudio, { once: true, capture: true });
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (b && !b.disabled) sfx('click');
  },
  { capture: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
