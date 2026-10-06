import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMsg, Fx, ServerMsg, Settings, TableSummary, TableView } from '../shared/types';
import { Net } from './net';
import type { NetStatus } from './net';
import { loadWords, wordsReady } from './dict';
import Lobby from './Lobby';
import TableRoom from './TableRoom';
import Game from './Game';
import Results from './Results';

const ID_KEY = 'wordbreak.playerId';
/** The name the player typed, remembered across visits. */
const NAME_KEY = 'wordbreak.name';

/**
 * Empty until they type something. Nothing is invented on their behalf.
 *
 * There used to be a generated "quick otter" placeholder here, with a second
 * session-scoped key to keep it from being mistaken for a real choice. Requiring a
 * name instead removes the thing that needed distinguishing, so both the generator
 * and the bookkeeping around it are gone — a returning player still gets their own
 * name back from localStorage.
 */
function storedName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

function hashTable(): string | null {
  const m = location.hash.match(/^#\/t\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

export default function App() {
  const [status, setStatus] = useState<NetStatus>('connecting');
  const [meId, setMeId] = useState<string | null>(null);
  const [name, setName] = useState(storedName);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [table, setTable] = useState<TableView | null>(null);
  const [fx, setFx] = useState<{ seq: number; items: Fx[] }>({ seq: 0, items: [] });
  const [dict, setDict] = useState(wordsReady());
  const [toast, setToast] = useState<string | null>(null);
  const [wantHash, setWantHash] = useState(hashTable);

  const netRef = useRef<Net | null>(null);
  const send = useCallback((m: ClientMsg) => netRef.current?.send(m), []);

  useEffect(() => {
    loadWords().then(
      () => setDict(true),
      () => setToast('Could not load the dictionary.'),
    );
  }, []);

  const onMsg = useCallback((msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        localStorage.setItem(ID_KEY, msg.playerId);
        setMeId(msg.playerId);
        setName(msg.name);
        break;
      case 'lobby':
        setTables(msg.tables);
        setTable(null);
        break;
      case 'table':
        setTable(msg.table);
        if (msg.fx.length) setFx((f) => ({ seq: f.seq + 1, items: msg.fx }));
        break;
      case 'left':
        setTable(null);
        break;
      case 'error':
        setToast(msg.message);
        setTimeout(() => setToast(null), 2600);
        break;
    }
  }, []);

  useEffect(() => {
    const net = new Net(onMsg, setStatus, () => ({
      t: 'hello',
      playerId: localStorage.getItem(ID_KEY),
      name: storedName(),
    }));
    netRef.current = net;
    net.connect();
    return () => {
      net.dispose();
      netRef.current = null;
    };
  }, [onMsg]);

  // Shareable table links: the hash is the source of truth for "which table", so a
  // pasted link joins on arrival and leaving puts you back at #/.
  useEffect(() => {
    const onHash = () => setWantHash(hashTable());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A pasted link still joins on arrival, but not before there is a name to join
  // under: the hash is held until one exists, and typing it lets this through.
  useEffect(() => {
    if (!meId || !wantHash || !name) return;
    if (table?.id === wantHash) return;
    send({ t: 'joinTable', tableId: wantHash });
  }, [meId, wantHash, name, table?.id, send]);

  useEffect(() => {
    const target = table ? `#/t/${table.id}` : '#/';
    if (location.hash !== target) history.replaceState(null, '', target);
    if (!table) setWantHash(null);
  }, [table?.id]);

  const actions = useMemo(
    () => ({
      setName: (n: string) => {
        setName(n);
        localStorage.setItem(NAME_KEY, n);
        send({ t: 'setName', name: n });
      },
      create: (n: string) => send({ t: 'createTable', name: n }),
      join: (id: string) => send({ t: 'joinTable', tableId: id }),
      leave: () => send({ t: 'leaveTable' }),
      settings: (s: Partial<Settings>) => send({ t: 'setSettings', settings: s }),
      color: (c: number) => send({ t: 'setColor', color: c }),
      ready: (r: boolean) => send({ t: 'setReady', ready: r }),
      claim: (tileIds: number[]) => send({ t: 'claim', tileIds }),
      chat: (text: string) => send({ t: 'chat', text }),
    }),
    [send],
  );

  let body: React.ReactNode;
  if (!meId) {
    body = <Splash text={status === 'closed' ? 'reconnecting…' : 'connecting…'} />;
  } else if (table && table.phase === 'ended') {
    // Between matches the board is put away; the write-up and the table talking
    // about it are the whole screen.
    body = (
      <Results
        table={table}
        meId={meId}
        fx={fx}
        onReady={actions.ready}
        onChat={actions.chat}
        onLeave={actions.leave}
      />
    );
  } else if (table && table.phase === 'playing' && table.game) {
    body = dict ? (
      <Game
        table={table}
        fx={fx}
        onClaim={actions.claim}
        onLeave={actions.leave}
      />
    ) : (
      <Splash text="loading dictionary…" />
    );
  } else if (table) {
    body = (
      <TableRoom
        table={table}
        meId={meId}
        onSetName={actions.setName}
        onSettings={actions.settings}
        onColor={actions.color}
        onReady={actions.ready}
        onChat={actions.chat}
        onLeave={actions.leave}
      />
    );
  } else {
    body = (
      <Lobby
        name={name}
        tables={tables}
        onSetName={actions.setName}
        onCreate={actions.create}
        onJoin={actions.join}
      />
    );
  }

  return (
    <div className="app">
      {body}
      {status !== 'open' && meId && <div className="netbar">reconnecting…</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <h1>WordBreak</h1>
      <p>{text}</p>
    </div>
  );
}
