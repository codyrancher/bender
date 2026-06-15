// The single git-backed repo that holds BOTH pipeline definitions and skill
// definitions, so they version and sync to one remote together:
//
//   /data/config/definitions/            (one git repo)
//     pipelines/<id>/{pipeline.yaml, CLAUDE.md, skills/…}
//     skills/<id>/{SKILL.md, …}
//
// definitions.ts and skillDefinitions.ts operate on their respective subdir but
// share this repo's history (their git runs with cwd inside the subdir; git
// discovers the .git at the repo root and pathspecs stay subdir-relative, while
// commits go through commitAll which stages the whole repo).
//
// Lives under /data/config (a persistent host mount) so it survives container
// recreates. Previously these were two separate repos (pipeline-definitions and
// skill-definitions); ensureDefinitionsRepo() migrates those in on first run.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, bundledDir } from '../config/constants';

const CONFIG_DIR = path.join(DATA_DIR, 'config');
export const REPO_DIR = path.join(CONFIG_DIR, 'definitions');
export const PIPELINES_DIR = path.join(REPO_DIR, 'pipelines');
export const SKILLS_DIR = path.join(REPO_DIR, 'skills');

// The pre-consolidation repos we migrate in (and then keep as backups).
const OLD_PIPELINES_DIR = path.join(CONFIG_DIR, 'pipeline-definitions');
const OLD_SKILLS_DIR = path.join(CONFIG_DIR, 'skill-definitions');

const GIT_NAME = 'Bender';
const GIT_EMAIL = 'bender@local';

// Run git in the repo (cwd defaults to the repo root; pass a subdir to scope
// pathspecs to it). git discovers the .git at REPO_DIR regardless of subdir.
export function repoGit(args: string[], cwd: string = REPO_DIR): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Stage the whole repo and commit. Used by both definition services so a write
// to either subdir is one commit on the shared history.
export function commitAll(message: string): string {
  repoGit(['add', '-A']);
  repoGit(['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, 'commit', '-m', message, '--allow-empty']);
  return repoGit(['rev-parse', 'HEAD']).stdout.trim();
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Seed pipeline definitions from the baked-in flat *.pipeline.yaml defaults into
// folder-per-definition (with the optional companion <id>.CLAUDE.md).
function seedPipelines(dir: string): void {
  const seed = bundledDir('pipeline-definitions');
  if (!fs.existsSync(seed)) return;
  for (const f of fs.readdirSync(seed).filter(x => x.endsWith('.pipeline.yaml'))) {
    const id = f.replace('.pipeline.yaml', '');
    const out = path.join(dir, id);
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(path.join(seed, f), path.join(out, 'pipeline.yaml'));
    const claudeSeed = path.join(seed, `${id}.CLAUDE.md`);
    if (fs.existsSync(claudeSeed)) fs.copyFileSync(claudeSeed, path.join(out, 'CLAUDE.md'));
  }
}

// Seed skill definitions from the baked-in folder-per-skill defaults.
function seedSkills(dir: string): void {
  const seed = bundledDir('skill-definitions');
  if (!fs.existsSync(seed)) return;
  for (const entry of fs.readdirSync(seed, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(path.join(seed, entry.name), path.join(dir, entry.name));
  }
}

// True if a legacy repo dir holds real content (definition folders), not just a
// .git (or nothing).
function hasContent(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some(name => name !== '.git');
  } catch {
    return false;
  }
}

// Move each child (except .git) of `from` into `into`, then rename `from` to a
// .pre-consolidation backup so the move is reversible and not re-run.
function migrateChildren(from: string, into: string): void {
  for (const name of fs.readdirSync(from)) {
    if (name === '.git') continue;
    fs.renameSync(path.join(from, name), path.join(into, name));
  }
  fs.renameSync(from, `${from}.pre-consolidation`);
}

let ready = false;
export function ensureDefinitionsRepo(): void {
  if (ready) return;
  fs.mkdirSync(PIPELINES_DIR, { recursive: true });
  fs.mkdirSync(SKILLS_DIR, { recursive: true });

  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    repoGit(['init']);
    repoGit(['config', 'user.name', GIT_NAME]);
    repoGit(['config', 'user.email', GIT_EMAIL]);

    // Migrate the two legacy repos in if present, else seed from baked defaults.
    if (hasContent(OLD_PIPELINES_DIR)) migrateChildren(OLD_PIPELINES_DIR, PIPELINES_DIR);
    else seedPipelines(PIPELINES_DIR);

    if (hasContent(OLD_SKILLS_DIR)) migrateChildren(OLD_SKILLS_DIR, SKILLS_DIR);
    else seedSkills(SKILLS_DIR);

    commitAll('Consolidate pipeline + skill definitions into one repo');
  }
  ready = true;
}
