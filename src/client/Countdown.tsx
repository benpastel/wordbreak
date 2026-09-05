import { useEffect, useState } from 'react';
import { serverTime } from './net';

/** The agreed-to-play warning. Counts down from the server's own timestamp so
 *  every screen at the table shows the same number. */
export default function Countdown({ startsAt }: { startsAt: number }) {
  const [left, setLeft] = useState(() => Math.max(0, startsAt - serverTime()));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, startsAt - serverTime()));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startsAt]);

  const secs = Math.max(1, Math.ceil(left / 1000));
  return (
    <div className="countdown" role="status">
      <span className="num" key={secs}>
        {secs}
      </span>
      <span className="lab">starting</span>
    </div>
  );
}
