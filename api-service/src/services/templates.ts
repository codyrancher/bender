import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Handlebars from 'handlebars';
import { bundledDir } from '../config/constants';

const TEMPLATES_DIR = bundledDir('templates');

export function getTemplateIds(): string[] {
  return getAvailableTemplates();
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  hasIcon: boolean;
  files: string[];
  path: string;
  keys?: TemplateKeyDef[];
}

export interface SidecarDef {
  suffix: string;
  image: string;
  env?: Record<string, string>;
  privileged?: boolean;
  shm_size?: string;
  network_container?: boolean | string;
  cap_add?: string[];
  volumes?: string[];
  entrypoint?: string;
  command?: string[];
}

export interface TemplateKeyDef {
  id: string;
  label: string;
  description: string;
  isText?: boolean;
  placeholder?: string;
}

export interface TemplateMeta {
  name?: string;
  description?: string;
  sidecars?: SidecarDef[];
  keys?: TemplateKeyDef[];
}

export interface BrowserPortConfig {
  port: number;
}

export const DEFAULT_BROWSER_PORT = 3000;

export const DEFAULT_BROWSER_SIDECAR: SidecarDef = {
  suffix: 'browser',
  image: 'lscr.io/linuxserver/chromium:latest',
  shm_size: '1gb',
  network_container: true,
  env: {
    PUID: '1000',
    PGID: '1000',
    CUSTOM_PORT: '3000',
    SELKIES_JPEG_QUALITY: '100',
    SELKIES_H264_FULLCOLOR: 'true',
    CHROME_CLI: '--no-first-run --start-maximized --disable-infobars --ignore-certificate-errors --force-dark-mode',
  },
};

function getAvailableTemplates(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

export function getTemplateMeta(templateId: string): TemplateMeta | null {
  const metaPath = path.join(TEMPLATES_DIR, templateId, 'template.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

export function getBrowserPort(templateId: string): number | null {
  const portPath = path.join(TEMPLATES_DIR, templateId, 'browser-port.json');
  if (!fs.existsSync(portPath)) return null;
  const config: BrowserPortConfig = JSON.parse(fs.readFileSync(portPath, 'utf-8'));
  return config.port;
}

// Raw (unrendered) CLAUDE.md source for a template — the `.hbs` that scaffolding
// renders into the workspace, falling back to a plain CLAUDE.md. Used to seed the
// default CLAUDE.md of a new pipeline definition. Returns '' if the template has none.
export function getTemplateClaudeMd(templateId: string): string {
  const dir = path.join(TEMPLATES_DIR, templateId);
  for (const name of ['CLAUDE.md.hbs', 'CLAUDE.md']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  }
  return '';
}

// Render a raw Handlebars string with the same vars used by scaffoldTemplate.
// Used to materialize a definition's CLAUDE.md into the workspace at run time.
export function renderString(content: string, vars: Record<string, string>): string {
  return Handlebars.compile(content)(vars);
}

const ALPHA_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ALPHA_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SAFE_SPECIAL = '@#%^&*_+-=';
const ALL_CHARS = ALPHA_LOWER + ALPHA_UPPER + DIGITS + SAFE_SPECIAL;

function generatePassword(length: number = 15): string {
  const required = [
    ALPHA_LOWER[crypto.randomInt(ALPHA_LOWER.length)],
    ALPHA_UPPER[crypto.randomInt(ALPHA_UPPER.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
    SAFE_SPECIAL[crypto.randomInt(SAFE_SPECIAL.length)],
  ];
  const remaining: string[] = [];
  for (let i = required.length; i < length; i++) {
    remaining.push(ALL_CHARS[crypto.randomInt(ALL_CHARS.length)]);
  }
  const all = [...required, ...remaining];
  for (let i = all.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join('');
}

function readGitConfig(): { gitName: string; gitEmail: string; githubToken: string } {
  const result = { gitName: '', gitEmail: '', githubToken: '' };

  try {
    const gitconfig = fs.readFileSync('/data/gitconfig', 'utf-8');
    const name = gitconfig.match(/name\s*=\s*(.+)/);
    const email = gitconfig.match(/email\s*=\s*(.+)/);
    if (name) result.gitName = name[1].trim();
    if (email) result.gitEmail = email[1].trim();
  } catch { /* gitconfig not available */ }

  try {
    const hostsYml = fs.readFileSync('/data/gh-config/hosts.yml', 'utf-8');
    const token = hostsYml.match(/oauth_token:\s*(\S+)/);
    if (token) result.githubToken = token[1].trim();
  } catch { /* gh config not available */ }

  return result;
}

export function getTemplateVars(projectName: string, _settingsKeys?: Record<string, string>): Record<string, string> {
  const git = readGitConfig();
  // NOTE: credentials (GitHub token, AppCo, Figma, cloud keys) are intentionally
  // NOT returned here. They are routed into the container as environment variables
  // (see credentialEnvArgs in routes.ts) so secrets are never written into the
  // scaffolded workspace files. Only non-secret identity values are templated.
  return {
    projectName,
    adminPassword: generatePassword(),
    userPassword1: generatePassword(),
    userPassword2: generatePassword(),
    userPassword3: generatePassword(),
    gitName: git.gitName,
    gitEmail: git.gitEmail,
  };
}

export function scaffoldTemplate(
  templateId: string,
  projectPath: string,
  vars: Record<string, string>,
): void {
  const templateDir = path.join(TEMPLATES_DIR, templateId);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const uid = 1000;
  const gid = 1000;

  copyDir(templateDir, projectPath, vars, uid, gid);
  fixOwnership(projectPath, uid, gid);
}

function copyDir(
  srcDir: string,
  destDir: string,
  vars: Record<string, string>,
  uid: number,
  gid: number,
): void {
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    // Skip metadata files
    if (entry.name === 'template.json' || entry.name === 'browser-port.json' || entry.name === 'icon.svg' || entry.name === 'CLAUDE.md') continue;
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, path.join(destDir, entry.name), vars, uid, gid);
    } else {
      let destName = entry.name;
      let content = fs.readFileSync(srcPath, 'utf-8');

      // .hbs files are processed through Handlebars, then written without the extension
      if (destName.endsWith('.hbs')) {
        destName = destName.slice(0, -4);
        const template = Handlebars.compile(content);
        content = template(vars);
      }

      const destPath = path.join(destDir, destName);
      fs.writeFileSync(destPath, content);
      fs.chownSync(destPath, uid, gid);

      if (destName === 'dev.sh' || destName.endsWith('.sh')) {
        fs.chmodSync(destPath, 0o755);
      }
    }
  }
}

function fixOwnership(dirPath: string, uid: number, gid: number): void {
  fs.chownSync(dirPath, uid, gid);
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    fs.chownSync(fullPath, uid, gid);
    if (entry.isDirectory()) {
      fixOwnership(fullPath, uid, gid);
    }
  }
}

// --- Template management ---

const METADATA_FILES = new Set(['template.json', 'browser-port.json', 'icon.svg', 'CLAUDE.md']);

function countTemplateFiles(templateDir: string): string[] {
  const files: string[] = [];
  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (prefix === '' && METADATA_FILES.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  }
  walk(templateDir, '');
  return files;
}
