---
name: rancher-fix-verify
description: Verify the fix resolves the reproduced issue by replaying the original demonstration against the dev server (the rebuilt dashboard that contains the change). Use after the fix is implemented.
---

Prove the fix works by re-running the exact reproduction against the dashboard that actually contains your change.

## Which endpoint to test (read this first)

Your fix lives in `/workspace/dashboard` and is **only** visible on the **dev server** at `https://localhost:8005`
(served by `yarn dev`). The **stock Rancher instance** (`https://$RANCHER_HOST_NAME`, a.k.a. `https://localhost:8443`)
serves the unmodified upstream UI and is the API backend - it does NOT contain your change. Verifying there will
show the old behavior and look like the fix failed. Always verify on `https://localhost:8005`.

## Steps

1. Start (or restart) the dev server so it picks up the change:
   `cd /workspace/dashboard && yarn dev` (the `API` env var is already exported to the stock Rancher backend).
2. Wait until the dev server is actually serving the compiled app before driving the browser.
   `wait-for-sidecars` is NOT enough - it only checks CDP and the Rancher API, not the dev server. Poll it:
   `until curl -sk -o /dev/null -w '%{http_code}' https://localhost:8005 | grep -q 200; do sleep 3; done`
   (the first compile takes a while).
3. Replay the original reproduction **against `https://localhost:8005`**:
   - **video repro** - re-run `/workspace/repro.mjs`; it should now reach the correct state without the bug.
   - **screenshot repro** - re-drive the same steps and confirm the faulty state no longer occurs.
   If the original repro script hard-codes `https://$RANCHER_HOST_NAME` (the stock instance), re-point it at
   `https://localhost:8005` so the fix is exercised.
4. Confirm behavior now matches the expected outcome documented in `/workspace/repro-notes.md`.
5. If the bug persists, go back to `rancher-fix-create` - do not proceed until the original demonstration passes
   cleanly on the dev server.

## Common pitfall

Driving `https://$RANCHER_HOST_NAME` / `https://localhost:8443` during verification tests the stock, unmodified
UI. The fix will appear to do nothing. If verification keeps failing, first confirm you are on `https://localhost:8005`
and that `yarn dev` finished compiling the change.
