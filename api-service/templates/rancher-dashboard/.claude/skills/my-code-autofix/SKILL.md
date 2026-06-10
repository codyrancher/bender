---
name: my-code-autofix
description: Kick off the unattended auto-fix loop on a Claude Harness project from this global session. Waits for init.sh to finish, then runs `claude --dangerously-skip-permissions` inside the project container with the right prompt for an issue (fix + commit) or PR (review, pending comments only). Use whenever a project's `init.sh` ran but `.auto-fix-fired` / `.auto-review-fired` was never created (regression in the May 24 harness-api rebuild), or whenever you need to re-fire after fixing an upstream failure (yarn install died, sidecars weren't ready, etc.).
---

The harness-api rebuild on 2026-05-24 dropped the auto-fix/auto-review wiring that used to live in `init.sh.hbs`, so I have to fire it manually from the global session every time a project is created. This skill is that fire procedure, codified.

## Inputs

Always required: **project name** (e.g. `auth-pass-change-signin-issue-15461`, `chart-buttons-pr-17120`).

Derived from the project name (do not ask the user):

- **Issue or PR number** — last `-issue-<N>` or `-pr-<N>` token. If neither matches, abort and ask the user what the project is for.
- **Mode**:
  - `pr-<N>` in name → **review mode**: run my-pr-review, leave pending inline comments only, do not submit.
  - `issue-<N>` in name → **fix mode**: solve the issue, then my-commit-create on a new branch named `issue-<N>`. Do not open a PR.

## Procedure

1. **Sanity-check the project container is up.**

   ```bash
   docker ps --format '{{.Names}}' | grep "^claude-harness-<project>-1$"
   ```

   If missing, start it with `POST $CLAUDE_HARNESS_API/projects/<project>/start` and wait. If even that fails, surface the error and stop — no point firing the agent into a dead container.

2. **Check whether the marker already exists** so a re-run is intentional, not a duplicate fire:

   ```bash
   docker exec claude-harness-<project>-1 ls /workspace/.auto-fix-fired /workspace/.auto-review-fired 2>/dev/null
   ```

   If present, ask the user whether to force-rerun (delete the marker first) or skip.

3. **Fire the wrapper in the background.** It waits for `/workspace/.init-done` (up to 60min), touches the marker, then runs `claude --dangerously-skip-permissions -p "<prompt>"` from inside `/workspace/dashboard`. All output streams into `/workspace/.auto-run.out`; the per-project tailer streams the agent's own transcript into `/workspace/auto.logs`.

   **Fix mode (issue)**:

   ```bash
   docker exec -u 1000:1000 -d claude-harness-<project>-1 bash -lc '
     for i in $(seq 1 720); do
       if [ -f /workspace/.init-done ]; then break; fi
       sleep 5
     done
     if [ ! -f /workspace/.init-done ]; then
       echo "FATAL: init never completed" > /workspace/.auto-run.out
       exit 1
     fi
     if [ -f /workspace/.auto-fix-fired ]; then
       echo "auto-fix already fired previously, skipping" >> /workspace/.auto-run.out
       exit 0
     fi
     touch /workspace/.auto-fix-fired
     cd /workspace/dashboard
     claude --dangerously-skip-permissions \
       -p "Follow the Fix Issue section of /workspace/CLAUDE.md. When the fix is complete, stage the changes and follow the my-commit-create skill to produce one commit on a new branch named issue-<N>. Do not open a PR." \
       >> /workspace/.auto-run.out 2>&1
   '
   ```

   **Review mode (PR)**:

   ```bash
   docker exec -u 1000:1000 -d claude-harness-<project>-1 bash -lc '
     for i in $(seq 1 720); do
       if [ -f /workspace/.init-done ]; then break; fi
       sleep 5
     done
     if [ ! -f /workspace/.init-done ]; then
       echo "FATAL: init never completed" > /workspace/.auto-run.out
       exit 1
     fi
     if [ -f /workspace/.auto-review-fired ]; then
       echo "auto-review already fired previously, skipping" >> /workspace/.auto-run.out
       exit 0
     fi
     touch /workspace/.auto-review-fired
     cd /workspace/dashboard
     claude --dangerously-skip-permissions \
       -p "Follow the Review PR section of /workspace/CLAUDE.md. Use the my-pr-review skill to leave pending inline comments, then run the audit pass. Do not submit the review — leave it in PENDING for the user." \
       >> /workspace/.auto-run.out 2>&1
   '
   ```

4. **Tell the user it's queued and where to watch.** One line each:

   - "Auto-fix queued for `<project>` (issue #<N>) — fires once init.sh finishes (~5 min for a fresh project)."
   - "Watch live: `tail -f /data/projects/<project>/auto.logs`"

   For PR projects, add: "Review sits in PENDING when complete — user submits/discards from Files Changed."

## Re-firing on an existing project

When the user asks you to re-run on a project that already has `.auto-fix-fired` (e.g. the first attempt died because yarn install failed, or you just patched a template bug and want to retry):

1. Delete the marker: `docker exec claude-harness-<project>-1 rm -f /workspace/.auto-fix-fired /workspace/.auto-run.out`.
2. If the failure was in init.sh itself (yarn install, dashboard clone, etc.), check whether init needs to re-run — `/workspace/.init-done` may be missing. If so, fix the underlying issue manually (e.g. delete corrupt `node_modules`, rerun `yarn install` by hand), then `touch /workspace/.init-done` so the wrapper proceeds.
3. Fire as above.

## What this skill does NOT do

- **Doesn't start sidecars.** Auto-fix often runs before sidecars are needed (the agent will fire them itself via `wait-for-sidecars` when it gets to the repro). If the user explicitly wants sidecars up first, run `POST $CLAUDE_HARNESS_API/sidecars/start/<project>` separately.
- **Doesn't create the project.** Project creation is a separate workflow (see global CLAUDE.md "Creating a Rancher project from a GitHub issue URL"). This skill assumes the container already exists.
- **Doesn't open a PR.** Fix mode commits and pushes a branch, full stop. The user opens the PR (or runs `my-pr-create` later) when ready.
- **Doesn't submit the PR review.** Review mode leaves comments PENDING by design.

## Why the markers exist

`.auto-fix-fired` / `.auto-review-fired` exist so the wrapper is idempotent under container restart. Without them, every time the project container restarts (host reboot, `docker restart`, etc.) the agent would re-fire and produce duplicate commits / duplicate review passes. Don't delete them unless you actually want a re-run.
