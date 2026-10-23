import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is a plain static bundle. The server hosts it from dist/client on the
// same origin as the websocket, so there is no CORS and no build-time server URL.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
