---
name: rancher-tests-ensure
description: Ensure appropriate automated tests cover the fix — add or update unit/e2e tests in rancher/dashboard and confirm they pass. Use after the fix is verified manually.
---

Make sure the fix is protected by tests so the bug cannot silently return.

## Steps

1. Pick the test type that fits the changed area: a Jest unit/component test, or a Cypress e2e test — mirror nearby existing tests.
2. Add a regression test that **fails on the old behavior and passes with the fix**.
3. Update any existing tests affected by the change.
4. Run the relevant suite (e.g. `yarn jest <path>` or the package's test script) and confirm it is green.
5. If automated coverage genuinely isn't feasible, document why in `/workspace/repro-notes.md`.
