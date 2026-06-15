// Sync the shared definitions repo (pipelines + skills) with a git remote.
// Push and pull are always available; a pull that hits conflicts leaves the repo
// mid-merge and exposes resolve actions (favor remote / favor local / abort) —
// the only time "merge" is a thing the user has to act on.
//
// Auth reuses the GitHub token already mounted into the container (gh-config /
// GITHUB_TOKEN) via an inline credential helper, so no secret is persisted; only
// the non-secret remote URL + branch live in settings.json.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HttpError } from '../utils/http';
import { readSettings, writeSettings } from './settings';
import { REPO_DIR, repoGit, ensureDefinitionsRepo } from './definitionsRepo';

const GIT_NAME = 'Bender';
const GIT_EMAIL = 'bender@local';

type GitResult = { ok: boolean; stdout: string; stderr: string };

// The GitHub token to authenticate https github.com remotes. Prefer the env,
// fall back to the mounted gh CLI config. Never persisted.
function githubToken(): string {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env.trim();
  try {
    const y = fs.readFileSync('/data/gh-config/hosts.yml', 'utf-8');
    const m = y.match(/oauth_token:\s*(\S+)/);
    if (m) return m[1].trim();
  } catch { /* no gh config */ }
  return '';
}

// git for network ops (fetch/push/pull): injects an inline credential helper fed
// by the token via env, so the token never lands in argv or on disk.
function authGit(args: string[], timeoutMs = 90_000): GitResult {
  const token = githubToken();
  const env = { ...process.env } as NodeJS.ProcessEnv;
  const cfg: string[] = [];
  if (token) {
    env.BENDER_GH_TOKEN = token;
    cfg.push(
      '-c', 'credential.helper=',
      '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$BENDER_GH_TOKEN"; }; f',
    );
  }
  const r = spawnSync('git', [...cfg, ...args], {
    cwd: REPO_DIR, encoding: 'utf-8', env, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
  });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function currentBranch(): string {
  return repoGit(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'master';
}

function remoteBranch(): string {
  return readSettings().definitionsRemote?.branch?.trim() || currentBranch();
}

// Point `origin` at the configured URL (idempotent).
function ensureRemote(url: string): void {
  const has = repoGit(['remote']).stdout.split('\n').map(s => s.trim()).includes('origin');
  if (has) repoGit(['remote', 'set-url', 'origin', url]);
  else repoGit(['remote', 'add', 'origin', url]);
}

function conflictedFiles(): string[] {
  const out = repoGit(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
  return out ? [...new Set(out.split('\n').filter(Boolean))] : [];
}

function midMerge(): boolean {
  return fs.existsSync(path.join(REPO_DIR, '.git', 'MERGE_HEAD'));
}

export interface SyncStatus {
  configured: boolean;
  url?: string;
  branch: string;
  localBranch: string;
  dirty: boolean;
  conflicted: boolean;
  conflictedFiles: string[];
  ahead: number;
  behind: number;
  remoteExists: boolean;
  lastCommit: string;
  hasToken: boolean;
  fetchError?: string;
}

// Report sync state. Fetches the configured remote (this runs on demand from the
// sync dialog, not on a poll) so ahead/behind are meaningful.
export function syncStatus(): SyncStatus {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  const localBranch = currentBranch();
  const branch = cfg?.branch?.trim() || localBranch;
  const dirty = !!repoGit(['status', '--porcelain']).stdout.trim();
  const conflicted = midMerge() && conflictedFiles().length > 0;
  const lastCommit = repoGit(['log', '-1', '--format=%h %s']).stdout.trim();
  const base: SyncStatus = {
    configured: !!cfg?.url, url: cfg?.url, branch, localBranch, dirty,
    conflicted, conflictedFiles: conflicted ? conflictedFiles() : [],
    ahead: 0, behind: 0, remoteExists: false, lastCommit, hasToken: !!githubToken(),
  };
  if (!cfg?.url) return base;

  ensureRemote(cfg.url);
  const fetched = authGit(['fetch', 'origin', branch]);
  if (!fetched.ok) {
    // A brand-new remote branch that doesn't exist yet isn't an error to surface
    // loudly — the user just hasn't pushed. Other failures (auth/url) we report.
    return { ...base, fetchError: fetched.stderr.trim() || undefined };
  }
  const rl = repoGit(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
  if (rl.ok && rl.stdout.trim()) {
    const [ahead, behind] = rl.stdout.trim().split(/\s+/).map(n => Number(n) || 0);
    return { ...base, ahead, behind, remoteExists: true };
  }
  return base;
}

export function setSyncRemote(url: string, branch: string): SyncStatus {
  ensureDefinitionsRepo();
  const u = (url || '').trim();
  const b = (branch || '').trim() || 'main';
  if (u && !/^https?:\/\//i.test(u) && !/^git@/i.test(u)) {
    throw new HttpError(400, 'Remote URL must start with http(s):// or git@');
  }
  const s = readSettings();
  s.definitionsRemote = u ? { url: u, branch: b } : undefined;
  writeSettings(s);
  if (u) ensureRemote(u);
  return syncStatus();
}

export function syncPush(): { ok: true; output: string } {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  if (!cfg?.url) throw new HttpError(400, 'No remote configured');
  ensureRemote(cfg.url);
  const branch = remoteBranch();
  const r = authGit(['push', '-u', 'origin', `HEAD:${branch}`]);
  if (!r.ok) throw new HttpError(502, `Push failed: ${(r.stderr || r.stdout).trim()}`);
  // git push reports to stderr even on success.
  return { ok: true, output: (r.stderr || r.stdout).trim() };
}

export type PullResult =
  | { ok: true; conflicted: false; output: string }
  | { ok: false; conflicted: true; files: string[] };

export function syncPull(): PullResult {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  if (!cfg?.url) throw new HttpError(400, 'No remote configured');
  if (midMerge()) throw new HttpError(409, 'A merge is already in progress — resolve it first');
  ensureRemote(cfg.url);
  const branch = remoteBranch();
  const f = authGit(['fetch', 'origin', branch]);
  if (!f.ok) throw new HttpError(502, `Fetch failed: ${f.stderr.trim() || f.stdout.trim()}`);

  const merge = repoGit([
    '-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`,
    'merge', '--no-edit', `origin/${branch}`,
  ]);
  if (merge.ok) return { ok: true, conflicted: false, output: merge.stdout.trim() || 'Up to date.' };

  const files = conflictedFiles();
  if (midMerge() && files.length) return { ok: false, conflicted: true, files };
  throw new HttpError(502, `Merge failed: ${(merge.stderr || merge.stdout).trim()}`);
}

// Complete or abandon a conflicted merge.
export function syncResolve(strategy: 'theirs' | 'ours' | 'abort'): { ok: true; strategy: string } {
  ensureDefinitionsRepo();
  if (!midMerge()) throw new HttpError(409, 'No merge in progress');
  if (strategy === 'abort') {
    const r = repoGit(['merge', '--abort']);
    if (!r.ok) throw new HttpError(502, `Abort failed: ${r.stderr.trim()}`);
    return { ok: true, strategy };
  }
  if (strategy !== 'theirs' && strategy !== 'ours') throw new HttpError(400, 'Invalid strategy');
  // Favor remote (theirs) or local (ours) for every conflicted path, then commit.
  const co = repoGit(['checkout', `--${strategy}`, '--', '.']);
  if (!co.ok) throw new HttpError(502, `Resolve failed: ${co.stderr.trim()}`);
  repoGit(['add', '-A']);
  const c = repoGit(['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, 'commit', '--no-edit']);
  if (!c.ok) throw new HttpError(502, `Commit failed: ${(c.stderr || c.stdout).trim()}`);
  return { ok: true, strategy };
}
