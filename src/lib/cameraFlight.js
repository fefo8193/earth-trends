/** A shared deadline covers single flights and the complete two-stage Mirror flight. */
export function createFlightLock(onLock, { now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
  let until = 0, timer, locked = false;
  function release() {
    const remaining = until - now();
    if (remaining > 0) { timer = schedule(release, remaining); return; }
    until = 0;
    if (locked) { locked = false; onLock(false); }
  }
  return {
    isLocked: () => locked && now() < until,
    hold(ms) {
      if (!(ms > 0)) return;
      until = Math.max(until, now() + ms);
      if (!locked) { locked = true; onLock(true); }
      cancel(timer); timer = schedule(release, Math.max(0, until - now()));
    },
    dispose() { cancel(timer); until = 0; if (locked) { locked = false; onLock(false); } },
  };
}
