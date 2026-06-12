---
name: rancher-video-record
description: Record a smooth browser video demonstrating the reproduction against this project's Rancher instance, when video was the chosen demonstration medium. No-op when screenshot was selected.
---

Record an uninterrupted video of the bug using the iterate → script → record workflow (see `record-browser-video`).

## Browser control

Drive the browser with `/workspace/browser.mjs` — it ships every common control verb
(`goto`, `click`, `type`, `fill`, `press`, `select`, `wait`, `wait-text`, `scroll`,
`reload`, `back`/`forward`, `screenshot`, `text`, `html`, `eval`, `tabs`). Run
`node /workspace/browser.mjs` with no args to print the full usage. CDP state persists
across calls, so you can drive the UI one command at a time while iterating.

## Steps

1. Read `/workspace/demo-medium.txt`. If it is not `video`, log `medium=screenshot, skipping` and exit successfully.
2. Ensure the browser is up: `wait-for-sidecars browser`.
3. Capture the reproduction as a Playwright script `/workspace/repro.mjs` that default-exports `async ({ page, startRecording }) => …`. Pin the viewport to 1280x720 and call `startRecording()` right before the first visible action so the page load stays out of the video.
4. Record it:
   ```bash
   node /workspace/browser.mjs record-script /workspace/repro.mjs /workspace/videos/before-fix.webm
   ```
5. Keep the script next to the video under `/workspace/videos/` — it is the source of truth and gets replayed to record the fixed demonstration later.

## Advanced recorder (banners, highlights, pause/resume)

For richer demos than `record-script` produces, use the recorder bundled in the
`rancher-browser-automate` library skill (`record-template.mjs` + `overlay.mjs`):
on-screen URL bar, cursor dot, click ripples, keystroke badges, `highlight()`,
`banner()`, `smoothMove()`, `smoothType()`, and a `recording` flag to pause
capture during off-camera transitions.

Copy both next to your video and edit the "Recorded actions" section:

```bash
A=.claude/skills/rancher-browser-automate
cp $A/record-template.mjs /workspace/videos/record-demo.mjs
cp $A/overlay.mjs         /workspace/videos/overlay.mjs
# edit RANCHER, OUT, and the actions, then:
node /workspace/videos/record-demo.mjs
```
