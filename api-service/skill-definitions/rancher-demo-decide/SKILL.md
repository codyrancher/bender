---
name: rancher-demo-decide
description: Decide whether a screenshot or a video best demonstrates a reproduction/fix, and record the choice for the downstream recording stages. Use after the issue is reproduced.
---

Choose the demonstration medium that most clearly conveys both the bug and, later, the fix.

## Heuristic

- **Screenshot** when the issue is static/visual: layout, styling, a wrong value, an error banner, a single-state difference. Cheaper and clearer for "this looks wrong."
- **Video** when the issue is behavioral/temporal: an interaction sequence, navigation, async/loading, animation, a multi-step flow — anything that only manifests over time.

## Output

Write the decision to `/workspace/demo-medium.txt` containing exactly `screenshot` or `video`, and add a one-line rationale to `/workspace/repro-notes.md`.

The downstream `rancher-screenshot-record` and `rancher-video-record` stages each read this file and only produce output when their medium is the selected one; the other is a no-op.
