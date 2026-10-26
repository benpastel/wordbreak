import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientMsg,
  Fx,
  Leaderboard,
  MyRecap,
  ServerMsg,
  Settings,
  TableSummary,
  TableView,
} from '../shared/types';
import { Net } from './net';
import type { NetStatus } from './net';
import { loadWords, wordsReady } from './dict';
import Lobby from './Lobby';
import TableRoom from './TableRoom';
import Game from './Game';
import Results from './Results';
import Prefs from './Prefs';

const ID_KEY = 'wordbreak.playerId';
/** This browser's secret: never shown, and shared by everyone who plays on it. With
 *  the name typed, it is which guest is playing; with the player id, it is what
 *  lets a refreshed tab take its seat back. */
const DEVICE_KEY = 'wordbreak.device';

function deviceSecret(): string {
  let s = localStorage.getItem(DEVICE_KEY);
  if (!s) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, s);
  }
  return s;
}
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

/** The table a link points at: /table/CODE, or the #/t/CODE that links used to
 *  be, so an invite sent before the change still lands at its table. */
function linkedTable(): string | null {
  const m =
    location.pathname.match(/^\/table\/([a-z0-9]+)\/?$/i) ?? location.hash.match(/^#\/t\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

export default function App() {
  const [status, setStatus] = useState<NetStatus>('connecting');
  const [meId, setMeId] = useState<string | null>(null);
  const [name, setName] = useState(storedName);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [table, setTable] = useState<TableView | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  /** The private half of the last match's recap: only ever about you. */
  const [mine, setMine] = useState<MyRecap | null>(null);
  const [fx, setFx] = useState<{ seq: number; items: Fx[] }>({ seq: 0, items: [] });
  const [dict, setDict] = useState(wordsReady());
  const [toast, setToast] = useState<string | null>(null);
  const [wantTable, setWantTable] = useState(linkedTable);

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
      case 'leaderboard':
        setBoard(msg.board);
        break;
      case 'table':
        setTable(msg.table);
        setMine(msg.mine ?? null);
        if (msg.fx.length) setFx((f) => ({ seq: f.seq + 1, items: msg.fx }));
        break;
      case 'left':
        setTable(null);
        break;
      case 'error':
        // A link to a table that is gone or full has done all it can.
        setWantTable(null);
        setToast(msg.message);
        setTimeout(() => setToast(null), 2600);
        break;
    }
  }, []);

  useEffect(() => {
    const net = new Net(onMsg, setStatus, () => ({
      t: 'hello',
      playerId: localStorage.getItem(ID_KEY),
      device: deviceSecret(),
      name: storedName(),
    }));
    netRef.current = net;
    net.connect();
    return () => {
      net.dispose();
      netRef.current = null;
    };
  }, [onMsg]);

  // Shareable table links: the address is the source of truth for "which table", so
  // a pasted link joins on arrival and leaving puts you back at the bare address.
  // Back and forward move between them, and an old #/t/CODE pasted in still works.
  useEffect(() => {
    const onNav = () => setWantTable(linkedTable());
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);

  // A pasted link still joins on arrival, but not before there is a name to join
  // under: the hash is held until one exists, and typing it lets this through.
  useEffect(() => {
    if (!meId || !wantTable || !name) return;
    if (table?.id === wantTable) return;
    send({ t: 'joinTable', tableId: wantTable });
  }, [meId, wantTable, name, table?.id, send]);

  // A linked table is wanted until you are sitting at it, or the server turns the
  // join down. Clearing it any sooner, as this once did on first load, threw the
  // link away before there was a connection to join over; keeping it any longer
  // would join you straight back after leaving.
  useEffect(() => {
    if (table && table.id === wantTable) setWantTable(null);
  }, [table?.id, wantTable]);

  // The address follows: the table you are at, or the one you are on your way to.
  useEffect(() => {
    const id = table?.id ?? wantTable;
    const target = id ? `/table/${id}` : '/';
    if (location.pathname !== target || location.hash) {
      history.replaceState(null, '', `${target}${location.search}`);
    }
  }, [table?.id, wantTable]);

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
      backToSetup: () => send({ t: 'backToSetup' }),
      claim: (tileIds: number[]) => send({ t: 'claim', tileIds }),
      missed: (word: string, why: string) => send({ t: 'missed', word, why }),
      requestWord: (word: string, requested: boolean) => send({ t: 'requestWord', word, requested }),
      chat: (text: string) => send({ t: 'chat', text }),
      addBot: () => send({ t: 'addBot' }),
      removeBot: (botId: string) => send({ t: 'removeBot', botId }),
      botDifficulty: (botId: string, difficulty: number) =>
        send({ t: 'setBotDifficulty', botId, difficulty }),
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
        onBackToSetup={actions.backToSetup}
        onChat={actions.chat}
        onLeave={actions.leave}
        mine={mine}
        onRequestWord={actions.requestWord}
      />
    );
  } else if (table && table.phase === 'playing' && table.game) {
    body = dict ? (
      <Game
        table={table}
        meId={meId}
        fx={fx}
        onClaim={actions.claim}
        onMissed={actions.missed}
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
        onAddBot={actions.addBot}
        onRemoveBot={actions.removeBot}
        onBotDifficulty={actions.botDifficulty}
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
        board={board}
        onSetName={actions.setName}
        onCreate={actions.create}
        onJoin={actions.join}
      />
    );
  }

  return (
    <div className="app">
      {body}
      <Prefs />
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
