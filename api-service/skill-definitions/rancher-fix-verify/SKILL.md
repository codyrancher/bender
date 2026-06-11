---
name: rancher-fix-verify
description: Verify the fix resolves the reproduced issue by replaying the original demonstration against the dev server (the rebuilt dashboard that contains the change). Use after the fix is implemented.
---

Prove the fix works by re-running the exact reproduction against the dashboard that actually contains your change. This stage has a time budget — get to a verdict fast and stop.

## Which endpoint to test (read this first)

Your fix lives in `/workspace/dashboard` and is **only** visible on the **dev server** at `https://localhost:8005`
(served by `yarn dev`). The **stock Rancher instance** (`https://$RANCHER_HOST_NAME`, a.k.a. `https://localhost:8443`)
serves the unmodified upstream UI and is the API backend - it does NOT contain your change. Verifying there will
show the old behavior and look like the fix failed. Always verify on `https://localhost:8005`.

## The dev server is already running — reuse it, don't restart it

`init.sh` starts `yarn dev` at container creation, so the expensive **cold** compile has almost certainly already
happened by the time this stage runs. When `rancher-fix-create` edited the code, that running server picked the
change up via **incremental HMR recompile** (seconds). So:

1. **Do not blind-restart `yarn dev`.** Restarting throws away the warm compile and forces a multi-minute cold
   rebuild — the main cause of this stage timing out. First check whether it's already serving:
   ```bash
   curl -sk -o /dev/null -w '%{http_code}' https://localhost:8005   # 200 → it's up, skip to step 3
   ```
2. **Only if it is NOT up** (connection refused, or no `yarn dev` in `pgrep -f "yarn dev"`), start it once and wait
   for the first compile, then continue:
   ```bash
   cd /workspace/dashboard && nohup yarn dev > /workspace/yarn-dev.log 2>&1 & disown
   until curl -sk -o /dev/null -w '%{http_code}' https://localhost:8005 | grep -q 200; do sleep 3; done
   ```
   (`wait-for-sidecars` does NOT cover the dev server — it only checks CDP and the Rancher API.)
3. **After the fix, give HMR a moment to settle.** The edit may still be recompiling. Poll once until it serves the
   updated app — a single bounded loop, then move on:
   ```bash
   until curl -sk -o /dev/null -w '%{http_code}' https://localhost:8005 | grep -q 200; do sleep 3; done
   ```

## Run the verification in the FOREGROUND — never `sleep N && cat`

The agent harness **blocks** `sleep 30 && cat <output>` and other "background-then-poll" patterns, which wastes the
whole budget. So drive the check **synchronously** and read its result directly:

- Re-run the reproduction script in the foreground so its own exit/output is the verdict — do not background it:
  ```bash
  cd /workspace && CLAUDE_BROWSER_CDP=http://localhost:9222 node /workspace/repro.mjs
  ```
- If you write an ad-hoc CDP snippet, make it `console.log` PASS/FAIL and run it directly with `node -e '...'` (no
  `&`, no separate `cat`). The script should connect, navigate, assert, print, and exit on its own.
- If the original repro hard-codes the stock instance (`https://$RANCHER_HOST_NAME` / `:8443`), re-point it at
  `https://localhost:8005` before running, so the fix is actually exercised.

## Decide and stop

- **video repro** - re-run `/workspace/repro.mjs` against `:8005`; it should now reach the correct state without
  the bug.
- **screenshot repro** - drive the same trigger steps once on `:8005` and confirm the faulty state is gone.
- Confirm behavior matches the expected outcome in `/workspace/repro-notes.md`.

As soon as you have one clean pass that shows the bug is gone, you are **done** — print the `STAGE_RESULT:` line
immediately. Do **not** record polished after-fix media here (the dedicated record stages own that), don't re-run
`yarn install`, don't reboot sidecars, and don't take extra confirmation passes. Over-verifying is what risks the
timeout.

If the bug persists, go back to `rancher-fix-create` — do not proceed until the original demonstration passes
cleanly on `:8005`. First double-check you really were on `:8005` (not `:8443`) and that HMR finished recompiling.
