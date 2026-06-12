---
name: rancher-pr-create
description: Push and open a draft PR upstream to rancher/dashboard following the rancher PR template, embedding the recorded before/after demonstration via the browser sidecar. Use as the final step once committed.
---

Open a polished **draft** pull request upstream to rancher/dashboard. The fix is already committed on a branch by the commit stage — this stage pushes it, uploads the recorded media so it embeds inline, and fills out the rancher PR template.

## 0. Issue number + branch

Derive the issue number from `$ISSUE_URL` (or the project name's trailing `-issue-<N>` / `-pr-<N>` token), and push the current fix branch to origin:

```bash
N="$(basename "${ISSUE_URL:-$HARNESS_PROJECT}" | grep -oE '[0-9]+' | tail -1)"
BR="$(git rev-parse --abbrev-ref HEAD)"   # the commit stage named it e.g. issue-$N
git push -u origin "$BR"
```

## 1. Upload the before/after media so it embeds inline

GitHub renders an inline `<video>`/image player **only** for files uploaded as
`user-attachments`, and that upload needs a logged-in GitHub **browser session** —
a PAT, OAuth token, or HTTP proxy cannot do it. The browser sidecar carries the
synced session, so upload through it with the bundled script:

```bash
wait-for-sidecars browser
node .claude/skills/rancher-pr-create/upload-github-assets.mjs \
  "${ISSUE_URL:-https://github.com/rancher/dashboard/issues/$N}" \
  /workspace/videos/before-fix.webm \
  /workspace/videos/after-fix.webm \
  /workspace/screenshots/*.png
```

It drives the sidecar browser (Playwright + CDP) to drag-drop each file onto a
GitHub comment form and prints one `filename<TAB>https://github.com/user-attachments/assets/<uuid>`
line per file. Build the `### Screenshot/Video` section from those URLs:

- **video (`.webm`)** — put the bare `user-attachments` URL on its **own line**; GitHub auto-renders it as a `<video>` player. Do not wrap it in markdown.
- **image (`.png`)** — use markdown image syntax: `![before](<url>)`.

Only reference files that actually exist — `ls /workspace/videos /workspace/screenshots` first. Pair before/after so a reviewer can see the change.

### If the sidecar / GitHub session is unavailable

Don't block the PR. Fall back to placeholder markers and tell the user to
drag-drop manually:

```markdown
### Screenshot/Video

<!-- TODO(manual upload): browser sidecar / GitHub session was unavailable; drag-drop each file into this section. -->
- Before fix: `/workspace/videos/before-fix.webm`
- After fix: `/workspace/videos/after-fix.webm`
- Screenshots: `/workspace/screenshots/*.png`
```

List only files that exist. If the upload returns an unexpected response, save the
raw error text and surface it rather than guessing — the upload protocol is
undocumented and changes.

## 2. Open the draft PR

Fill the template below as concisely as possible from the branch diff vs `master`
(`git diff master --stat` / `git log master..HEAD`), write it to a file, and create
the PR as a **draft** — never mark it ready; the user does that after reviewing:

```bash
gh pr create --repo rancher/dashboard --draft --base master \
  --title "<concise title>" --body-file /workspace/pr-body.md
```

When linking code in the body, use **absolute, commit-pinned** GitHub URLs
(`https://github.com/rancher/dashboard/blob/<sha>/<path>#Lxx`) — never relative or
branch-name URLs (they rot as the branch advances). Get the SHA with
`gh api repos/rancher/dashboard/commits/<branch> --jq .sha`.

### The rancher/dashboard PR template

```
### Summary
Fixes #<N>

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
- [] The PR has automated tests or clear instructions for manual tests and the linked issue has appropriate QA labels, or tests are not needed
- [] The PR has reviewed with UX and tested in light and dark mode, or there are no UX changes
- [] The PR has been reviewed in terms of Accessibility
- [] The PR has considered, and if applicable tested with, the three Global Roles `Admin`, `Standard User` and `User Base`
```

Fill `### Summary` with `Fixes #<N>`, and the prose sections from the actual change. Leave the checklist boxes unchecked for the user.

## Last-resort media fallback (only if asked, and the browser session is truly unavailable)

`user-attachments` is the only path that gives an inline **video** player. If you
genuinely cannot use it, host **animated WebP** (GitHub's sanitizer strips
`<video>` for non-attachment hosts, but renders WebP via markdown image syntax) on
a prerelease of the fork:

```bash
# 1. webm → animated WebP (smaller than GIF; drop fps/scale if >1 MB)
ffmpeg -y -i /workspace/videos/before-fix.webm -vf 'fps=15,scale=960:-2:flags=lanczos' \
  -c:v libwebp -loop 0 -q:v 75 /workspace/videos/before-fix.webp

# 2. Upload to a prerelease on the fork (gh release upload <tag> <file>… if it exists)
gh release create issue-$N-artifacts --repo <fork> --prerelease \
  --title "Issue $N artifacts" --notes "Artifacts for PR" \
  /workspace/videos/*.webp /workspace/screenshots/*.png

# 3. Reference via markdown image syntax — GitHub renders animated WebP inline:
# ![before](https://github.com/<fork>/releases/download/issue-$N-artifacts/before-fix.webp)
```
