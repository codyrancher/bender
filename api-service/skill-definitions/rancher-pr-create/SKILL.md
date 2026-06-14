---
name: rancher-pr-create
description: Push and open a draft PR upstream to rancher/dashboard following the rancher PR template, embedding the recorded before/after demonstration (media hosted as gh release assets on your fork). Use as the final step once committed.
---

Open a polished **draft** pull request upstream to rancher/dashboard. The fix is already committed on a branch by the commit stage — this stage pushes it, uploads the recorded media so it embeds inline, and fills out the rancher PR template.

## 0. Issue number + branch

Derive the issue number from `$ISSUE_URL` (or the project name's trailing `-issue-<N>` / `-pr-<N>` token), and push the current fix branch to origin:

```bash
N="$(basename "${ISSUE_URL:-$HARNESS_PROJECT}" | grep -oE '[0-9]+' | tail -1)"
BR="$(git rev-parse --abbrev-ref HEAD)"   # the commit stage named it e.g. issue-$N
git push -u origin "$BR"
```

## 1. Upload the before/after media (via `gh`, hosted on a fork prerelease)

All GitHub interaction goes through `gh` (token auth). GitHub has no API/token path
for the inline-`<video>` `user-attachments` host, so host the media as **release
assets on your fork** and reference them in the PR body. Images render inline from
any URL; for videos, embed the first frame as a clickable thumbnail that links to
the `.webm`.

```bash
FORK="$(gh repo view --json nameWithOwner -q .nameWithOwner)"   # the fork you pushed to (origin)
TAG="issue-$N-artifacts"
ls /workspace/videos /workspace/screenshots 2>/dev/null          # only reference files that exist

# First-frame poster for each video, so the PR shows a clickable thumbnail.
for v in /workspace/videos/*.webm; do
  [ -e "$v" ] || continue
  ffmpeg -y -i "$v" -frames:v 1 "${v%.webm}-poster.png"
done

# Upload to a prerelease on the fork (create it once; re-run uploads with --clobber).
ASSETS=(/workspace/videos/*.webm /workspace/videos/*-poster.png /workspace/screenshots/*.png)
gh release create "$TAG" --repo "$FORK" --prerelease --title "Issue $N artifacts" --notes "PR demo media" "${ASSETS[@]}" \
  || gh release upload "$TAG" --repo "$FORK" --clobber "${ASSETS[@]}"
```

Each asset is then at `https://github.com/<FORK>/releases/download/<TAG>/<filename>`.
Build the `### Screenshot/Video` section from those URLs:

- **screenshot (`.png`)** — markdown image: `![before](<png-url>)` / `![after](<png-url>)`.
- **video (`.webm`)** — clickable first-frame thumbnail linking to the file:
  `[![before](<poster-url>)](<webm-url>)` (the reviewer clicks to play/download).

Pair before/after so the change is obvious, and reference only files that exist —
omit a missing one rather than linking a 404. If `gh release` fails, surface the
error rather than guessing.

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

> Tip: if a reviewer needs an inline animated preview instead of a click-to-play
> thumbnail, convert the `.webm` to an animated WebP (`ffmpeg -i in.webm -vf
> 'fps=15,scale=960:-2:flags=lanczos' -c:v libwebp -loop 0 -q:v 75 out.webp`),
> upload it as another release asset, and embed it with `![demo](<webp-url>)` —
> GitHub renders animated WebP inline via markdown image syntax.
