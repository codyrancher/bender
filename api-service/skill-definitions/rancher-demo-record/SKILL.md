---
name: rancher-demo-record
description: Record the post-fix demonstration (screenshot or video, matching the medium chosen earlier) showing the issue is resolved. Use after tests pass.
---

Produce the "after" demonstration that highlights the issue is fixed, using the same medium chosen in `rancher-demo-decide`. This stage has a time budget — **reuse what earlier stages already produced and conclude as soon as you have one clean after-fix artifact.** Re-deriving navigation from scratch is what makes this stage time out.

## 0. If an after-fix artifact already exists, just adopt it

Before doing anything, check whether the before/verify stages already captured a usable after-fix artifact:

```bash
ls "$STAGE_ARTIFACTS"/ 2>/dev/null
ls /workspace/.artifacts/stage-*/after-fix.* /workspace/screenshots/after-fix.* /workspace/videos/after-fix.* 2>/dev/null
```

If a good after-fix screenshot/video already exists, **copy it into `$STAGE_ARTIFACTS` and stop** — print the `STAGE_RESULT:` line immediately. Do not re-capture for polish.

## Otherwise — reuse the recorded reproduction against the dev server

The fix is visible **only** on the dev server `https://localhost:8005`. It is already started and pre-warmed by `init.sh` — **do not restart `yarn dev`** (a restart forces a slow cold recompile). Just confirm it serves, once:

```bash
until curl -sk -o /dev/null -w '%{http_code}' https://localhost:8005 | grep -q 200; do sleep 3; done
```

Then record the after artifact in the **same context** as the before artifact, reusing the saved reproduction rather than improvising:

- **video** — re-run the saved `/workspace/repro.mjs` against the dev server and record to `$STAGE_ARTIFACTS/after-fix.webm`:
  ```bash
  node /workspace/browser.mjs record-script /workspace/repro.mjs "$STAGE_ARTIFACTS/after-fix.webm"
  ```
  If `repro.mjs` hard-codes the stock host, re-point its base URL at `https://localhost:8005` first.

- **screenshot** — compose the reusable `rancher-browser-automate` (they log in, wait for the SPA to hydrate **before** deep-linking — deep-linking a cold shell is what produces the fail-whale / 404 / "Reload" page — and wait for the view to render with no fixed sleeps). Use the same dashboard path the before-fix step used (in `/workspace/repro-notes.md`), and pass a `ready-selector` that only appears once the target view is up:
  ```bash
  A=.claude/skills/rancher-browser-automate
  node $A/login.mjs https://localhost:8005
  node $A/goto.mjs "<dashboard-path-from-repro-notes>" "<ready-selector>"
  node $A/screenshot.mjs "$STAGE_ARTIFACTS/after-fix.png" "<ready-selector>"
  ```
  (Admin password comes from `$RANCHER_ADMIN_PASS` / `$CATTLE_BOOTSTRAP_PASSWORD`; if unset, look it up in `CLAUDE.md` / `/workspace/.env` and `export RANCHER_ADMIN_PASS=…` first. See `.claude/skills/rancher-browser-automate/SKILL.md` for `explorer.mjs` and the rest.)

## Rules that keep this fast and reliable

- **Run scripts in the FOREGROUND.** Never `sleep N && cat <file>` to poll a backgrounded script — the harness blocks that and you waste the budget. Run the helper/repro directly; its output is the result.
- **One bounded attempt, then conclude.** If the first capture is clean, you are done. If the dev server is briefly flaky, retry the helper at most twice; if it still won't render the deep view, capture the best available state, note it, and conclude — do not loop writing new ad-hoc scripts.
- **Don't re-explore.** The exact navigation/login is already encoded in `/workspace/repro.mjs`, `/workspace/repro-notes.md`, and the helper. Reuse them; don't reinvent the flow.
- **Save into `$STAGE_ARTIFACTS`** (not `/workspace/screenshots` or another stage's dir) — only files there are collected as this stage's artifacts.

## Finish

The after artifact should clearly show the corrected behavior. Note its path in `/workspace/repro-notes.md` for the PR stage to embed, then print the `STAGE_RESULT:` line and stop.
