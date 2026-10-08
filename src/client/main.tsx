import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FLUSH } from './TableShell';
import './styles.css';

// The page itself goes white with the flush layout, not just the table screens.
document.documentElement.classList.toggle('flush', FLUSH);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
