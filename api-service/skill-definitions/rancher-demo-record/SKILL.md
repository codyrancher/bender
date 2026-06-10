---
name: rancher-demo-record
description: Record the post-fix demonstration (screenshot or video, matching the medium chosen earlier) showing the issue is resolved. Use after tests pass.
---

Produce the "after" demonstration that highlights the issue is fixed, using the same medium chosen in `rancher-demo-decide`.

## Steps

1. Read `/workspace/demo-medium.txt`.
2. Record the after artifact in the same context as the before artifact:
   - **video** — re-run the saved `/workspace/repro.mjs` against the fixed UI and record to `/workspace/videos/after-fix.webm` via `browser.mjs record-script`.
   - **screenshot** — re-capture the same view to `/workspace/screenshots/after-fix.png`; prefer a labeled before/after via `my-browser-screenshot-comparison` (master vs the fix branch).
3. The after artifact should clearly show the corrected behavior.
4. Note the artifact path(s) in `/workspace/repro-notes.md` for the PR stage to embed.
