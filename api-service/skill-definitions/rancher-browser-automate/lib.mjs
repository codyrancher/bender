// Reusable Rancher browser primitives, shared by the per-action CLI wrappers in
// this skill (login.mjs, explorer.mjs, goto.mjs, screenshot.mjs, wait-ready.mjs)
// and importable directly from your own scripts:
//
//   import { connect, disconnect, loginAsAdmin, gotoPath, explorerPath, waitForReady }
//     from './lib.mjs'   // (or an absolute file:// URL from elsewhere)
//
// Principle: every wait keys off REAL state — an element becoming visible, a
// spinner clearing, the URL changing — never a fixed `waitForTimeout` sleep
// (those are flaky: too short races, too long wastes the budget). The `timeout`
// option on waitFor() is a fail-safe ceiling, not a sleep.

import { chromium } from 'playwright-core'

export const CDP = process.env.CLAUDE_BROWSER_CDP || 'http://localhost:9222'
// Default base = the dev server (where the fix is visible). Pass an explicit
// base (e.g. https://$RANCHER_HOST_NAME) to drive the stock instance.
export const BASE = process.env.RANCHER_BASE || process.env.DEV_SERVER || 'https://localhost:8005'

// "The view has rendered" / "is still loading" markers for the Rancher dashboard.
const CONTENT = 'main, .dashboard-root, .outlet, [role="main"]'
const SPINNERS = '.loading-indicator, .icon-spinner, [data-testid="loading"], .data-loading'

// Connect to the persistent sidecar browser over CDP. State persists across
// separate process invocations, so these actions compose: run login.mjs, then
// explorer.mjs, then screenshot.mjs as separate commands on the same live tab.
export async function connect({ newTab = false } = {}) {
  const browser = await chromium.connectOverCDP(CDP)
  const ctx = browser.contexts()[0] || (await browser.newContext())
  const page = newTab || ctx.pages().length === 0 ? await ctx.newPage() : ctx.pages()[0]
  return { browser, ctx, page }
}

export async function disconnect(conn) {
  // Closes the CDP connection only — the real browser/tab keeps running.
  try { await conn.browser.close() } catch { /* ignore */ }
}

// Wait for a dashboard view to actually be ready — element/spinner state, never
// a fixed sleep. `selector`, when given, is the element that proves the specific
// target view rendered (e.g. a form, a drawer, a resource header).
export async function waitForReady(page, selector) {
  await page.locator(CONTENT).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  // Resolves immediately if no spinner is present; otherwise waits for it to go.
  await page.locator(SPINNERS).first().waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {})
  if (selector) await page.locator(selector).first().waitFor({ state: 'visible', timeout: 60_000 })
}

// Log in as admin, idempotently. No-op if already authenticated. The dev server
// proxies auth to the stock backend, so the same admin creds work on either.
export async function loginAsAdmin(page, { base = BASE } = {}) {
  const user = process.env.RANCHER_ADMIN_USER || 'admin'
  const pass = process.env.RANCHER_ADMIN_PASS || process.env.CATTLE_BOOTSTRAP_PASSWORD || ''
  await page.goto(`${base}/dashboard/home`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  if (/\/auth\/login/.test(page.url())) {
    if (!pass) throw new Error('RANCHER_ADMIN_PASS / CATTLE_BOOTSTRAP_PASSWORD not set — cannot log in')
    await page.locator('[data-testid="login-submit"]').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('[data-testid="local-login-username"]').fill(user)
    await page.locator('[data-testid="local-login-password"] input').fill(pass)
    await page.locator('[data-testid="login-submit"]').click()
    await page.waitForURL(u => !/\/auth\/login/.test(u.toString()), { timeout: 30_000 })
  }
  await waitForReady(page)
}

// Navigate to a dashboard path (or full URL) and wait for it to render. Always
// log in / let the shell hydrate first so deep links don't hit the fail-whale.
export async function gotoPath(page, pathOrUrl, { base = BASE, ready } = {}) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${base}${pathOrUrl}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await waitForReady(page, ready)
}

// Cluster-explorer path for a resource, e.g. explorerPath('cert-manager.io.certificate')
// → /dashboard/c/local/explorer/cert-manager.io.certificate
export function explorerPath(resource, cluster = 'local') {
  return `/dashboard/c/${cluster}/explorer/${resource}`
}
