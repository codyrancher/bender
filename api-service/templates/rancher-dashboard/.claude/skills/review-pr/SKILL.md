---
name: review-pr
description: Review a pull request in rancher/dashboard by leaving short, pending inline comments via the GitHub API. Never submits the review (the user submits manually). Use when asked to review a PR, especially when the project name encodes a PR number.
---

- The PR number to review corresponds to the issue number in the Rancher instance name (e.g., `pr-16383-rancher` corresponds to PR #16383).
- Use `gh` to fetch the PR diff and details.
- Review each changed file and leave inline comments where appropriate using the GitHub API.
- Do NOT submit the review. Only create individual review comments as pending so the user can review and submit themselves.
- When using the GitHub API, omit the `event` field from the review creation request to keep it in PENDING state. Using `"event": "COMMENT"` submits the review immediately.
- Keep each comment short, no more than a few lines.
- When referring to specific lines (in the same file or elsewhere in the codebase), include a GitHub permalink to those lines rather than describing the location in prose.
- Never post nit-level comments. Skip purely stylistic preferences, naming bikesheds, formatting that the linter would catch anyway, and "could also be written as" rewrites that don't change behavior. If the only thing wrong is taste, say nothing. Only leave a comment when there's a real concern: a bug, a correctness issue, a missed edge case, a security or performance problem, an accessibility regression, or guidance that materially changes the design.
