---
name: rancher-browser-automate
description: Reusable, composable browser-automation scripts for driving the Rancher dashboard (log in as admin, go to the cluster explorer, navigate + wait for a view to render, screenshot). Library skill — other stage skills reuse these instead of re-deriving navigation. Not a pipeline stage.
---

A small library of **composable browser-automation scripts** so stage skills don't
re-derive login/navigation by hand (that hand-rolling is what makes stages flail
and time out). This skill is materialized into every workspace at
`.claude/skills/rancher-browser-automate/` even though it's not a pipeline stage.

## Golden rule: wait for state, never for the clock

Every action waits on **real state** — an element becoming visible, the loading
spinner clearing, the URL changing — **never** a fixed `waitForTimeout` sleep.
Fixed sleeps are flaky (too short → race, too long → wasted budget). When you
know an element that proves a view is ready (a form, a drawer, a resource
header), pass it as the `ready-selector` so the action waits for exactly that.

## The actions (compose them — CDP state persists across calls)

Run them in the **foreground** (their stdout is the result; never background +
`sleep N && cat`). Each operates on the same persistent browser tab, so they
chain:

```bash
A=.claude/skills/rancher-browser-automate

# 1) Log in as admin (idempotent). Default base = dev server (:8005);
#    pass https://$RANCHER_HOST_NAME for the stock instance.
node $A/login.mjs https://localhost:8005

# 2) Go to the local-cluster explorer for a resource, wait until it renders.
node $A/explorer.mjs cert-manager.io.certificate local '.masthead'

# …or navigate to any path / full URL and wait for a ready element:
node $A/goto.mjs /dashboard/c/local/explorer/cert-manager.io.certificate/create 'form#cru'

# 3) Wait for the current view to be ready (content + spinner-gone [+ selector]).
node $A/wait-ready.mjs '.explain-drawer'

# 4) Screenshot the current view (waits for ready first).
node $A/screenshot.mjs "$STAGE_ARTIFACTS/after-fix.png" '.explain-drawer'
```

## Importing the primitives directly

For richer scripts (e.g. recording), import the functions instead of shelling out:

```js
import { connect, disconnect, loginAsAdmin, gotoPath, explorerPath, waitForReady }
  from './lib.mjs'  // same dir; or a file:// URL from elsewhere

const c = await connect()
await loginAsAdmin(c.page)                                  // base via $RANCHER_BASE/$DEV_SERVER
await gotoPath(c.page, explorerPath('cert-manager.io.certificate'), { ready: '.masthead' })
await c.page.screenshot({ path: process.env.STAGE_ARTIFACTS + '/after.png', fullPage: true })
await disconnect(c)
```

## Recording (video demos)

Two scripts live here for recording smooth browser videos (used by the demo
stages):

- `overlay.mjs` — the on-screen overlay engine: URL bar, cursor dot, click
  ripples, keystroke badges, red highlight rectangles, narrative banners.
- `record-template.mjs` — a self-contained recorder built on `overlay.mjs`. It
  polls screenshots (survives SPA navs / backend restarts) and exposes
  `highlight()`, `banner()`, `smoothMove()`, `smoothType()`, and a `recording`
  flag to pause capture during off-camera transitions.

Two ways to record:

```bash
# Simple: replay a Playwright repro script via browser.mjs (deferred capture).
node /workspace/browser.mjs record-script /workspace/repro.mjs "$STAGE_ARTIFACTS/before-fix.webm"

# Rich: copy the template + overlay next to your video and edit the actions.
A=.claude/skills/rancher-browser-automate
cp $A/record-template.mjs /workspace/videos/record-demo.mjs
cp $A/overlay.mjs         /workspace/videos/overlay.mjs
# edit RANCHER, OUT, and the "Recorded actions" section, then:
node /workspace/videos/record-demo.mjs
```

Note on timing: the fixed pauses inside a recording (cursor settle, viewer
beats) are **deliberate pacing**, not the flaky state-waits the golden rule
forbids — keep those. The off-camera login/navigation should still wait on state
(reuse `loginAsAdmin` / `waitForReady` from `./lib.mjs`).

## Conventions

- **Base URL:** `$RANCHER_BASE` or `$DEV_SERVER` (default `https://localhost:8005`, the
  dev server where a fix is visible). Pass `https://$RANCHER_HOST_NAME` for stock.
- **Admin password:** `$RANCHER_ADMIN_PASS` (falls back to `$CATTLE_BOOTSTRAP_PASSWORD`).
- **CDP:** `$CLAUDE_BROWSER_CDP` (default `http://localhost:9222`).
- The browser sidecar must be up first: `wait-for-sidecars browser`.
