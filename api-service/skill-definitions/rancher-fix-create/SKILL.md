---
name: rancher-fix-create
description: Implement a focused code fix for the reproduced rancher/dashboard issue in /workspace/dashboard. Use after the reproduction has been recorded.
---

Implement the smallest correct change that resolves the reproduced issue.

## Steps

1. Re-read `/workspace/repro-notes.md` and the issue to confirm the root cause.
2. Locate the responsible code in `/workspace/dashboard` and make a focused fix — match surrounding conventions and avoid unrelated churn.
3. Prefer fixing the cause over masking the symptom; keep the change well-scoped to this issue.
4. Leave the working tree ready to stage, but do **not** commit here — the commit stage owns the message/branch conventions.
