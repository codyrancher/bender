// Wait until the current dashboard view has rendered (content visible + spinner
// gone), optionally also for a specific element. Never a fixed sleep.
// Usage: node wait-ready.mjs [ready-selector]
import { connect, disconnect, waitForReady } from './lib.mjs'

const ready = process.argv[2] || ''
const conn = await connect()
try {
  await waitForReady(conn.page, ready)
  console.log('ready')
} finally {
  await disconnect(conn)
}
