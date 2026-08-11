import type { ClientMsg, ServerMsg } from '../shared/types';

export type NetStatus = 'connecting' | 'open' | 'closed';

function wsUrl(): string {
  // Same origin in every deployment we currently use. Splitting the static half onto
  // GitHub Pages later means setting VITE_WS_URL to the Heroku origin at build time.
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Server clock minus ours. Every snapshot carries the server's `now`, so hold-time
 *  countdowns stay honest without a separate clock-sync handshake. */
let clockOffset = 0;
export function serverTime(): number {
  return Date.now() + clockOffset;
}

export class Net {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private queue: ClientMsg[] = [];
  private closed = false;

  constructor(
    private onMsg: (m: ServerMsg) => void,
    private onStatus: (s: NetStatus) => void,
    private helloMsg: () => ClientMsg,
  ) {}

  connect(): void {
    if (this.closed) return;
    this.onStatus('connecting');
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.onStatus('open');
      ws.send(JSON.stringify(this.helloMsg()));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'table') clockOffset = msg.serverNow - Date.now();
      this.onMsg(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      this.onStatus('closed');
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 8000);
    };

    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  dispose(): void {
    this.closed = true;
    this.ws?.close();
  }
}
