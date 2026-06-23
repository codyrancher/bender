// Sync the shared definitions repo with a git remote, per directory: each
// pipeline (pipelines/<id>/) and skill (skills/<id>/) is an independently
// selectable item. There is no content merge — operations overwrite a whole
// directory in one direction:
//   • Push  — make the remote's copy of the dir match local (build a commit on
//             top of the remote tree with just those dirs replaced → FF push).
//   • Pull  — make local's copy of the dir match remote (git checkout origin).
//   • Force — bypass the guard when the other side also changed (conflict) or
//             when pushing over a remote-ahead dir / pulling over a local-ahead one.
//
// Per-item status compares the local vs remote *tree* of each dir, classified
// against the merge-base. Auth reuses the mounted GitHub token; only the
// non-secret remote URL + branch live in settings.json.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HttpError } from '../utils/http';
import { readSettings, writeSettings } from './settings';
import { REPO_DIR, repoGit, commitAll, ensureDefinitionsRepo } from './definitionsRepo';

const GIT_NAME = 'Bender';
const GIT_EMAIL = 'bender@local';

const KINDS: Array<{ dir: string; kind: 'pipeline' | 'skill' }> = [
  { dir: 'pipelines', kind: 'pipeline' },
  { dir: 'skills', kind: 'skill' },
];

type GitResult = { ok: boolean; stdout: string; stderr: string };

export type SyncItemStatus =
  | 'in-sync' | 'local-only' | 'remote-only' | 'local-ahead' | 'remote-ahead' | 'conflict';

export interface SyncItem {
  path: string;                 // pipelines/<id> or skills/<id>
  id: string;
  kind: 'pipeline' | 'skill';
  status: SyncItemStatus;
}

export interface SyncStatus {
  configured: boolean;
  url?: string;
  branch: string;
  localBranch: string;
  hasToken: boolean;
  remoteExists: boolean;
  fetchError?: string;
  items: SyncItem[];
}

// ── auth ─────────────────────────────────────────────────────────────────────
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

// git for network ops (fetch/push): inline credential helper fed by the token
// via env, so it never lands in argv or on disk.
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

// git with extra env (used for the temp-index push plumbing).
function gitEnv(args: string[], extraEnv: NodeJS.ProcessEnv): GitResult {
  const r = spawnSync('git', args, {
    cwd: REPO_DIR, encoding: 'utf-8', env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function currentBranch(): string {
  return repoGit(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'master';
}
function remoteBranch(): string {
  return readSettings().definitionsRemote?.branch?.trim() || currentBranch();
}
function ensureRemote(url: string): void {
  const has = repoGit(['remote']).stdout.split('\n').map(s => s.trim()).includes('origin');
  if (has) repoGit(['remote', 'set-url', 'origin', url]);
  else repoGit(['remote', 'add', 'origin', url]);
}
function refExists(ref: string): boolean {
  return repoGit(['rev-parse', '--verify', '--quiet', ref]).ok;
}
// Object SHA of the tree/blob at <path> in <ref>, or null if absent.
function treeOf(ref: string, p: string): string | null {
  const r = repoGit(['rev-parse', `${ref}:${p}`]);
  return r.ok ? r.stdout.trim() : null;
}
export function isItemPath(p: string): boolean {
  return /^(pipelines|skills)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p);
}
function idOf(p: string): string { return p.split('/')[1]; }

function localItemPaths(): string[] {
  const out: string[] = [];
  for (const { dir } of KINDS) {
    const base = path.join(REPO_DIR, dir);
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(`${dir}/${e.name}`);
    }
  }
  return out;
}
function remoteItemPaths(remoteRef: string): string[] {
  const out: string[] = [];
  for (const { dir } of KINDS) {
    const r = repoGit(['ls-tree', '--name-only', `${remoteRef}:${dir}`]);
    if (r.ok) r.stdout.trim().split('\n').filter(Boolean).forEach(name => out.push(`${dir}/${name}`));
  }
  return out;
}

// Classify every item (union of local + remote dirs) by comparing trees.
function computeItems(branch: string): SyncItem[] {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const haveRemote = refExists(remoteRef);
  const local = new Set(localItemPaths());
  const remote = new Set(haveRemote ? remoteItemPaths(remoteRef) : []);
  const base = haveRemote ? (repoGit(['merge-base', 'HEAD', remoteRef]).stdout.trim() || null) : null;

  return [...new Set([...local, ...remote])].sort().map((p): SyncItem => {
    const lt = local.has(p) ? treeOf('HEAD', p) : null;
    const rt = remote.has(p) ? treeOf(remoteRef, p) : null;
    let status: SyncItemStatus;
    if (lt && rt) {
      if (lt === rt) status = 'in-sync';
      else {
        const bt = base ? treeOf(base, p) : null;
        const localChanged = lt !== bt;
        const remoteChanged = rt !== bt;
        status = localChanged && remoteChanged ? 'conflict' : localChanged ? 'local-ahead' : 'remote-ahead';
      }
    } else if (lt) status = 'local-only';
    else status = 'remote-only';
    return { path: p, id: idOf(p), kind: p.startsWith('skills/') ? 'skill' : 'pipeline', status };
  });
}

// ── public API ───────────────────────────────────────────────────────────────
export function syncStatus(): SyncStatus {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  const localBranch = currentBranch();
  const branch = cfg?.branch?.trim() || localBranch;
  const base: SyncStatus = {
    configured: !!cfg?.url, url: cfg?.url, branch, localBranch,
    hasToken: !!githubToken(), remoteExists: false, items: [],
  };
  if (!cfg?.url) return { ...base, items: computeItems(branch) };

  ensureRemote(cfg.url);
  const fetched = authGit(['fetch', 'origin', branch]);
  return {
    ...base,
    remoteExists: refExists(`refs/remotes/origin/${branch}`),
    fetchError: fetched.ok ? undefined : (fetched.stderr.trim() || undefined),
    items: computeItems(branch),
  };
}

export function setSyncRemote(url: string, branch: string): SyncStatus {
  ensureDefinitionsRepo();
  const u = (url || '').trim();
  const b = (branch || '').trim() || 'main';
  if (u && !/^https?:\/\//i.test(u) && !/^git@/i.test(u) && !/^file:\/\//i.test(u)) {
    throw new HttpError(400, 'Remote URL must start with http(s)://, git@, or file://');
  }
  const s = readSettings();
  s.definitionsRemote = u ? { url: u, branch: b } : undefined;
  writeSettings(s);
  if (u) ensureRemote(u);
  return syncStatus();
}

export interface SyncOpResult { ok: true; done: string[]; skipped: Array<{ path: string; reason: string }> }

// Push selected dirs: make the remote's copy match local. Builds one commit on
// top of the remote tree with the selected dirs replaced by their local trees,
// then fast-forward pushes it (so other remote dirs are preserved).
export function pushItems(paths: string[], force: boolean): SyncOpResult {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  if (!cfg?.url) throw new HttpError(400, 'No remote configured');
  ensureRemote(cfg.url);
  const branch = remoteBranch();
  authGit(['fetch', 'origin', branch]); // ok to fail (remote branch may not exist yet)
  const remoteRef = `refs/remotes/origin/${branch}`;
  const haveRemote = refExists(remoteRef);
  const status = new Map(computeItems(branch).map(i => [i.path, i.status]));

  const skipped: Array<{ path: string; reason: string }> = [];
  const sel: string[] = [];
  for (const p of paths) {
    if (!isItemPath(p)) { skipped.push({ path: p, reason: 'invalid path' }); continue; }
    const st = status.get(p);
    if (!st || st === 'remote-only') { skipped.push({ path: p, reason: 'not present locally' }); continue; }
    if (st === 'in-sync') { skipped.push({ path: p, reason: 'already in sync' }); continue; }
    if ((st === 'conflict' || st === 'remote-ahead') && !force) {
      skipped.push({ path: p, reason: 'remote has changes — use force to overwrite' }); continue;
    }
    sel.push(p);
  }
  if (!sel.length) return { ok: true, done: [], skipped };

  const idx = path.join('/tmp', `bender-sync-${process.pid}.index`);
  try { fs.rmSync(idx, { force: true }); } catch { /* ignore */ }
  const env: NodeJS.ProcessEnv = {
    GIT_INDEX_FILE: idx,
    GIT_AUTHOR_NAME: GIT_NAME, GIT_AUTHOR_EMAIL: GIT_EMAIL,
    GIT_COMMITTER_NAME: GIT_NAME, GIT_COMMITTER_EMAIL: GIT_EMAIL,
  };
  try {
    gitEnv(haveRemote ? ['read-tree', remoteRef] : ['read-tree', '--empty'], env);
    for (const p of sel) {
      // -f: the temp index (remote tree) differs from the worktree, which would
      // otherwise trip git rm's safety check.
      gitEnv(['rm', '-r', '--cached', '-f', '--ignore-unmatch', p], env);
      const lt = treeOf('HEAD', p);
      if (lt) gitEnv(['read-tree', `--prefix=${p}/`, lt], env);
    }
    const tree = gitEnv(['write-tree'], env).stdout.trim();
    if (!tree) throw new HttpError(500, 'Failed to build push tree');
    const parent = haveRemote ? ['-p', remoteRef] : [];
    const commit = gitEnv(['commit-tree', tree, ...parent, '-m', `Sync push: ${sel.map(idOf).join(', ')}`], env).stdout.trim();
    if (!commit) throw new HttpError(500, 'Failed to build push commit');
    const pushed = authGit(['push', 'origin', `${commit}:refs/heads/${branch}`]);
    if (!pushed.ok) throw new HttpError(502, `Push failed: ${(pushed.stderr || pushed.stdout).trim()}`);
  } finally {
    try { fs.rmSync(idx, { force: true }); } catch { /* ignore */ }
  }
  authGit(['fetch', 'origin', branch]);
  return { ok: true, done: sel, skipped };
}

// Pull selected dirs: make local's copy match remote (whole-dir overwrite), then
// commit. Removes the local dir first so remote file deletions are reflected.
export function pullItems(paths: string[], force: boolean): SyncOpResult {
  ensureDefinitionsRepo();
  const cfg = readSettings().definitionsRemote;
  if (!cfg?.url) throw new HttpError(400, 'No remote configured');
  ensureRemote(cfg.url);
  const branch = remoteBranch();
  const fetched = authGit(['fetch', 'origin', branch]);
  if (!fetched.ok) throw new HttpError(502, `Fetch failed: ${fetched.stderr.trim()}`);
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (!refExists(remoteRef)) throw new HttpError(400, 'Remote branch does not exist yet');
  const status = new Map(computeItems(branch).map(i => [i.path, i.status]));

  const skipped: Array<{ path: string; reason: string }> = [];
  const sel: string[] = [];
  for (const p of paths) {
    if (!isItemPath(p)) { skipped.push({ path: p, reason: 'invalid path' }); continue; }
    const st = status.get(p);
    if (!st || st === 'local-only') { skipped.push({ path: p, reason: 'not present on remote' }); continue; }
    if (st === 'in-sync') { skipped.push({ path: p, reason: 'already in sync' }); continue; }
    if ((st === 'conflict' || st === 'local-ahead') && !force) {
      skipped.push({ path: p, reason: 'local has changes — use force to overwrite' }); continue;
    }
    sel.push(p);
  }
  if (!sel.length) return { ok: true, done: [], skipped };

  for (const p of sel) {
    try { fs.rmSync(path.join(REPO_DIR, p), { recursive: true, force: true }); } catch { /* ignore */ }
    repoGit(['checkout', remoteRef, '--', p]); // restore the dir from the remote tree
  }
  commitAll(`Sync pull: ${sel.map(idOf).join(', ')}`);
  return { ok: true, done: sel, skipped };
}
