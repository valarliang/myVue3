const queue = []
let isFlushPending = false
const pendingPostFlushCbs = []
let currentFlushPromise = null

const resolvedPromise = Promise.resolve()

export function queueJob(job) {
  if (!queue.length || !queue.includes(job)) {
    queue.push(job)
    queueFlush()
  }
}

function queueFlush() {
  if (!isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

export function queuePostFlushCb(cb) {
  pendingPostFlushCbs.push(...cb)
  queueFlush()
}

function flushJobs(seen) {
  isFlushPending = false
  queue.forEach(job => job())
  queue.length = 0
  pendingPostFlushCbs.forEach(job => job())
  pendingPostFlushCbs.length = 0
  currentFlushPromise = null
}

export function nextTick(this, fn?) {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}