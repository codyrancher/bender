// Git-backed global pipeline-definitions repo. A "definition" is a folder
// bundling a pipeline.md and the SKILL.md files it references, versioned
// together:
//
//   /data/config/pipeline-definitions/        (git repo)
//     <id>/
//       pipeline.md
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

// Template whose CLAUDE.md seeds a new definition's CLAUDE.md by default (every
// pipeline gets this template's environment unless another is requested).
const DEFAULT_CLAUDE_TEMPLATE = 'rancher-dashboard';

const DEFINITIONS_DIR = '/data/config/pipeline-definitions';
// Baked-in defaults shipped in the image, used to seed the repo on first run.
const SEED_DIR = path.join(__dirname, '..', 'pipeline-definitions');

const GIT_NAME = 'Bender';
const GIT_EMAIL = 'bender@local';

interface DefinitionStage {
  name: string;
  skill: string;
  description: string;
  successCriteria: string;
  nextNames: string[];
  next: number[];
}

function parseStages(markdown: string): DefinitionStage[] {
  const stages: DefinitionStage[] = [];
  const lines = markdown.split('\n');
  let current: Partial<DefinitionStage> | null = null;
  let descLines: string[] = [];
  const flush = () => {
    if (current?.name && current?.skill) {
      stages.push({ name: current.name, skill: current.skill, description: descLines.join(' ').trim(), successCriteria: current.successCriteria || '', nextNames: current.nextNames || [], next: [] });
    }
  };
  for (const line of lines) {
    const stageMatch = line.match(/^###\s+\d+\.\s+(.+)/);
    if (stageMatch) { flush(); current = { name: stageMatch[1].trim(), nextNames: [] }; descLines = []; continue; }
    if (current) {
      const skillMatch = line.match(/^\*\*Skill:\*\*\s*(.+)/);
      if (skillMatch) { current.skill = skillMatch[1].trim(); continue; }
      const critMatch = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/);
      if (critMatch) { current.successCriteria = critMatch[1].trim(); continue; }
      const nextMatch = line.match(/^\*\*Next:\*\*\s*(.+)/);
      if (nextMatch) { current.nextNames = nextMatch[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
      const t = line.trim();
      if (t) descLines.push(t);
    }
  }
  flush();
  // resolve successor names → indices; default to linear when none declared
  const byName = new Map<string, number>();
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i));
  const anyEdges = stages.some(s => s.nextNames.length);
  stages.forEach((s, i) => {
    s.next = anyEdges
      ? s.nextNames.map(n => byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1).filter(x => x >= 0)
      : (i < stages.length - 1 ? [i + 1] : []);
  });
  return stages;
}

// Validate that a pipeline.md forms a runnable pipeline and that every
// referenced skill is available (bundled here or a global skill-definition).
// Returns a list of human-readable errors ([] = valid).
export function validatePipeline(pipelineMd: string, availableSkills: string[]): string[] {
  const stages = parseStages(pipelineMd);
  const errors: string[] = [];
  if (!stages.length) { errors.push('No stages found (use "### 1. Stage Name").'); return errors; }

  const byName = new Set(stages.map(s => s.name.toLowerCase()));
  const noSkill = stages.filter(s => !s.skill).map(s => s.name);
  if (noSkill.length) errors.push(`Missing **Skill:** on stage(s): ${noSkill.join(', ')}.`);

  for (const s of stages) {
    for (const n of s.nextNames) {
      if (!byName.has(n.toLowerCase())) errors.push(`Stage "${s.name}" references unknown **Next:** target "${n}".`);
    }
  }

  const preds = stages.map(() => 0);
  stages.forEach(s => s.next.forEach(j => { preds[j]++; }));
  if (!preds.some(p => p === 0)) errors.push('No entry point — every stage has a predecessor (fully cyclic).');
  if (!stages.some(s => s.next.length === 0)) errors.push('No terminal stage — the pipeline never ends.');

  const avail = new Set(availableSkills.map(x => x.toLowerCase()));
  const missing = [...new Set(stages.filter(s => s.skill && !avail.has(s.skill.toLowerCase())).map(s => s.skill))];
  if (missing.length) errors.push(`Skill(s) not available: ${missing.join(', ')}.`);

  return errors;
}

export interface PipelineArg { name: string; description: string; required: boolean; default: string }

// Parse an optional "## Args" section declaring the inputs a pipeline accepts.
// Each arg is a bullet: `- **NAME** (required): description. Default: \`value\``
// (the "(required)" flag and "Default: ..." are optional). These become a simple
// form at creation time and are passed into the pipeline container as env vars.
export function parseArgs(markdown: string): PipelineArg[] {
  const lines = (markdown || '').split('\n');
  const args: PipelineArg[] = [];
  let inArgs = false;
  for (const line of lines) {
    if (/^##\s+Args\b/i.test(line)) { inArgs = true; continue; }
    if (inArgs && /^##\s+/.test(line)) break; // next section ends the Args block
    if (!inArgs) continue;
    const m = line.match(/^\s*[-*]\s+\*\*([A-Za-z_][A-Za-z0-9_]*)\*\*\s*(\(required\))?\s*:?\s*(.*)$/);
    if (!m) continue;
    let desc = (m[3] || '').trim();
    let def = '';
    const dm = desc.match(/Default:\s*`([^`]*)`/i);
    if (dm) { def = dm[1]; desc = desc.replace(/\.?\s*Default:\s*`[^`]*`/i, '').trim(); }
    args.push({ name: m[1], description: desc, required: !!m[2], default: def });
  }
  return args;
}

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
    // Seed from baked-in flat *.pipeline.md defaults → folder-per-definition
    try {
      if (fs.existsSync(SEED_DIR)) {
        for (const f of fs.readdirSync(SEED_DIR).filter(x => x.endsWith('.pipeline.md'))) {
          const id = f.replace('.pipeline.md', '');
          const dir = path.join(DEFINITIONS_DIR, id);
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(path.join(SEED_DIR, f), path.join(dir, 'pipeline.md'));
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
    const mdPath = path.join(DEFINITIONS_DIR, entry.name, 'pipeline.md');
    if (!fs.existsSync(mdPath)) continue;
    const content = fs.readFileSync(mdPath, 'utf-8');
    out.push({
      id: entry.name,
      name: titleize(entry.name),
      stages: parseStages(content),
      skills: listSkillNames(entry.name),
      args: parseArgs(content),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getDefinition(id: string): any | null {
  ensureRepo();
  if (!safeId(id)) return null;
  const dir = path.join(DEFINITIONS_DIR, id);
  const mdPath = path.join(dir, 'pipeline.md');
  if (!fs.existsSync(mdPath)) return null;
  const content = fs.readFileSync(mdPath, 'utf-8');
  const skills = listSkillNames(id).map(name => ({
    name,
    content: fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf-8'),
  }));
  const claudePath = path.join(dir, 'CLAUDE.md');
  const claudeMd = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8') : '';
  return { id, name: titleize(id), content, stages: parseStages(content), skills, claudeMd, args: parseArgs(content) };
}

// Write (create or overwrite) a definition and commit it.
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
  fs.writeFileSync(path.join(dir, 'pipeline.md'), opts.pipelineMd || '');

  // CLAUDE.md is optional and edited independently of pipeline.md. Only touch it
  // when a value is supplied so unrelated saves don't clobber it; an empty string
  // means "remove it" (fall back to the template CLAUDE.md at run time).
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

// Copy a definition's pipeline.md + skills into a pipeline workspace
export function materializeInto(id: string, workspaceDir: string): boolean {
  ensureRepo();
  const def = getDefinition(id);
  if (!def) return false;
  fs.writeFileSync(path.join(workspaceDir, 'pipeline.md'), def.content);

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
    pipelineMd: typeof body.pipelineMd === 'string' ? body.pipelineMd : `# ${titleize(id)}\n\n## Stages\n`,
    skills: Array.isArray(body.skills) ? body.skills : [],
    claudeMd,
    message: `Create ${id}`,
  });
  return { id, sha };
}

// Update a definition. When pipeline.md actually changes, validate the graph and
// that referenced skills are available (bundled ∪ global) before writing.
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
