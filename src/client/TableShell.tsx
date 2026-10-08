import type { ReactNode } from 'react';
import type { TableView } from '../shared/types';
import Chat from './Chat';
import ReadyButton from './ReadyButton';

// EXPERIMENT: true lays the content and chat edge to edge, split by a rule, instead
// of as two floating cards. Flip back to compare; the card styles are untouched.
export const FLUSH = true;

interface Props {
  table: TableView;
  meId: string;
  onReady: (r: boolean) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
  children: ReactNode;
}

/**
 * The frame of every screen at a table that is not the board: the screen's own
 * content, the chat down the right, and leave and ready pinned along the bottom so
 * neither ever scrolls away.
 */
export default function TableShell({
  table,
  meId,
  onReady,
  onChat,
  onLeave,
  children,
}: Props) {
  const me = table.players.find((p) => p.id === meId);
  return (
    <div className={FLUSH ? 'shell flush' : 'shell'}>
      <div className="shellmain">{children}</div>
      <Chat messages={table.chat} onSend={onChat} />
      <div className={FLUSH ? 'shellbar flush' : 'shellbar'}>
        <button className="leave" onClick={onLeave}>
          leave
        </button>
        <ReadyButton
          ready={!!me?.ready}
          waiting={table.players.filter((p) => p.connected && !p.ready).length}
          color={me?.color ?? 0}
          startsAt={table.startsAt}
          countdownMs={table.countdownMs}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
