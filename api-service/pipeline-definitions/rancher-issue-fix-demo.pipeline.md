# Rancher Issue Fix & Demo

Reproduce a rancher/dashboard issue, demonstrate it (screenshot or video), fix it, verify the fix against the original demonstration, ensure tests, record a fixed demonstration, then commit and open a PR.

## Stages

### 1. Reproduce Issue
**Skill:** rancher-issue-reproduce
**Success Criteria:** The reported bug is reliably reproduced against the live Rancher instance and the trigger steps are documented.
**Next:** Decide Demonstration
Reproduce the issue against the project's Rancher instance and document the exact trigger steps.

### 2. Decide Demonstration
**Skill:** rancher-demo-decide
**Success Criteria:** A medium (screenshot or video) is chosen and written to demo-medium.txt with a rationale.
**Next:** Record Screenshot, Record Video
Decide whether a screenshot or a video best demonstrates the reproduction. Forks to both recorders; only the chosen medium produces output.

### 3. Record Screenshot
**Skill:** rancher-screenshot-record
**Success Criteria:** A before-fix screenshot is captured when screenshot was selected (no-op otherwise).
**Next:** Create Fix
Capture a screenshot of the reproduction when that medium was chosen.

### 4. Record Video
**Skill:** rancher-video-record
**Success Criteria:** A before-fix video is recorded when video was selected (no-op otherwise).
**Next:** Create Fix
Record a video of the reproduction when that medium was chosen.

### 5. Create Fix
**Skill:** rancher-fix-create
**Success Criteria:** A focused code change addressing the root cause is implemented in the dashboard workspace.
**Next:** Verify Fix
Implement the fix for the reproduced issue. Joins the screenshot and video branches.

### 6. Verify Fix
**Skill:** rancher-fix-verify
**Success Criteria:** Replaying the original demonstration shows the bug is gone and behavior matches expectations.
**Next:** Ensure Tests
Verify the fix resolves the issue using the original reproduction.

### 7. Ensure Tests
**Skill:** rancher-tests-ensure
**Success Criteria:** A regression test covering the fix is added or updated and the relevant suite passes.
**Next:** Record Fixed Demonstration
Ensure appropriate automated tests cover the fix.

### 8. Record Fixed Demonstration
**Skill:** rancher-demo-record
**Success Criteria:** An after-fix screenshot or video (same medium as before) clearly shows the issue resolved.
**Next:** Create Commit
Record the post-fix demonstration highlighting that the issue is fixed.

### 9. Create Commit
**Skill:** rancher-commit-create
**Success Criteria:** A concise, convention-following commit on branch issue-NNNNN containing the fix and tests.
**Next:** Create PR
Commit the change following project conventions.

### 10. Create PR
**Skill:** rancher-pr-create
**Success Criteria:** A draft PR is opened upstream with the before/after demonstration embedded inline.
Open a draft pull request upstream to rancher/dashboard.
