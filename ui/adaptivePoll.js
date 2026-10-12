// Polling cadence for views that must notice agent-written storage changes.
// Storage subscriptions only see this frame's own writes, so the gallery and
// detail views poll. They poll quickly right after something changed (an agent
// is usually mid-edit) and back off while nothing does. The ceiling stays
// short because the owner often watches an open view for a page they just
// asked the agent for; a hidden view makes no requests at all.
export const POLL_MIN_MS = 3500
export const POLL_MAX_MS = 10000

// Calls `cb(visible)` now and on every change. Möbius keeps hidden app frames
// loaded while `document.visibilityState` stays "visible", so the runtime's
// frame signal is preferred; older hosts fall back to the document.
function onFrameVisibility(cb, mobius, doc) {
  if (mobius?.runtimeFeatures?.frameVisibility) return mobius.onVisibilityChange(cb)
  const report = () => cb(doc.visibilityState !== 'hidden')
  report()
  doc.addEventListener('visibilitychange', report)
  return () => doc.removeEventListener('visibilitychange', report)
}

// Runs `tick({ resumed })` while the frame is visible. `tick` returns (or
// resolves) true when it observed a change. After a change the next tick is
// `minMs` away; each unchanged tick doubles the wait up to `maxMs`. A return to
// view and `poke()` (for focus) tick at once with `resumed: true` and restore
// the fast cadence.
export function pollWhileVisible(tick, {
  minMs = POLL_MIN_MS,
  maxMs = POLL_MAX_MS,
  mobius = globalThis.window?.mobius,
  doc = globalThis.document,
} = {}) {
  let timer = null
  let run = 0 // bumped on every restart and stop so a superseded loop ends
  let visible = false
  let started = false

  function schedule(mine, wait) {
    timer = setTimeout(() => loop(mine, Math.min(maxMs, wait * 2), false), wait)
  }

  async function loop(mine, idleWait, resumed) {
    let changed = false
    try {
      changed = (await tick({ resumed })) === true
    } catch {}
    if (mine === run) schedule(mine, changed ? minMs : idleWait)
  }

  function restart(immediately) {
    clearTimeout(timer)
    run += 1
    if (!visible) return
    if (immediately) void loop(run, minMs, true)
    else schedule(run, minMs)
  }

  const unsubscribe = onFrameVisibility((next) => {
    if (started && next === visible) return
    visible = next
    // The first report only starts the cadence; the view loads itself on mount.
    restart(started)
    started = true
  }, mobius, doc)

  return {
    poke: () => restart(true),
    stop() {
      run += 1
      clearTimeout(timer)
      unsubscribe()
    },
  }
}
