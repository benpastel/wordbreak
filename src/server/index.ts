import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { loadDictionary } from './dictionary';
import { loadDefinitions } from './definitions';
import { loadFrequencies } from './frequency';
import { Hub } from './hub';
import type { ClientMsg, ServerMsg } from '../shared/types';

const PORT = Number(process.env.PORT) || 8080;

const wordCount = loadDictionary();
const freqCount = loadFrequencies();
const defCount = loadDefinitions();

const app = express();
app.use(compression()); // words.txt is 1.6MB raw, ~450KB over the wire

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, words: wordCount, ranked: freqCount, defined: defCount });
});

// In dev the client is served by Vite on :5173 (which proxies /ws here), so this
// directory only exists after a build.
const clientDir = path.join(__dirname, '..', 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const sockets = new Map<string, WebSocket>();

const hub = new Hub((playerId, msg: ServerMsg) => {
  const ws = sockets.get(playerId);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
});

wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;
  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (msg.t === 'hello') {
      playerId = hub.hello(msg.playerId, msg.name, (id) => {
        // A second tab for the same identity takes over the seat.
        const prev = sockets.get(id);
        if (prev && prev !== ws) prev.close(4000, 'replaced');
        sockets.set(id, ws);
      });
      return;
    }

    if (!playerId) return;
    switch (msg.t) {
      case 'setName':
        hub.setName(playerId, msg.name);
        break;
      case 'createTable':
        hub.createTable(playerId, msg.name);
        break;
      case 'joinTable':
        hub.joinTable(playerId, msg.tableId);
        break;
      case 'leaveTable':
        hub.leaveTable(playerId);
        break;
      case 'setSettings':
        hub.setSettings(playerId, msg.settings);
        break;
      case 'setColor':
        hub.setColor(playerId, msg.color);
        break;
      case 'setReady':
        hub.setReady(playerId, msg.ready);
        break;
      case 'start':
        hub.start(playerId);
        break;
      case 'claim':
        hub.claim(playerId, msg.tileIds);
        break;
      case 'chat':
        hub.chat(playerId, msg.text);
        break;
    }
  });

  ws.on('close', () => {
    if (!playerId) return;
    if (sockets.get(playerId) === ws) {
      sockets.delete(playerId);
      hub.disconnect(playerId);
    }
  });

  // Heroku drops connections idle for ~55s, so keep them warm.
  const ping = setInterval(() => {
    if (!alive) {
      clearInterval(ping);
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 25_000);
  ws.on('close', () => clearInterval(ping));
});

server.listen(PORT, () => {
  console.log(
    `wordbreak listening on :${PORT}  ` +
      `(${wordCount.toLocaleString()} words, ${freqCount.toLocaleString()} ranked, ` +
      `${defCount.toLocaleString()} defined)`,
  );
});
