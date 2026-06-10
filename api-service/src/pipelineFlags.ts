/**
 * Project names encode optional behavior via keywords that may appear anywhere
 * in the name and in any combination. Examples:
 *   - `pr-12345`           → PR mode
 *   - `issue-16868`        → issue mode
 *   - `prime`              → Rancher Prime mode
 *   - `issue-42-prime`     → issue + prime
 *   - `my-pr-999-prime-v2` → PR + prime
 *
 * Each keyword is matched independently, so projects can mix and match freely.
 */

export interface ProjectFlags {
  prNumber: string | null;
  issueNumber: string | null;
  prime: boolean;
}

// Hyphen-separated numeric tokens; match anywhere in the name.
const PR_RE = /pr-(\d+)/;
const ISSUE_RE = /issue-(\d+)/;
// Require a token boundary around "prime" so `primer`, `reprime`, etc. don't match.
const PRIME_RE = /(?:^|[-_])prime(?:[-_]|$)/i;

export function extractPipelineFlags(projectName: string): ProjectFlags {
  const prMatch = projectName.match(PR_RE);
  const issueMatch = projectName.match(ISSUE_RE);
  return {
    prNumber: prMatch ? prMatch[1] : null,
    issueNumber: issueMatch ? issueMatch[1] : null,
    prime: PRIME_RE.test(projectName),
  };
}
