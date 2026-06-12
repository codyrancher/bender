// Go to the cluster explorer for a resource and wait for it to render.
// Usage: node explorer.mjs <resource> [cluster] [ready-selector]
//   e.g. node explorer.mjs cert-manager.io.certificate local '.masthead'
import { connect, disconnect, gotoPath, explorerPath, BASE } from './lib.mjs'

const resource = process.argv[2]
const cluster = process.argv[3] || 'local'
const ready = process.argv[4] || ''
if (!resource) {
  console.error('usage: node explorer.mjs <resource> [cluster] [ready-selector]')
  process.exit(1)
}
const conn = await connect()
try {
  await gotoPath(conn.page, explorerPath(resource, cluster), { base: BASE, ready })
  console.log(`explorer ${cluster}/${resource} (${conn.page.url()})`)
} finally {
  await disconnect(conn)
}
