# Code Review Pipeline

A pipeline that takes source code through a full review process. After linting it
forks into Test, Security Scan, and Review running in parallel, which then join at
the Report stage.

## Stages

### 1. Lint
**Skill:** static-analysis
**Success Criteria:** Zero linting errors and no unresolved warnings above severity threshold
**Next:** Test, Security Scan, Review
Run linters and static analysis tools against the codebase. Flag style violations, unused imports, and common anti-patterns.

### 2. Test
**Skill:** test-runner
**Success Criteria:** All tests pass with coverage above configured minimum threshold
**Next:** Report
Execute the project's test suite. Collect coverage reports and flag any failing or flaky tests.

### 3. Security Scan
**Skill:** security-audit
**Success Criteria:** No critical or high severity vulnerabilities found in dependencies or source
**Next:** Report
Scan dependencies for known vulnerabilities. Check for hardcoded secrets, injection risks, and OWASP top-10 issues.

### 4. Review
**Skill:** code-review
**Success Criteria:** All review comments addressed and at least one approval received
**Next:** Report
Perform a detailed code review. Evaluate readability, architecture, error handling, and adherence to project conventions.

### 5. Report
**Skill:** summary-report
**Success Criteria:** Final report generated with all findings categorized by severity
Compile findings from all previous stages into a structured report with severity ratings and actionable recommendations.
