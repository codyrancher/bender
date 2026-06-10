---
name: rancher-video-record
description: Record a smooth browser video demonstrating the reproduction against this project's Rancher instance, when video was the chosen demonstration medium. No-op when screenshot was selected.
---

Record an uninterrupted video of the bug using the iterate → script → record workflow (see `record-browser-video`).

## Steps

1. Read `/workspace/demo-medium.txt`. If it is not `video`, log `medium=screenshot, skipping` and exit successfully.
2. Ensure the browser is up: `wait-for-sidecars browser`.
3. Capture the reproduction as a Playwright script `/workspace/repro.mjs` that default-exports `async ({ page, startRecording }) => …`. Pin the viewport to 1280x720 and call `startRecording()` right before the first visible action so the page load stays out of the video.
4. Record it:
   ```bash
   node /workspace/browser.mjs record-script /workspace/repro.mjs /workspace/videos/before-fix.webm
   ```
5. Keep the script next to the video under `/workspace/videos/` — it is the source of truth and gets replayed to record the fixed demonstration later.
