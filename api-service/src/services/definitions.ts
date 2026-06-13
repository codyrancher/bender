// Git-backed global pipeline-definitions repo. A "definition" is a folder
// bundling a pipeline.yaml and the SKILL.md files it references, versioned
// together:
//
//   /data/config/pipeline-definitions/        (git repo)
//     <id>/
//       pipeline.yaml
//       skills/<skill-name>/SKILL.md
//
// Lives under /data/config which is a persistent host mount, so the repo
// survives container recreates without a docker-compose change.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HttpError } from '../utils/http';
import { listSkillDefinitions, getSkillDefinition } from './skillDefinitions';
import { getTemplateClaudeMd } from './templates';
import { parsePipelineSpec, validatePipeline, markdownToYaml } from '../utils/pipelineParser';

// Template whose CLAUDE.md seeds a new definition's CLAUDE.md by default (every
// pipeline gets this template's environment unless another is requested).
const DEFAULT_CLAUDE_TEMPLATE = 'rancher-dashboard';

const DEFINITIONS_DIR = '/data/config/pipeline-definitions';
// Baked-in defaults shipped in the image, used to seed the repo on first run.
const SEED_DIR = path.join(__dirname, '..', 'pipeline-definitions');

const GIT_NAME = 'Bender';
const GIT_EMAIL = 'bender@local';

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: DEFINITIONS_DIR, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function gitCommit(message: string): string {
  git(['add', '-A']);
  git(['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, 'commit', '-m', message, '--allow-empty']);
  // FUTURE (remote push): once a remote is configured (e.g. via a settings key
  // `definitionsRemote` + credentials), uncomment to mirror commits upstream:
  //   git(['push', 'origin', 'HEAD']);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

let repoReady = false;
function ensureRepo(): void {
  if (repoReady) return;
  fs.mkdirSync(DEFINITIONS_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DEFINITIONS_DIR, '.git'))) {
    git(['init']);
    git(['config', 'user.name', GIT_NAME]);
    git(['config', 'user.email', GIT_EMAIL]);
    // Seed from baked-in flat *.pipeline.yaml defaults → folder-per-definition
    try {
      if (fs.existsSync(SEED_DIR)) {
        for (const f of fs.readdirSync(SEED_DIR).filter(x => x.endsWith('.pipeline.yaml'))) {
          const id = f.replace('.pipeline.yaml', '');
          const dir = path.join(DEFINITIONS_DIR, id);
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(path.join(SEED_DIR, f), path.join(dir, 'pipeline.yaml'));
          // Optional companion `<id>.CLAUDE.md` seeds the definition's CLAUDE.md.
          const claudeSeed = path.join(SEED_DIR, `${id}.CLAUDE.md`);
          if (fs.existsSync(claudeSeed)) fs.copyFileSync(claudeSeed, path.join(dir, 'CLAUDE.md'));
        }
      }
    } catch { /* ignore seeding errors */ }
    gitCommit('Seed definitions from defaults');
  }
  repoReady = true;
}

function safeId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function listSkillNames(id: string): string[] {
  const skillsDir = path.join(DEFINITIONS_DIR, id, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
    .map(d => d.name);
}

export function listDefinitions(): any[] {
  ensureRepo();
  const out: any[] = [];
  for (const entry of fs.readdirSync(DEFINITIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name.startsWith('.')) continue;
    const ymlPath = path.join(DEFINITIONS_DIR, entry.name, 'pipeline.yaml');
    if (!fs.existsSync(ymlPath)) continue;
    const spec = parsePipelineSpec(fs.readFileSync(ymlPath, 'utf-8'));
    out.push({
      id: entry.name,
      name: titleize(entry.name),
      stages: spec.stages,
      skills: listSkillNames(entry.name),
      args: spec.args,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getDefinition(id: string): any | null {
  ensureRepo();
  if (!safeId(id)) return null;
  const dir = path.join(DEFINITIONS_DIR, id);
  const ymlPath = path.join(dir, 'pipeline.yaml');
  if (!fs.existsSync(ymlPath)) return null;
  const content = fs.readFileSync(ymlPath, 'utf-8');
  const spec = parsePipelineSpec(content);
  const skills = listSkillNames(id).map(name => ({
    name,
    content: fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf-8'),
  }));
  const claudePath = path.join(dir, 'CLAUDE.md');
  const claudeMd = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8') : '';
  return { id, name: titleize(id), content, stages: spec.stages, skills, claudeMd, args: spec.args };
}

// Write (create or overwrite) a definition and commit it. `pipelineMd` holds the
// pipeline.yaml text (kept the field name for the API; the format is YAML now).
export function writeDefinition(opts: {
  id: string;
  pipelineMd: string;
  skills?: Array<{ name: string; content: string }>;
  claudeMd?: string;
  message?: string;
}): { sha: string } {
  ensureRepo();
  if (!safeId(opts.id)) throw new Error('Invalid definition id');
  const dir = path.join(DEFINITIONS_DIR, opts.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pipeline.yaml'), opts.pipelineMd || '');

  // CLAUDE.md is optional and edited independently of pipeline.yaml. Only touch
  // it when a value is supplied so unrelated saves don't clobber it; an empty
  // string means "remove it" (fall back to the template CLAUDE.md at run time).
  if (typeof opts.claudeMd === 'string') {
    const claudePath = path.join(dir, 'CLAUDE.md');
    if (opts.claudeMd) fs.writeFileSync(claudePath, opts.claudeMd);
    else fs.rmSync(claudePath, { force: true });
  }

  // Replace bundled skills wholesale so removed skills don't linger
  const skillsDir = path.join(dir, 'skills');
  fs.rmSync(skillsDir, { recursive: true, force: true });
  for (const s of opts.skills || []) {
    if (!safeId(s.name) || !s.content) continue;
    const sdir = path.join(skillsDir, s.name);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'SKILL.md'), s.content);
  }
  const sha = gitCommit(opts.message || `Update ${opts.id}`);
  return { sha };
}

export function deleteDefinition(id: string): void {
  ensureRepo();
  if (!safeId(id)) throw new Error('Invalid definition id');
  fs.rmSync(path.join(DEFINITIONS_DIR, id), { recursive: true, force: true });
  gitCommit(`Delete ${id}`);
}

// Commit history for a definition folder (or the whole repo if id omitted)
export function getHistory(id?: string): any[] {
  ensureRepo();
  const args = ['log', '--format=%H%x09%an%x09%aI%x09%s'];
  if (id && safeId(id)) args.push('--', id);
  const { ok, stdout } = git(args);
  if (!ok || !stdout.trim()) return [];
  return stdout.trim().split('\n').map(line => {
    const [sha, author, date, ...rest] = line.split('\t');
    return { sha, author, date, message: rest.join('\t') };
  });
}

// Unified diff (git show) for a commit, scoped to a definition folder if given
export function getCommitDiff(sha: string, id?: string): string {
  ensureRepo();
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return '';
  const args = ['show', sha];
  if (id && safeId(id)) args.push('--', id);
  return git(args).stdout || '';
}

// Copy a definition's pipeline.yaml + skills into a pipeline workspace
export function materializeInto(id: string, workspaceDir: string): boolean {
  ensureRepo();
  const def = getDefinition(id);
  if (!def) return false;
  fs.writeFileSync(path.join(workspaceDir, 'pipeline.yaml'), def.content);

  const written = new Set<string>();
  // Skills bundled with the definition take precedence.
  for (const s of def.skills) {
    const sdir = path.join(workspaceDir, '.claude', 'skills', s.name);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'SKILL.md'), s.content);
    written.add(s.name.toLowerCase());
  }
  // Any skill a stage references but doesn't bundle is pulled from the global
  // skill-definitions repo (its full directory: SKILL.md + reference files).
  for (const stage of def.stages as Array<{ skill?: string }>) {
    const name = (stage.skill || '').trim();
    if (!name || written.has(name.toLowerCase())) continue;
    const skill = getSkillDefinition(name);
    if (!skill) continue;
    for (const f of skill.files as Array<{ path: string; content: string; binary: boolean }>) {
      if (f.binary) continue;
      const dest = path.join(workspaceDir, '.claude', 'skills', name, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
    written.add(name.toLowerCase());
  }
  // Library skills (id prefixed `rancher-browser-`) hold reusable browser-action
  // scripts that stage skills compose. They aren't pipeline stages, so pull them
  // in unconditionally so they're always available in the workspace.
  try {
    for (const lib of listSkillDefinitions() as Array<{ id: string }>) {
      if (!/^rancher-browser-/.test(lib.id) || written.has(lib.id.toLowerCase())) continue;
      const skill = getSkillDefinition(lib.id);
      if (!skill) continue;
      for (const f of skill.files as Array<{ path: string; content: string; binary: boolean }>) {
        if (f.binary) continue;
        const dest = path.join(workspaceDir, '.claude', 'skills', lib.id, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content);
      }
      written.add(lib.id.toLowerCase());
    }
  } catch { /* library materialization is best-effort */ }
  return true;
}

// Create a new definition. New definitions default their CLAUDE.md to the
// rancher-dashboard template's (the environment every pipeline gets) so it shows
// up editable from the start. Throws HttpError on a bad id or existing definition.
export function createDefinition(body: any): { id: string; sha: string } {
  ensureRepo();
  const id = (body.id || '').trim();
  if (!safeId(id)) throw new HttpError(400, 'Invalid id (alphanumeric, - and _)');
  if (fs.existsSync(path.join(DEFINITIONS_DIR, id))) throw new HttpError(409, 'Definition already exists');
  const claudeMd = typeof body.claudeMd === 'string' ? body.claudeMd : getTemplateClaudeMd(DEFAULT_CLAUDE_TEMPLATE);
  const { sha } = writeDefinition({
    id,
    pipelineMd: typeof body.pipelineMd === 'string' ? body.pipelineMd : `name: ${titleize(id)}\nstages: []\n`,
    skills: Array.isArray(body.skills) ? body.skills : [],
    claudeMd,
    message: `Create ${id}`,
  });
  return { id, sha };
}

// Update a definition. When pipeline.yaml actually changes, validate the graph
// and that referenced skills are available (bundled ∪ global) before writing.
export function updateDefinition(id: string, body: any): { id: string; sha: string } {
  const existing = getDefinition(id);
  if (!existing) throw new HttpError(404, 'Definition not found');
  const pipelineMd = typeof body.pipelineMd === 'string' ? body.pipelineMd : existing.content;
  const skills = Array.isArray(body.skills) ? body.skills : existing.skills;

  if (typeof body.pipelineMd === 'string' && body.pipelineMd !== existing.content) {
    const availableSkills = [
      ...skills.map((s: { name: string }) => s.name),
      ...listSkillDefinitions().map((s: { id: string }) => s.id),
    ];
    const errors = validatePipeline(pipelineMd, availableSkills);
    if (errors.length) throw new HttpError(400, errors.join(' '), { errors });
  }

  const claudeMd = typeof body.claudeMd === 'string' ? body.claudeMd : undefined;
  const { sha } = writeDefinition({ id, pipelineMd, skills, claudeMd, message: body.message || `Update ${id}` });
  return { id, sha };
}

// One-time migration: convert any legacy <id>/pipeline.md in the definitions repo
// to pipeline.yaml and commit. Safe to run on every boot (no-op once migrated).
export function migrateDefinitionsToYaml(): void {
  ensureRepo();
  let changed = false;
  for (const entry of fs.readdirSync(DEFINITIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue;
    const mdPath = path.join(DEFINITIONS_DIR, entry.name, 'pipeline.md');
    const ymlPath = path.join(DEFINITIONS_DIR, entry.name, 'pipeline.yaml');
    if (fs.existsSync(mdPath) && !fs.existsSync(ymlPath)) {
      fs.writeFileSync(ymlPath, markdownToYaml(fs.readFileSync(mdPath, 'utf-8')));
      fs.rmSync(mdPath);
      changed = true;
    }
  }
  if (changed) gitCommit('Migrate definitions from pipeline.md to pipeline.yaml');
}
