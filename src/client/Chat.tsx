import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LEN } from '../shared/types';
import type { ChatMessage } from '../shared/types';

/**
 * Table talk. Shown before the first match and between matches, never over the
 * board — the history is one continuous thread across everything played at this
 * table, so it reads back as the session rather than as one round.
 */
export default function Chat({
  messages,
  onSend,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  // Follow the tail as it grows, but leave the scroll alone if you have read back.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="chat">
      <div className="chatlog" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chatempty">Say something while you wait.</p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className={`chatline c${m.color}`}>
              <b>{m.name}</b>
              {m.text}
            </p>
          ))
        )}
      </div>
      <div className="chatbox">
        <input
          value={draft}
          maxLength={MAX_CHAT_LEN}
          placeholder="message the table"
          aria-label="Chat message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
            // The board's shortcuts are not mounted here, but stop anything leaking.
            e.stopPropagation();
          }}
        />
        <button className="ghost" onClick={send} disabled={!draft.trim()}>
          send
        </button>
      </div>
    </div>
  );
}
