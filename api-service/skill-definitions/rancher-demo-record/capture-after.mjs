// Capture an "after-fix" screenshot from the dev server (https://localhost:8005)
// reliably: it loads the app shell, logs in if the dev server bounces to
// /auth/login, waits for the SPA to hydrate BEFORE deep-linking (deep-linking a
// cold shell is what produces the fail-whale / 404 / "Reload" page), then
// navigates to the target view, lets it settle, and screenshots it.
//
// Reuse this instead of re-deriving navigation by hand — that hand-rolling is
// what made this stage flail and time out.
//
// Usage (run in the FOREGROUND — its stdout is the result; do NOT background it
// and then `sleep N && cat`, the harness blocks that):
//   node .claude/skills/rancher-demo-record/capture-after.mjs <dashboard-path> <out.png>
//   e.g.
//   node .claude/skills/rancher-demo-record/capture-after.mjs \
//     /dashboard/c/local/explorer/cert-manager.io.certificate/create \
//     "$STAGE_ARTIFACTS/after-fix.png"
//
// Password: reads $RANCHER_ADMIN_PASS (or $CATTLE_BOOTSTRAP_PASSWORD). The dev
// server proxies auth to the stock Rancher backend, so the same admin creds work.

import { chromium } from 'playwright-core'

const CDP = process.env.CLAUDE_BROWSER_CDP || 'http://localhost:9222'
const BASE = process.env.DEV_SERVER || 'https://localhost:8005'
const USER = process.env.RANCHER_ADMIN_USER || 'admin'
const PASS = process.env.RANCHER_ADMIN_PASS || process.env.CATTLE_BOOTSTRAP_PASSWORD || ''

const targetPath = process.argv[2]
const out = process.argv[3] || 'after-fix.png'
if (!targetPath) {
  console.error('usage: node capture-after.mjs <dashboard-path> <out.png>')
  process.exit(1)
}

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0] || (await browser.newContext())
const page = await ctx.newPage()
try {
  await page.setViewportSize({ width: 1280, height: 800 })

  // 1) Load the app shell. If the dev server bounces us to login, sign in once.
  await page.goto(`${BASE}/dashboard/home`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  if (/\/auth\/login/.test(page.url())) {
    if (!PASS) throw new Error('RANCHER_ADMIN_PASS / CATTLE_BOOTSTRAP_PASSWORD not set — cannot log in')
    await page.locator('[data-testid="login-submit"]').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('[data-testid="local-login-username"]').fill(USER)
    await page.locator('[data-testid="local-login-password"] input').fill(PASS)
    await page.locator('[data-testid="login-submit"]').click()
    await page.waitForURL(u => !/\/auth\/login/.test(u.toString()), { timeout: 30_000 })
  }

  // 2) Let the shell hydrate before deep-linking — this is what avoids the
  //    fail-whale / 404 you get when you jump straight to a deep resource URL.
  await page.waitForLoadState('networkidle').catch(() => {})

  // 3) Navigate to the target view (SPA route) and let it settle.
  await page.goto(`${BASE}${targetPath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2500)

  await page.screenshot({ path: out, fullPage: true })
  console.log(`saved ${out} (url: ${page.url()})`)
} finally {
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
}
