---
name: my-pr-create
description: Push and create a draft pull request upstream to rancher/dashboard following the rancher PR template. Uploads recorded videos and screenshots to GitHub user-attachments via the browser sidecar (Playwright + CDP) so they embed inline; falls back to placeholder markers if the sidecar is unavailable. Use when a fix is committed and ready for review.
---

- Make a new branch with the changes named `issue-$(issueNumber)`.
- Push the changes to origin.
- Build the `### Screenshot/Video` section by uploading each recorded file to GitHub's `user-attachments` CDN through the **browser sidecar**. The sidecar has synced GitHub session cookies, so the upload's CSRF flow works correctly (HTTP proxies cannot reliably handle this). OAuth tokens cannot do user-attachments uploads either.

  1. Ensure the browser sidecar is running: `wait-for-sidecars browser`

  2. Write a Playwright upload script that connects to the browser via CDP, opens the issue page (for CSRF context), reads each file from the local filesystem, and uploads it through the browser's authenticated `fetch()`:

     ```js
     // /workspace/upload-github-assets.mjs
     import { chromium } from 'playwright-core'
     import { readFileSync } from 'node:fs'
     import { basename } from 'node:path'

     const CDP = process.env.CLAUDE_BROWSER_CDP || 'http://localhost:9222'
     const issueUrl = process.argv[2]
     const filePaths = process.argv.slice(3)

     const browser = await chromium.connectOverCDP(CDP)
     const ctx = browser.contexts()[0] || await browser.newContext()
     const page = await ctx.newPage()

     try {
       await page.goto(issueUrl, { waitUntil: 'domcontentloaded' })

       for (const fp of filePaths) {
         const data = readFileSync(fp)
         const b64 = data.toString('base64')
         const name = basename(fp)
         const ct = name.endsWith('.webm') ? 'video/webm'
           : name.endsWith('.png') ? 'image/png'
           : 'application/octet-stream'

         const href = await page.evaluate(async ({ b64, name, ct }) => {
           const token = document.querySelector('input[name="authenticity_token"]')?.value
             || document.querySelector('meta[name="csrf-token"]')?.content
           const repoMeta = document.querySelector('[data-repo-id]')
             || document.querySelector('meta[name="octolytics-dimension-repository_id"]')
           const repoId = repoMeta?.content || repoMeta?.dataset?.repoId

           const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))

           const polResp = await fetch('/upload/policies/assets', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
               name, size: bytes.length, content_type: ct,
               repository_id: repoId, authenticity_token: token,
             }),
           })
           if (!polResp.ok) throw new Error(`policy ${polResp.status}: ${await polResp.text()}`)
           const pol = await polResp.json()

           const form = new FormData()
           for (const [k, v] of Object.entries(pol.form)) form.append(k, String(v))
           form.append('file', new Blob([bytes], { type: ct }), name)
           const upResp = await fetch(pol.upload_url, { method: 'POST', body: form, mode: 'cors' })
           if (!upResp.ok) throw new Error(`upload ${upResp.status}`)

           return pol.asset.href
         }, { b64, name, ct })

         console.log(`${name}\t${href}`)
       }
     } finally {
       await page.close()
       await browser.close()
     }
     ```

  3. Run it:
     ```bash
     node /workspace/upload-github-assets.mjs \
       "https://github.com/rancher/dashboard/issues/$(issueNumber)" \
       /workspace/videos/before-fix.webm \
       /workspace/videos/after-fix.webm
     ```

  4. Parse the tab-separated output — each line is `filename\thref`. Place the href URLs in the `### Screenshot/Video` section. Use markdown image syntax for `.png` files and a bare URL on its own line for `.webm` files — GitHub auto-renders bare `user-attachments` URLs as `<video>` players.

  If you hit unexpected responses, save the raw error text and surface it to the user rather than guessing — the upload protocol is undocumented and changes.

  If the browser sidecar isn't running (or cookies aren't synced), fall back to placeholder markers and tell the user to drag-drop manually:
  ```markdown
  ### Screenshot/Video

  <!-- TODO(manual upload): browser sidecar was unavailable; drag-drop each file into this section. -->
  - Before fix: `/workspace/videos/before-fix.webm`
  - After fix: `/workspace/videos/after-fix.webm`
  - Screenshots: `/workspace/screenshots/*.png`
  ```

  List only files that actually exist.

- Create a **draft** PR in upstream (rancher/dashboard) using `gh pr create --draft`. Do not mark it ready for review; the user marks it ready themselves once they've reviewed the description.
- Fill out the PR template as concisely as possible based on the changes in our branch vs master.

- **Last-resort fallback (only if the user explicitly asks for it and the proxy isn't available)**: media can be hosted on the fork's releases and embedded with markdown image syntax. Videos must be converted to animated WebP first because GitHub's sanitizer strips `<video>` tags that don't point at `user-attachments`.

  ```bash
  # 1. webm to animated WebP (~50 to 70% smaller than GIF at the same quality; drop fps to 10 or scale to 720 if >1 MB)
  ffmpeg -y -i /workspace/videos/before-fix.webm \
    -vf 'fps=15,scale=960:-2:flags=lanczos' \
    -c:v libwebp -loop 0 -q:v 75 \
    /workspace/videos/before-fix.webp

  # 2. Upload to a prerelease on the fork (idempotent, use `gh release upload <tag> <file>...` if the release already exists)
  gh release create issue-$(issueNumber)-artifacts --repo <fork> \
    --prerelease --title "Issue $(issueNumber) artifacts" --notes "Artifacts for PR" \
    /workspace/videos/*.webp /workspace/screenshots/*.png

  # 3. Reference via markdown image syntax in the PR body, GitHub renders animated WebP inline
  # ![before](https://github.com/<fork>/releases/download/issue-$(issueNumber)-artifacts/before-fix.webp)
  ```

- The PR description should follow this template:

```
### Summary
Fixes #$(issueNumber)

### Occurred changes and/or fixed issues


### Technical notes summary


### Areas or cases that should be tested


### Areas which could experience regressions


### Screenshot/Video

### Checklist
- [] The PR is linked to an issue and the linked issue has a Milestone, or no issue is needed
- [] The PR has a Milestone
- [] The PR template has been filled out
- [] The PR has been self reviewed
- [] The PR has a reviewer assigned
- [] The PR has automated tests or clear instructions for manual tests and the linked issue has appropriate QA labels,
or tests are not needed
- [] The PR has reviewed with UX and tested in light and dark mode, or there are no UX changes
- [] The PR has been reviewed in terms of Accessibility
- [] The PR has considered, and if applicable tested with, the three Global Roles `Admin`, `Standard User` and `User
Base`

```
