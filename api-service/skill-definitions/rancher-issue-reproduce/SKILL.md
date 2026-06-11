---
name: rancher-issue-reproduce
description: Reproduce a rancher/dashboard issue against this project's live Rancher instance so the bug is observable and repeatable before any fix. Use as the first step of an issue-fix pipeline.
---

Reproduce the reported bug against the live Rancher instance so it is observable and repeatable before changing any code.

## Steps

1. Derive the issue number from the project name (the trailing `-issue-<N>` / `-pr-<N>` token) and read it: `gh issue view <N> -R rancher/dashboard`.
2. Boot the environment and wait until it answers: `wait-for-sidecars` (starts the browser + rancher sidecars and blocks until reachable).
3. Drive the UI to the exact state described in the issue using `node /workspace/browser.mjs --new-tab goto <url>` and ad-hoc `playwright-core` snippets against `https://{{projectName}}-rancher`.
4. Confirm the faulty behavior is present, and write down the precise click/input sequence that triggers it — this becomes the reproduction reused by the recording stages.
5. Record expected-vs-actual in `/workspace/repro-notes.md`.

Do **not** attempt a fix here. The only goal is a reliable, documented reproduction.

## Be efficient — conclude as soon as the bug is captured

This stage has a time budget. Once you have (a) the bug visibly reproduced and (b)
`repro-notes.md` with the exact trigger steps, you are **done** — immediately print
the `STAGE_RESULT:` line and stop.

- One clear "before" artifact is enough (a single screenshot, or one short video if
  the bug is behavioral). **Do not** keep taking extra/annotated screenshots, build
  comparison images, or polish — that's gold-plating and risks the stage timing out
  with no result recorded. The dedicated Record Screenshot / Record Video stages
  produce the demonstration artifacts; here you only need proof + notes.
- Don't restart sidecars or re-run long waits more than necessary.
