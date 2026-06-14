# Rancher Issue Fix & Demo

This project runs as a staged pipeline (see `pipeline.yaml`). Each stage is driven by
its own skill in `.claude/skills/`:

reproduce -> decide demo medium -> record before (screenshot or video) -> fix ->
verify -> ensure tests -> record after -> commit -> open PR
(`rancher-issue-reproduce`, `rancher-demo-decide`, `rancher-screenshot-record`,
`rancher-video-record`, `rancher-fix-create`, `rancher-fix-verify`,
`rancher-tests-ensure`, `rancher-demo-record`, `rancher-commit-create`,
`rancher-pr-create`).

This file is the shared context for every stage. The per-stage skill is the playbook
for the work itself, so follow the active stage's skill and don't run ahead into later
stages. Do not duplicate skill content here.

# Rancher instance

- Environment variables are in `.env`.
- **Stock Rancher** - `https://$RANCHER_HOST_NAME` (also reachable at `https://localhost:8443`).
- Admin credentials: `$RANCHER_ADMIN_USER` / `$RANCHER_ADMIN_PASS`.

# Two URLs: stock Rancher vs your dev server (read before driving the browser)

There are two different web endpoints in this project and they are NOT interchangeable.
Driving the wrong one is the most common way to waste a run, because your code changes
only exist in one of them.

- **Stock Rancher** - `https://$RANCHER_HOST_NAME` (also `https://localhost:8443`).
  The real Rancher server: the API backend AND the unmodified, upstream dashboard UI it
  ships with. It does NOT contain your local code changes. Use it to reproduce the
  original bug, to create supporting resources, and for any API calls.
- **Dev server** - `https://localhost:8005`. The dashboard built from `/workspace/dashboard`
  with your local changes, served by `yarn dev`. This is the ONLY place your fix is
  visible. Use it to verify a fix and to record/screenshot the after-fix state.

Important details about the dev server:
- It is **started automatically** by `init.sh` (`yarn dev`, background, logs at
  `/workspace/yarn-dev.log`), so the expensive cold compile usually runs during the early
  stages. Edits are picked up by incremental HMR. **Don't restart it** - a restart forces
  a slow cold rebuild. Check first: `curl -sk -o /dev/null -w '%{http_code}'
  https://localhost:8005` (200 = up). Only start it yourself if it isn't running
  (`pgrep -f "yarn dev"`). The `API` env var is already exported to the stock Rancher
  backend, so auth and API calls proxy there.
- `wait-for-sidecars` does NOT wait for it - it only checks CDP and the Rancher API.
  Before driving the browser against it, poll once (`until curl -sk -o /dev/null -w
  '%{http_code}' https://localhost:8005 | grep -q 200; do sleep 3; done`) so HMR has
  finished recompiling your change.
- Log in on the dev server with the same admin credentials above.

Rule of thumb: reproduce + setup -> stock Rancher; verify the fix + after-fix media ->
dev server (8005).
{{#if issueNumber}}

# Issue

This project targets https://github.com/rancher/dashboard/issues/{{issueNumber}}
{{/if}}

# Files the stages hand off through

The stages communicate through files in `/workspace`. Read what earlier stages wrote and
put your output where later stages expect it:

- `/workspace/dashboard` - the rancher/dashboard source. Your fix and its tests go here.
- `/workspace/repro-notes.md` - running log: trigger steps, expected vs actual, the
  demo-medium rationale, and artifact paths.
- `/workspace/demo-medium.txt` - one word, `screenshot` or `video` (chosen by
  `rancher-demo-decide`). The two record stages no-op unless it matches.
- `/workspace/repro.mjs` - the Playwright reproduction script (default export
  `async ({ page, startRecording }) => ...`). Replayed to verify the fix and to record
  the after-fix demo, so reuse it rather than re-deriving navigation.
- `/workspace/screenshots/`, `/workspace/videos/` - before/after media. `before-*` is
  captured against stock Rancher; `after-*` against the dev server.
- `$STAGE_ARTIFACTS` - per-stage output dir. Only files written here are collected as
  that stage's artifacts.

# Browser and sidecars

- Before driving the browser or hitting Rancher, run `wait-for-sidecars` (see
  `.claude/rules/sidecars.md`). Skipping it means DNS errors and empty captures.
- Browser control is `/workspace/browser.mjs` over CDP (see `.claude/rules/browser-control.md`).
  Reusable login / navigation / recording / before-after comparison scripts live in
  `.claude/skills/rancher-browser-automate/` - compose those instead of reinventing them.
- Golden rule: wait for real state (an element visible, a URL change, a spinner gone),
  never fixed sleeps. Run scripts in the foreground - the script's output is the result;
  never background-and-sleep.

# Conventions

- Branch `issue-$(issueNumber)`; commits are concise, follow rancher/dashboard style, and
  carry no `Co-Authored-By` / AI mention. PRs open as **draft** with the before/after media
  embedded inline.
- GitHub links use absolute, commit-pinned URLs (see `.claude/rules/github-links.md`).
- Time-budgeted: don't gold-plate (extra captures, re-verification, restarting `yarn dev`).
  Over-working a stage is the main cause of timeouts.

# Writing style

- Never use em dashes in any output: code, comments, commit messages, PR descriptions, or
  chat replies. Use a regular dash, parentheses, or split the sentence instead.
