import { Express, Request, Response } from 'express';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Git-backed global definitions repo. A "definition" is a folder bundling a
// pipeline.md and the SKILL.md files it references, versioned together:
//
//   /data/config/pipeline-definitions/        (git repo)
//     <id>/
//       pipeline.md
//       skills/<skill-name>/SKILL.md
//
// Lives under /data/config which is a persistent host mount, so the repo
// survives container recreates without a docker-compose change.
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
  return { id, name: titleize(id), content, stages: parseStages(content), skills };
}

// Write (create or overwrite) a definition and commit it.
export function writeDefinition(opts: {
  id: string;
  pipelineMd: string;
  skills?: Array<{ name: string; content: string }>;
  message?: string;
}): { sha: string } {
  ensureRepo();
  if (!safeId(opts.id)) throw new Error('Invalid definition id');
  const dir = path.join(DEFINITIONS_DIR, opts.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pipeline.md'), opts.pipelineMd || '');

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
  for (const s of def.skills) {
    const sdir = path.join(workspaceDir, '.claude', 'skills', s.name);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'SKILL.md'), s.content);
  }
  return true;
}

export function registerDefinitionRoutes(app: Express): void {
  app.get('/api/definitions', (_req: Request, res: Response) => {
    try { res.json({ definitions: listDefinitions() }); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get('/api/definitions/:id', (req: Request, res: Response) => {
    try {
      const def = getDefinition(req.params.id);
      if (!def) return res.status(404).json({ error: 'Definition not found' });
      res.json(def);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.post('/api/definitions', (req: Request, res: Response) => {
    try {
      const id = (req.body.id || '').trim();
      if (!safeId(id)) return res.status(400).json({ error: 'Invalid id (alphanumeric, - and _)' });
      if (fs.existsSync(path.join(DEFINITIONS_DIR, id))) return res.status(409).json({ error: 'Definition already exists' });
      const { sha } = writeDefinition({
        id,
        pipelineMd: typeof req.body.pipelineMd === 'string' ? req.body.pipelineMd : `# ${titleize(id)}\n\n## Stages\n`,
        skills: Array.isArray(req.body.skills) ? req.body.skills : [],
        message: `Create ${id}`,
      });
      res.json({ id, sha });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.put('/api/definitions/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const existing = getDefinition(id);
      if (!existing) return res.status(404).json({ error: 'Definition not found' });
      const pipelineMd = typeof req.body.pipelineMd === 'string' ? req.body.pipelineMd : existing.content;
      const skills = Array.isArray(req.body.skills) ? req.body.skills : existing.skills;
      const { sha } = writeDefinition({ id, pipelineMd, skills, message: req.body.message || `Update ${id}` });
      res.json({ id, sha });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.delete('/api/definitions/:id', (req: Request, res: Response) => {
    try { deleteDefinition(req.params.id); res.json({ status: 'deleted' }); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get('/api/definitions/:id/history', (req: Request, res: Response) => {
    try { res.json({ commits: getHistory(req.params.id) }); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get('/api/definitions/:id/commit/:sha', (req: Request, res: Response) => {
    try { res.type('text/plain').send(getCommitDiff(req.params.sha, req.params.id)); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });
}
