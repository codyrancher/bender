---
name: rancher-screenshot-record
description: Capture a screenshot demonstrating the reproduction against this project's Rancher instance, when screenshot was the chosen demonstration medium. No-op when video was selected.
---

Capture a still image that shows the bug.

## Steps

1. Read `/workspace/demo-medium.txt`. If it is not `screenshot`, log `medium=video, skipping` and exit successfully — this branch is a deliberate no-op when video was chosen.
2. Ensure the browser is up: `wait-for-sidecars browser`.
3. Replay the reproduction sequence to the faulty state, then capture:
   ```bash
   node /workspace/browser.mjs --new-tab goto https://{{projectName}}-rancher
   node /workspace/browser.mjs screenshot /workspace/screenshots/before-fix.png
   ```
4. For a labeled before/after later, use the comparison helper `.claude/skills/rancher-browser-automate/compare.mjs` (see the `rancher-browser-automate` skill) once the fix branch exists.
5. Save under `/workspace/screenshots/` and note the path in `/workspace/repro-notes.md`.
