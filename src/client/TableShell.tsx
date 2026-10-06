import type { ReactNode } from 'react';
import type { TableView } from '../shared/types';
import Chat from './Chat';
import ReadyButton from './ReadyButton';

interface Props {
  table: TableView;
  meId: string;
  onReady: (r: boolean) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
  /** What the ready button says before you press it. */
  readyLabel?: string;
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
  readyLabel,
  children,
}: Props) {
  const me = table.players.find((p) => p.id === meId);
  return (
    <div className="shell">
      <div className="shellmain">{children}</div>
      <Chat messages={table.chat} onSend={onChat} />
      <div className="shellbar">
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
          idleLabel={readyLabel}
        />
      </div>
    </div>
  );
}
