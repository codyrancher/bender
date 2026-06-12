// Navigate to a dashboard path (or full URL) and wait for it to render.
// Usage: node goto.mjs <path|url> [ready-selector]
//   e.g. node goto.mjs /dashboard/c/local/explorer/cert-manager.io.certificate/create 'form#cru'
import { connect, disconnect, gotoPath, BASE } from './lib.mjs'

const target = process.argv[2]
const ready = process.argv[3] || ''
if (!target) {
  console.error('usage: node goto.mjs <path|url> [ready-selector]')
  process.exit(1)
}
const conn = await connect()
try {
  await gotoPath(conn.page, target, { base: BASE, ready })
  console.log(`at ${conn.page.url()}`)
} finally {
  await disconnect(conn)
}
