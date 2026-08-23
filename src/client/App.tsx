import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMsg, Fx, ServerMsg, Settings, TableSummary, TableView } from '../shared/types';
import { Net } from './net';
import type { NetStatus } from './net';
import { loadWords, wordsReady } from './dict';
import Lobby from './Lobby';
import TableRoom from './TableRoom';
import Game from './Game';

const ID_KEY = 'wordbreak.playerId';
/** A name the player actually typed. Kept forever. */
const NAME_KEY = 'wordbreak.name';
/** This visit's placeholder. Session-scoped on purpose — see initialName. */
const AUTO_KEY = 'wordbreak.autoName';
/** Placeholders from before names were two words; clear them so they are not
 *  mistaken for a chosen name and pinned to the browser for good. */
const LEGACY_AUTO = new Set([
  'quick', 'plain', 'brisk', 'lucky', 'quiet', 'sharp', 'brave', 'clever',
]);

// A placeholder with a bit of personality, but still obviously a placeholder — the
// point is that you replace it. Kept short so eight of them fit across a score bar.
const ADJECTIVES = [
  'quick', 'plain', 'brisk', 'lucky', 'quiet', 'sharp', 'brave', 'clever',
  'sly', 'bold', 'calm', 'keen', 'idle', 'rash', 'wry', 'grim',
];
const ANIMALS = [
  'otter', 'badger', 'heron', 'lynx', 'magpie', 'tapir', 'ferret', 'marten',
  'osprey', 'shrew', 'vole', 'wren', 'stoat', 'ibex', 'crane', 'raven',
];
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
function defaultName(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

/**
 * A chosen name outlives the browser session; a generated one only lasts the tab.
 *
 * Persisting placeholders was the bug: once written they were indistinguishable
 * from a real choice, so a player who never typed a name was pinned to whatever
 * the generator happened to produce the first time — and never saw a later, better
 * default. Session scope keeps it stable across a refresh mid-game while letting a
 * fresh visit get a fresh placeholder.
 */
function initialName(): string {
  const stored = localStorage.getItem(NAME_KEY);
  if (stored && LEGACY_AUTO.has(stored)) localStorage.removeItem(NAME_KEY);
  else if (stored) return stored;

  const auto = sessionStorage.getItem(AUTO_KEY);
  if (auto) return auto;
  const fresh = defaultName();
  sessionStorage.setItem(AUTO_KEY, fresh);
  return fresh;
}

/** What to greet the server with. Empty means "keep whatever you have for me",
 *  which is what a reconnecting player with an unchosen name wants. */
function helloName(): string {
  return localStorage.getItem(NAME_KEY) ?? sessionStorage.getItem(AUTO_KEY) ?? '';
}

function hashTable(): string | null {
  const m = location.hash.match(/^#\/t\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

export default function App() {
  const [status, setStatus] = useState<NetStatus>('connecting');
  const [meId, setMeId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
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
      name: helloName(),
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

  useEffect(() => {
    if (!meId || !wantHash) return;
    if (table?.id === wantHash) return;
    send({ t: 'joinTable', tableId: wantHash });
  }, [meId, wantHash, table?.id, send]);

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
        sessionStorage.removeItem(AUTO_KEY);
        send({ t: 'setName', name: n });
      },
      create: (n: string) => send({ t: 'createTable', name: n }),
      join: (id: string) => send({ t: 'joinTable', tableId: id }),
      leave: () => send({ t: 'leaveTable' }),
      settings: (s: Partial<Settings>) => send({ t: 'setSettings', settings: s }),
      color: (c: number) => send({ t: 'setColor', color: c }),
      ready: (r: boolean) => send({ t: 'setReady', ready: r }),
      claim: (tileIds: number[]) => send({ t: 'claim', tileIds }),
    }),
    [send],
  );

  let body: React.ReactNode;
  if (!meId) {
    body = <Splash text={status === 'closed' ? 'reconnecting…' : 'connecting…'} />;
    // 'ended' stays on the board: final scores, trophies and the ready button are
    // all part of the game view, and being thrown back to the setup screen loses them.
  } else if (table && table.game && (table.phase === 'playing' || table.phase === 'ended')) {
    body = dict ? (
      <Game
        table={table}
        meId={meId}
        fx={fx}
        onClaim={actions.claim}
        onReady={actions.ready}
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
