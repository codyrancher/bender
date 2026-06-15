// Git-backed global skill-definitions repo. A "skill" is a folder containing a
// SKILL.md plus any number of reference files / scripts / tools, versioned
// together:
//
//   /data/config/skill-definitions/        (git repo)
//     <id>/
//       SKILL.md            (required — the skill instructions)
//       scripts/run.mjs     (optional reference files / tools)
//       reference/notes.md
//
// Lives under /data/config which is a persistent host mount, so the repo
// survives container recreates without a docker-compose change.
import fs from 'fs';
import path from 'path';
import { HttpError } from '../utils/http';
import { SKILLS_DIR, repoGit, commitAll, ensureDefinitionsRepo } from './definitionsRepo';

// Skill definitions live under the `skills/` subdir of the shared definitions
// repo (see definitionsRepo.ts). git runs with cwd here so history/diff pathspecs
// scope to this subdir; commits go through commitAll (repo-wide).
const SKILL_DEFINITIONS_DIR = SKILLS_DIR;

const DEFAULT_SKILL_MD = (id: string) =>
  `---\nname: ${id}\ndescription: \n---\n\n# ${titleize(id)}\n\nDescribe what this skill does and when to use it.\n`;

const git = (args: string[]) => repoGit(args, SKILL_DEFINITIONS_DIR);
const gitCommit = (message: string) => commitAll(message);
const ensureRepo = ensureDefinitionsRepo;

function safeId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

// Relative file path inside a skill folder: forbid traversal and absolutes.
function safeRelPath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\0')) return false;
  const parts = p.split('/');
  if (parts.some(seg => seg === '..' || seg === '.' || seg === '')) return false;
  return parts.every(seg => /^[a-zA-Z0-9._-]+$/.test(seg));
}

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface SkillFile { path: string; content: string; binary: boolean }

// Recursively read all files within a skill folder as relative paths.
function readSkillFiles(skillDir: string): SkillFile[] {
  const out: SkillFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else {
        const buf = fs.readFileSync(abs);
        const binary = buf.includes(0);
        out.push({ path: relPath, content: binary ? '' : buf.toString('utf-8'), binary });
      }
    }
  };
  walk(skillDir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function listSkillDefinitions(): any[] {
  ensureRepo();
  const out: any[] = [];
  for (const entry of fs.readdirSync(SKILL_DEFINITIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name.startsWith('.')) continue;
    const skillMd = path.join(SKILL_DEFINITIONS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const files = readSkillFiles(path.join(SKILL_DEFINITIONS_DIR, entry.name));
    out.push({
      id: entry.name,
      name: titleize(entry.name),
      description: parseDescription(fs.readFileSync(skillMd, 'utf-8')),
      fileCount: files.length,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Pull the `description:` frontmatter value out of a SKILL.md, if present.
function parseDescription(md: string): string {
  const m = md.match(/^---\s*[\s\S]*?\bdescription:\s*(.+?)\s*$[\s\S]*?^---\s*$/m);
  return m ? m[1].trim() : '';
}

export function getSkillDefinition(id: string): any | null {
  ensureRepo();
  if (!safeId(id)) return null;
  const dir = path.join(SKILL_DEFINITIONS_DIR, id);
  const skillMd = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return null;
  const files = readSkillFiles(dir);
  return {
    id,
    name: titleize(id),
    description: parseDescription(fs.readFileSync(skillMd, 'utf-8')),
    files,
  };
}

// Write (create or overwrite) a skill definition and commit it. Files are
// replaced wholesale so removed files don't linger.
export function writeSkillDefinition(opts: {
  id: string;
  files: Array<{ path: string; content: string }>;
  message?: string;
}): { sha: string } {
  ensureRepo();
  if (!safeId(opts.id)) throw new Error('Invalid skill id');
  const files = (opts.files || []).filter(f => f && safeRelPath(f.path));
  if (!files.some(f => f.path === 'SKILL.md')) {
    throw new Error('A skill must contain a SKILL.md file');
  }
  const dir = path.join(SKILL_DEFINITIONS_DIR, opts.id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const dest = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content ?? '');
  }
  const sha = gitCommit(opts.message || `Update skill ${opts.id}`);
  return { sha };
}

export function deleteSkillDefinition(id: string): void {
  ensureRepo();
  if (!safeId(id)) throw new Error('Invalid skill id');
  fs.rmSync(path.join(SKILL_DEFINITIONS_DIR, id), { recursive: true, force: true });
  gitCommit(`Delete skill ${id}`);
}

// Commit history for a skill folder (or the whole repo if id omitted)
export function getSkillHistory(id?: string): any[] {
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

// Unified diff (git show) for a commit, scoped to a skill folder if given
export function getSkillCommitDiff(sha: string, id?: string): string {
  ensureRepo();
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return '';
  const args = ['show', sha];
  if (id && safeId(id)) args.push('--', id);
  return git(args).stdout || '';
}

// Create a new skill (defaulting to a stub SKILL.md). Throws HttpError on a bad
// id or an existing skill so the route handler stays a one-liner.
export function createSkillDefinition(body: any): { id: string; sha: string } {
  ensureRepo();
  const id = (body.id || '').trim();
  if (!safeId(id)) throw new HttpError(400, 'Invalid id (alphanumeric, - and _)');
  if (fs.existsSync(path.join(SKILL_DEFINITIONS_DIR, id))) throw new HttpError(409, 'Skill already exists');
  const files = Array.isArray(body.files) && body.files.length
    ? body.files
    : [{ path: 'SKILL.md', content: DEFAULT_SKILL_MD(id) }];
  return { id, ...writeSkillDefinition({ id, files, message: `Create skill ${id}` }) };
}

export function updateSkillDefinition(id: string, body: any): { id: string; sha: string } {
  const existing = getSkillDefinition(id);
  if (!existing) throw new HttpError(404, 'Skill not found');
  const files = Array.isArray(body.files) ? body.files : existing.files;
  return { id, ...writeSkillDefinition({ id, files, message: body.message || `Update skill ${id}` }) };
}
