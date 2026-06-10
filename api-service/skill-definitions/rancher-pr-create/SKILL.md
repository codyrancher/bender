---
name: rancher-pr-create
description: Push and open a draft PR upstream to rancher/dashboard following the rancher PR template, embedding the recorded before/after demonstration via the browser sidecar. Use as the final step once committed.
---

- Push the `issue-$(issueNumber)` branch to origin.
- Fill the rancher PR template and link the issue with `Fixes #$(issueNumber)`.
- Build the `### Screenshot/Video` section by uploading each recorded artifact (before-fix and after-fix) to GitHub `user-attachments` through the **browser sidecar** (Playwright + CDP) so they embed inline — the sidecar has authenticated GitHub session cookies; OAuth tokens and HTTP proxies cannot do user-attachments uploads.
  1. `wait-for-sidecars browser`
  2. Connect via CDP, open the issue page for CSRF context, read each file, upload through the browser's authenticated `fetch()`, and collect the returned asset URLs.
  3. If the sidecar is unavailable, fall back to placeholder markers noting the local artifact paths.
- Open the PR as a **draft**. Use absolute, commit-pinned GitHub URLs when linking code.
