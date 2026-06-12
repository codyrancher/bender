// Log in as admin to the Rancher dashboard (idempotent).
// Usage: node login.mjs [base]
//   base defaults to the dev server; pass https://$RANCHER_HOST_NAME for stock.
import { connect, disconnect, loginAsAdmin, BASE } from './lib.mjs'

const base = process.argv[2] || BASE
const conn = await connect()
try {
  await loginAsAdmin(conn.page, { base })
  console.log(`logged in (${base})`)
} finally {
  await disconnect(conn)
}
