// Wait for the current view to be ready, then full-page screenshot it.
// Usage: node screenshot.mjs <out.png> [ready-selector]
//   e.g. node screenshot.mjs "$STAGE_ARTIFACTS/after-fix.png" '.explain-drawer'
import { connect, disconnect, waitForReady } from './lib.mjs'

const out = process.argv[2] || 'shot.png'
const ready = process.argv[3] || ''
const conn = await connect()
try {
  await waitForReady(conn.page, ready)
  await conn.page.screenshot({ path: out, fullPage: true })
  console.log(`saved ${out} (url: ${conn.page.url()})`)
} finally {
  await disconnect(conn)
}
