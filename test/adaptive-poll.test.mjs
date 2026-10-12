import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { pollWhileVisible } from '../ui/adaptivePoll.js'

async function advance(ms) {
  mock.timers.tick(ms)
  // Let the awaited tick and its rescheduling settle.
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function fakeDocument(visibilityState = 'visible') {
  const listeners = new Set()
  return {
    visibilityState,
    listeners,
    addEventListener(_name, cb) { listeners.add(cb) },
    removeEventListener(_name, cb) { listeners.delete(cb) },
    set(state) {
      this.visibilityState = state
      for (const cb of listeners) cb()
    },
  }
}

// A host with the runtime frame signal. Its document stays visible while the
// shell hides the frame, as Möbius does for recently used apps.
function frameHost() {
  const listeners = new Set()
  const mobius = {
    runtimeFeatures: { frameVisibility: true },
    onVisibilityChange(cb) {
      listeners.add(cb)
      cb(true)
      return () => listeners.delete(cb)
    },
  }
  return {
    mobius,
    doc: fakeDocument('visible'),
    listeners,
    show(visible) { for (const cb of listeners) cb(visible) },
  }
}

function withTimers(fn) {
  return async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      await fn()
    } finally {
      mock.timers.reset()
    }
  }
}

test('an idle view backs off to the ceiling and a change restores the fast cadence', withTimers(async () => {
  const ticks = []
  let changed = false
  const poll = pollWhileVisible(async (info) => {
    ticks.push(info)
    return changed
  }, { minMs: 1000, maxMs: 4000, mobius: {}, doc: fakeDocument() })

  await advance(1000) // unchanged -> next in 2000
  await advance(1999)
  assert.equal(ticks.length, 1)
  await advance(1) // unchanged -> next in 4000 (capped)
  assert.equal(ticks.length, 2)
  await advance(4000)
  await advance(4000)
  assert.equal(ticks.length, 4, 'the wait never exceeds maxMs')
  assert.ok(ticks.every((info) => info.resumed === false))

  changed = true
  await advance(4000) // a change resets the next wait to minMs
  await advance(1000)
  assert.equal(ticks.length, 6)
  poll.stop()
  await advance(10000)
  assert.equal(ticks.length, 6, 'a stopped poll never ticks again')
}))

test('a hidden frame makes no requests and refreshes at once when shown', withTimers(async () => {
  const host = frameHost()
  const ticks = []
  const poll = pollWhileVisible(async (info) => {
    ticks.push(info)
    return false
  }, { minMs: 1000, maxMs: 4000, mobius: host.mobius, doc: host.doc })

  host.show(false)
  await advance(60000)
  assert.equal(ticks.length, 0, 'the document stays visible, but the frame signal wins')

  host.show(true)
  await advance(0)
  assert.deepEqual(ticks, [{ resumed: true }])
  await advance(1000)
  assert.deepEqual(ticks, [{ resumed: true }, { resumed: false }], 'shown views return to the fast cadence')

  poll.stop()
  assert.equal(host.listeners.size, 0)
}))

test('older hosts follow the document visibility', withTimers(async () => {
  const doc = fakeDocument('visible')
  let ticks = 0
  const poll = pollWhileVisible(async () => { ticks += 1 }, { minMs: 1000, maxMs: 4000, mobius: {}, doc })
  doc.set('hidden')
  await advance(10000)
  assert.equal(ticks, 0)
  doc.set('visible')
  await advance(0)
  assert.equal(ticks, 1)
  poll.stop()
  assert.equal(doc.listeners.size, 0)
}))

test('poke refreshes a visible view at once and restores the fast cadence', withTimers(async () => {
  const doc = fakeDocument('visible')
  const ticks = []
  const poll = pollWhileVisible(async (info) => {
    ticks.push(info)
    return false
  }, { minMs: 1000, maxMs: 8000, mobius: {}, doc })
  await advance(1000)
  await advance(2000)
  assert.equal(ticks.length, 2) // now waiting 4000

  poll.poke()
  await advance(0)
  assert.deepEqual(ticks.at(-1), { resumed: true })
  await advance(1000)
  assert.equal(ticks.length, 4)

  doc.set('hidden')
  poll.poke()
  await advance(10000)
  assert.equal(ticks.length, 4, 'focus never polls a hidden view')
  poll.stop()
}))

test('a failing tick keeps the poll alive', withTimers(async () => {
  let ticks = 0
  const poll = pollWhileVisible(async () => {
    ticks += 1
    throw new Error('offline')
  }, { minMs: 1000, maxMs: 2000, mobius: {}, doc: fakeDocument() })
  await advance(1000)
  await advance(2000)
  await advance(2000)
  assert.equal(ticks, 3)
  poll.stop()
}))
