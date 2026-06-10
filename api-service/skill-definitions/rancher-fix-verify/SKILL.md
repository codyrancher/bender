---
name: rancher-fix-verify
description: Verify the fix resolves the reproduced issue by replaying the original demonstration steps against the rebuilt UI. Use after the fix is implemented.
---

Prove the fix works by re-running the exact reproduction captured earlier.

## Steps

1. Rebuild/serve the dashboard with the change applied, then `wait-for-sidecars`.
2. Replay the original reproduction:
   - **video repro** — re-run `/workspace/repro.mjs`; it should now reach the correct state without the bug.
   - **screenshot repro** — re-drive the same steps and confirm the faulty state no longer occurs.
3. Confirm behavior now matches the expected outcome documented in `/workspace/repro-notes.md`.
4. If the bug persists, go back to `rancher-fix-create` — do not proceed until the original demonstration passes cleanly.
