---
name: rancher-commit-create
description: Create a Rancher Dashboard commit on a new branch following project conventions (concise title, no AI co-author, Fixes #issue, branch issue-NNNNN). Use when the fix and tests are ready.
---

- Concise title stating what we did — base it on the staged changes, not the conversation history.
- Zero to two line summary if the title isn't sufficient.
- `Fixes #$(issueNumber)` (the runtime issue number for this project).
- Do **not** include any `Co-Authored-By` lines or any mention of Claude/AI in the commit.
- Make a new branch named `issue-$(issueNumber)` and commit the staged changes (fix + tests) there.
