import { Express, Request, Response } from 'express';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { TEMPLATE_IDS, getTemplateIds, scaffoldTemplate, getTemplateVars, getTemplateMeta, getBrowserPort, DEFAULT_BROWSER_SIDECAR, DEFAULT_BROWSER_PORT, SidecarDef, TemplateMeta, TemplateKeyDef, listTemplates, createTemplate, updateTemplateMeta, deleteTemplate, getTemplateIcon, setTemplateIcon, getTemplatePath } from './templates';
import { extractPipelineFlags } from './pipelineFlags';
import { broadcast } from './events';
import { materializeInto as materializeDefinition, writeDefinition } from './definitions';

const PIPELINES_DIR = '/data/pipelines';
const COMPOSE_PROJECT = 'bender';
// Shared, persistent Claude credential dir (the /data/credentials volume mounted
// into every pipeline container as /claude-data). Pointing CLAUDE_CONFIG_DIR here
// means a single sign-in authenticates every pipeline run.
const CLAUDE_CONFIG_DIR = '/claude-data';
const BENDER_IMAGE = 'bender-claude';
const NETWORK_NAME = 'bender_default';
const DATA_DIR = '/data';
const SETTINGS_PATH = '/data/config/settings.json';
// Maps sidecar suffix to the internal port to forward to
const EXTERNAL_PORT_TARGETS: Record<string, number> = {
  rancher: 443,
};
// Default values for settings keys (used when key is empty/unset)
const KEY_DEFAULTS: Record<string, string> = {
  rancherTag: 'head',
};

// Configurable keys are now sourced from environment variables (see .env.example)
// rather than a settings UI. Maps the template/settings key id → env var name.
const ENV_KEY_MAP: Record<string, string> = {
  figmaApiKey: 'FIGMA_API_KEY',
  appcoEmail: 'APPCO_EMAIL',
  appcoToken: 'APPCO_TOKEN',
  rancherTag: 'RANCHER_TAG',
};

function envKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [keyId, envName] of Object.entries(ENV_KEY_MAP)) {
    const v = process.env[envName];
    if (v) out[keyId] = v;
  }
  return out;
}

// Credentials forwarded into project containers as environment variables.
// They are NEVER written into scaffolded files — tooling inside the container
// reads them straight from the environment.
const CONTAINER_CRED_ENV = [
  'ANTHROPIC_API_KEY', // authenticates the Claude CLI that executes pipeline stages
  'FIGMA_API_KEY',
  'APPCO_EMAIL',
  'APPCO_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
  'DIGITALOCEAN_ACCESS_TOKEN',
];

// The GitHub token comes from the env if set, otherwise the mounted gh config.
function readGithubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const hostsYml = fs.readFileSync('/data/gh-config/hosts.yml', 'utf-8');
    const m = hostsYml.match(/oauth_token:\s*(\S+)/);
    if (m) return m[1].trim();
  } catch { /* gh config not available */ }
  return '';
}

// Build `-e KEY=value` docker args for every credential present in the env.
function credentialEnvArgs(): string[] {
  const args: string[] = [];
  for (const name of CONTAINER_CRED_ENV) {
    const v = process.env[name];
    if (v) args.push('-e', `${name}=${v}`);
  }
  const ghToken = readGithubToken();
  if (ghToken) {
    args.push('-e', `GITHUB_TOKEN=${ghToken}`);
    args.push('-e', `GH_TOKEN=${ghToken}`);
  }
  return args;
}

let cachedExternalIp: string | null = null;
let ipCacheTime = 0;
const IP_CACHE_TTL = 300_000; // 5 minutes

async function getExternalIp(): Promise<string> {
  if (cachedExternalIp && Date.now() - ipCacheTime < IP_CACHE_TTL) {
    return cachedExternalIp;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://api.ipify.org', { signal: controller.signal });
    clearTimeout(timeout);
    cachedExternalIp = (await resp.text()).trim();
    ipCacheTime = Date.now();
    return cachedExternalIp;
  } catch {
    return cachedExternalIp || 'unavailable';
  }
}

interface PortRange {
  start: number;
  end: number;
}

interface Settings {
  portRange: PortRange;
  keys?: Record<string, string>;
  templateKeys?: Record<string, Record<string, string>>;
}

function readSettings(): Settings {
  const defaults: Settings = { portRange: { start: 8200, end: 8299 } };
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function writeSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function chownRecursive(target: string, uid: number, gid: number): void {
  try {
    fs.chownSync(target, uid, gid);
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        chownRecursive(path.join(target, entry), uid, gid);
      }
    }
  } catch { /* best-effort */ }
}

function getContainerStatus(containerName: string): string {
  try {
    const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', containerName], {
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      return result.stdout.trim() === 'true' ? 'running' : 'stopped';
    }
    return 'not_found';
  } catch {
    return 'error';
  }
}

interface BenderJson {
  template?: string;
  sidecars: string[];
  browserPort?: number;
  browserHost?: string;
  externalPorts?: Record<string, number>;
  vars?: Record<string, string>;
  args?: Record<string, string>;
}

// Build `-e NAME=value` docker args from user-supplied pipeline args (declared
// by the definition's "## Args" section). Only valid env-var names are passed.
function pipelineArgEnvArgs(args: unknown): string[] {
  const out: string[] = [];
  if (args && typeof args === 'object') {
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v) out.push('-e', `${k}=${v}`);
    }
  }
  return out;
}

function readBenderJson(project: string): BenderJson | null {
  const filePath = path.join(PIPELINES_DIR, project, '.bender.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

interface PipelineStage {
  name: string;
  skill: string;
  description: string;
  successCriteria: string;
  // Names of successor stages from "**Next:**" (parallel fork). Resolved to
  // indices in `next` by resolveGraph(). Empty `next` = terminal (an end state).
  nextNames: string[];
  next: number[];
}

function parsePipelineStages(markdown: string): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const lines = markdown.split('\n');
  let current: Partial<PipelineStage> | null = null;
  let descLines: string[] = [];

  const flush = () => {
    if (current?.name && current?.skill) {
      stages.push({
        name: current.name,
        skill: current.skill,
        description: descLines.join(' ').trim(),
        successCriteria: current.successCriteria || '',
        nextNames: current.nextNames || [],
        next: [],
      });
    }
  };

  for (const line of lines) {
    const stageMatch = line.match(/^###\s+\d+\.\s+(.+)/);
    if (stageMatch) {
      flush();
      current = { name: stageMatch[1].trim(), nextNames: [] };
      descLines = [];
      continue;
    }
    if (current) {
      const skillMatch = line.match(/^\*\*Skill:\*\*\s*(.+)/);
      if (skillMatch) {
        current.skill = skillMatch[1].trim();
        continue;
      }
      const criteriaMatch = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/);
      if (criteriaMatch) {
        current.successCriteria = criteriaMatch[1].trim();
        continue;
      }
      // "**Next:**" declares one or more successor stages (comma-separated = parallel fork)
      const nextMatch = line.match(/^\*\*Next:\*\*\s*(.+)/);
      if (nextMatch) {
        current.nextNames = nextMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        continue;
      }
      const trimmed = line.trim();
      if (trimmed) descLines.push(trimmed);
    }
  }
  flush();
  resolveGraph(stages);
  return stages;
}

// Resolve successor names → indices. If NO stage declares "**Next:**", fall back
// to a linear chain (i → i+1) for backward compatibility.
function resolveGraph(stages: PipelineStage[]): void {
  const byName = new Map<string, number>();
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i));
  const anyEdges = stages.some(s => s.nextNames.length);

  stages.forEach((s, i) => {
    if (anyEdges) {
      s.next = s.nextNames
        .map(n => byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1)
        .filter(idx => idx >= 0);
    } else {
      // linear default
      s.next = i < stages.length - 1 ? [i + 1] : [];
    }
  });
}

function readPipelineStages(project: string): PipelineStage[] {
  const mdPath = path.join(PIPELINES_DIR, project, 'pipeline.md');
  if (!fs.existsSync(mdPath)) return [];
  try {
    return parsePipelineStages(fs.readFileSync(mdPath, 'utf-8'));
  } catch { return []; }
}

function getSidecarContainerNames(pipeline: string): string[] {
  const meta = readBenderJson(pipeline);
  if (!meta?.sidecars) return [];
  return meta.sidecars.map(suffix => `${COMPOSE_PROJECT}-${pipeline}-${suffix}-1`);
}

function startSidecars(pipeline: string, sidecars?: SidecarDef[]): void {
  const project = pipeline;
  if (!sidecars) {
    const meta = readBenderJson(pipeline);
    if (!meta) return;
    if (meta.template) {
      const tmpl = getTemplateMeta(meta.template);
      if (!tmpl?.sidecars) return;
      sidecars = tmpl.sidecars;
    } else {
      // Non-template project: use default browser sidecar
      sidecars = meta.sidecars.includes('browser') ? [DEFAULT_BROWSER_SIDECAR] : [];
    }
    if (!sidecars.length) return;
  }

  const settings = readSettings();

  for (const sidecar of sidecars) {
    const containerName = `${COMPOSE_PROJECT}-${project}-${sidecar.suffix}-1`;
    const alias = `${project}-${sidecar.suffix}`;
    const status = getContainerStatus(containerName);

    if (status === 'stopped') {
      spawn('docker', ['start', containerName], { stdio: 'ignore', detached: true }).unref();
    } else if (status === 'not_found') {
      const projectContainer = `${COMPOSE_PROJECT}-${project}-1`;
      const args = [
        'run', '-d',
        '--name', containerName,
        '--restart', 'unless-stopped',
      ];
      if (sidecar.network_container) {
        const netTarget = typeof sidecar.network_container === 'string'
          ? `${COMPOSE_PROJECT}-${project}-${sidecar.network_container}-1`
          : projectContainer;
        args.push('--network', `container:${netTarget}`);
      } else {
        args.push('--network', NETWORK_NAME, '--network-alias', alias);
      }
      if (sidecar.privileged) {
        args.push('--privileged');
      }
      if (sidecar.shm_size) args.push('--shm-size', sidecar.shm_size);
      if (sidecar.cap_add) {
        for (const cap of sidecar.cap_add) {
          args.push('--cap-add', cap);
        }
      }
      if (sidecar.volumes) {
        for (const vol of sidecar.volumes) {
          const v = vol.replace(/\{\{projectName\}\}/g, project);
          args.push('-v', v);
        }
      }
      if (sidecar.entrypoint) args.push('--entrypoint', sidecar.entrypoint);
      if (sidecar.env) {
        const meta = readBenderJson(pipeline);
        const tplKeys = meta?.template ? settings.templateKeys?.[meta.template] : undefined;
        const env = envKeys();
        for (const [k, v] of Object.entries(sidecar.env)) {
          let value = v.replace(/\{\{projectName\}\}/g, project);
          value = value.replace(/\{\{settings\.(\w+)\}\}/g, (_match: string, key: string) => {
            return env[key] || tplKeys?.[key] || settings.keys?.[key] || KEY_DEFAULTS[key] || '';
          });
          value = value.replace(/\{\{harness\.(\w+)\}\}/g, (_match: string, key: string) => {
            return meta?.vars?.[key] || '';
          });
          args.push('-e', `${k}=${value}`);
        }
      }
      // Project-name keyword flags (pr-#, issue-#, prime) are independent —
      // any combination can appear anywhere in the name. See pipelineFlags.ts.
      const flags = extractPipelineFlags(project);
      if (sidecar.suffix === 'browser' && flags.issueNumber) {
        const idx = args.findIndex(a => a.startsWith('CHROME_CLI='));
        if (idx !== -1) {
          args[idx] += ` https://github.com/rancher/dashboard/issues/${flags.issueNumber}`;
        }
      }
      if (sidecar.suffix === 'rancher' && flags.prime) {
        args.push('-e', 'RANCHER_VERSION_TYPE=prime');
        args.push('-e', 'CATTLE_BASE_UI_BRAND=suse');
      }
      // Interpolate {{settings.*}} in image field — per-project vars override template keys override global settings
      const projectMeta = readBenderJson(pipeline);
      const imgTplKeys = projectMeta?.template ? settings.templateKeys?.[projectMeta.template] : undefined;
      const imgEnv = envKeys();
      let image = sidecar.image.replace(/\{\{settings\.(\w+)\}\}/g, (_match: string, key: string) => {
        return projectMeta?.vars?.[key] || imgEnv[key] || imgTplKeys?.[key] || settings.keys?.[key] || KEY_DEFAULTS[key] || '';
      });
      args.push(image);
      if (sidecar.command) {
        args.push(...sidecar.command);
      }
      console.log(`Starting sidecar ${containerName}: docker ${args.join(' ')}`);
      const proc = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('exit', (code: number | null) => {
        if (code !== 0) console.error(`Sidecar ${containerName} failed (exit ${code}): ${stderr}`);
      });
      proc.unref();
    }
  }
}

function stopSidecars(project: string): void {
  for (const name of getSidecarContainerNames(project)) {
    spawnSync('docker', ['stop', name], { encoding: 'utf-8' });
  }
}

function removeSidecars(project: string): void {
  for (const name of getSidecarContainerNames(project)) {
    spawnSync('docker', ['stop', name], { encoding: 'utf-8' });
    spawnSync('docker', ['rm', name], { encoding: 'utf-8' });
  }
}

function findNextAvailablePort(): number | null {
  const settings = readSettings();
  const usedPorts = new Set<number>();

  if (fs.existsSync(PIPELINES_DIR)) {
    for (const name of fs.readdirSync(PIPELINES_DIR)) {
      const fullPath = path.join(PIPELINES_DIR, name);
      if (!fs.statSync(fullPath).isDirectory()) continue;
      const meta = readBenderJson(name);
      if (meta?.externalPorts) {
        for (const port of Object.values(meta.externalPorts)) {
          usedPorts.add(port);
        }
      }
    }
  }

  for (let port = settings.portRange.start; port <= settings.portRange.end; port++) {
    if (!usedPorts.has(port)) return port;
  }
  return null;
}

function getContainerIp(containerName: string): string | null {
  const result = spawnSync('docker', [
    'inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', containerName,
  ], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const ip = result.stdout.trim();
  return ip || null;
}

function waitForContainerIp(containerName: string, timeout = 30000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const ip = getContainerIp(containerName);
      if (ip) return resolve(ip);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(check, 1000);
    };
    check();
  });
}

function stopPortForward(port: number): void {
  const name = `port-forward-${port}`;
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf-8', stdio: 'ignore' });
}

function startPortForwardAsync(port: number, targetContainer: string, targetPort: number): void {
  (async () => {
    const ip = await waitForContainerIp(targetContainer);
    if (!ip) {
      console.error(`Failed to get IP for ${targetContainer}, skipping port forward on ${port}`);
      return;
    }
    stopPortForward(port);
    const name = `port-forward-${port}`;
    const result = spawnSync('docker', [
      'run', '-d',
      '--name', name,
      '--network', NETWORK_NAME,
      '-p', `${port}:${port}`,
      '--restart', 'unless-stopped',
      'alpine/socat',
      `TCP-LISTEN:${port},fork,reuseaddr`,
      `TCP:${ip}:${targetPort}`,
    ], { encoding: 'utf-8' });
    if (result.status !== 0) {
      console.error(`Failed to start port forward for port ${port}: ${result.stderr}`);
      return;
    }
    console.log(`Port forward: 0.0.0.0:${port} -> ${ip}:${targetPort} (${targetContainer})`);
  })();
}

function startPortForwardsForProject(project: string): void {
  const meta = readBenderJson(project);
  if (!meta?.externalPorts) return;
  for (const [service, port] of Object.entries(meta.externalPorts)) {
    const targetPort = EXTERNAL_PORT_TARGETS[service];
    if (!targetPort) continue;
    const containerName = `${COMPOSE_PROJECT}-${project}-${service}-1`;
    startPortForwardAsync(port, containerName, targetPort);
  }
}

function stopPortForwardsForProject(project: string): void {
  const meta = readBenderJson(project);
  if (!meta?.externalPorts) return;
  for (const port of Object.values(meta.externalPorts)) {
    stopPortForward(port);
  }
}

export function initPortForwards(): void {
  if (!fs.existsSync(PIPELINES_DIR)) return;
  for (const name of fs.readdirSync(PIPELINES_DIR)) {
    const fullPath = path.join(PIPELINES_DIR, name);
    if (!fs.statSync(fullPath).isDirectory()) continue;
    const containerName = `${COMPOSE_PROJECT}-${name}-1`;
    if (getContainerStatus(containerName) !== 'running') continue;
    startPortForwardsForProject(name);
  }
}

function runInitScript(project: string): void {
  const initScript = path.join(PIPELINES_DIR, project, 'init.sh');
  if (!fs.existsSync(initScript)) return;
  const containerName = `${COMPOSE_PROJECT}-${project}-1`;
  spawn('docker', [
    'exec', '-d', '-u', '1000:1000', containerName, 'bash', '-c',
    'chmod +x /workspace/init.sh && /workspace/init.sh > /workspace/.init.log 2>&1',
  ], { stdio: 'ignore', detached: true }).unref();
}

// Run the on-sidecars-up.sh hook (if present) inside the project container.
// This is called whenever sidecars transition from stopped → running.
function runSidecarsUpScript(project: string): void {
  const hookScript = path.join(PIPELINES_DIR, project, 'on-sidecars-up.sh');
  if (!fs.existsSync(hookScript)) return;
  const containerName = `${COMPOSE_PROJECT}-${project}-1`;
  if (getContainerStatus(containerName) !== 'running') return;
  spawn('docker', [
    'exec', '-d', '-u', '1000:1000', containerName, 'bash', '-c',
    'chmod +x /workspace/on-sidecars-up.sh && /workspace/on-sidecars-up.sh > /workspace/.on-sidecars-up.log 2>&1',
  ], { stdio: 'ignore', detached: true }).unref();
}

export function registerRoutes(app: Express): void {
  // List all projects
  app.get('/api/pipelines', (_req: Request, res: Response) => {
    try {
      const pipelines: Array<{
        name: string;
        container: string;
        status: string;
        template?: string;
        browserPort?: number;
        browserHost?: string;
        stages?: PipelineStage[];
      }> = [];
      if (fs.existsSync(PIPELINES_DIR)) {
        const entries = fs.readdirSync(PIPELINES_DIR).sort();
        for (const name of entries) {
          const fullPath = path.join(PIPELINES_DIR, name);
          if (fs.statSync(fullPath).isDirectory()) {
            const containerName = `${COMPOSE_PROJECT}-${name}-1`;
            const status = getContainerStatus(containerName);
            const meta = readBenderJson(name);
            const browserPort = meta?.browserPort ?? (meta?.template ? getBrowserPort(meta.template) : null);

            const stages = readPipelineStages(name);
            pipelines.push({
              name,
              container: containerName,
              status,
              ...(meta?.template && { template: meta.template }),
              ...(browserPort && { browserPort }),
              ...(meta?.browserHost && { browserHost: meta.browserHost }),
              ...(stages.length && { stages }),
            });
          }
        }
      }
      res.json({ pipelines });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Create a new project
  app.post('/api/pipelines', async (req: Request, res: Response) => {
    try {
      const projectName = (req.body.name || '').trim();

      if (!projectName) {
        res.status(400).json({ error: 'Project name is required' });
        return;
      }

      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectName)) {
        res.status(400).json({ error: 'Invalid project name. Use alphanumeric, hyphens, underscores only.' });
        return;
      }

      const projectPath = path.join(PIPELINES_DIR, projectName);

      if (fs.existsSync(projectPath)) {
        res.status(400).json({ error: 'Project already exists' });
        return;
      }

      fs.mkdirSync(projectPath, { mode: 0o755, recursive: true });
      fs.chownSync(projectPath, 1000, 1000);

      if (req.body.definitionId) {
        // Bundle pipeline.md + skills from the global definitions repo
        materializeDefinition(req.body.definitionId, projectPath);
        chownRecursive(projectPath, 1000, 1000);
      } else if (req.body.pipelineMd) {
        const mdPath = path.join(projectPath, 'pipeline.md');
        fs.writeFileSync(mdPath, req.body.pipelineMd);
        fs.chownSync(mdPath, 1000, 1000);
      }

      // Every pipeline gets the rancher-dashboard template environment by default
      // (CLAUDE.md with Rancher instructions, browser.mjs, wait-for-sidecars, the
      // rancher + browser sidecars, setup-rancher.sh) — definition-based pipelines
      // included — unless a specific template is requested. This is the same
      // sidecar/CLAUDE.md setup inherited from claude-harness.
      const requestedTemplate = (req.body.template || '').trim();
      const template = requestedTemplate || (getTemplateIds().includes('rancher-dashboard') ? 'rancher-dashboard' : '');
      const requestVars: Record<string, string> = req.body.vars || {};
      const settings = readSettings();
      // Keys are sourced from env vars (see .env.example); fall back to any
      // legacy settings/template keys for backward compatibility.
      const effectiveKeys = { ...settings.keys, ...(template ? settings.templateKeys?.[template] : {}), ...envKeys() };
      const vars = getTemplateVars(projectName, effectiveKeys);

      // Allocate external port for rancher templates
      let allocatedPort: number | null = null;
      if (template === 'rancher-dashboard') {
        allocatedPort = findNextAvailablePort();
        if (allocatedPort) {
          const ip = await getExternalIp();
          vars.rancherPublicUrl = `https://${ip}:${allocatedPort}`;
        }
      }

      // Merge request vars into template vars for Handlebars rendering
      if (requestVars.nodeVersion) vars.nodeVersion = requestVars.nodeVersion;

      // Expose project-name keyword flags to the template (issueNumber is
      // used by CLAUDE.md.hbs; add more as needed).
      const pipelineFlags = extractPipelineFlags(projectName);
      if (pipelineFlags.issueNumber) vars.issueNumber = pipelineFlags.issueNumber;
      if (pipelineFlags.prNumber) vars.prNumber = pipelineFlags.prNumber;
      if (pipelineFlags.prime) vars.prime = 'true';

      if (template && getTemplateIds().includes(template)) {
        scaffoldTemplate(template, projectPath, vars);
      }

      const containerName = `${COMPOSE_PROJECT}-${projectName}-1`;

      const result = spawnSync('docker', [
        'run', '-d',
        '--name', containerName,
        '--network', NETWORK_NAME,
        '--network-alias', projectName,
        '--restart', 'unless-stopped',
        '-e', 'PUID=1000',
        '-e', 'PGID=1000',
        '-e', 'CLAUDE_CODE_SKIP_PERMISSIONS_DISCLAIMER=1',
        '-e', `PROJECT_NAME=${projectName}`,
        '-e', `CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}`,
        ...credentialEnvArgs(),
        ...pipelineArgEnvArgs(req.body.args),
        '-v', `${PIPELINES_DIR}/${projectName}:/workspace`,
        '-v', `${DATA_DIR}/credentials:/claude-data`,
        '-v', `${DATA_DIR}/config:/claude-config`,
        BENDER_IMAGE,
      ], { encoding: 'utf-8' });

      if (result.status !== 0) {
        fs.rmdirSync(projectPath);
        res.status(500).json({ error: `Failed to create container: ${result.stderr}` });
        return;
      }

      // Determine sidecars: from template or default browser
      let sidecars: SidecarDef[] = [];
      if (template) {
        const tmpl = getTemplateMeta(template);
        sidecars = tmpl?.sidecars || [];
      }
      if (!sidecars.some(s => s.suffix === 'browser')) {
        sidecars.push(DEFAULT_BROWSER_SIDECAR);
      }

      const browserPort = template ? (getBrowserPort(template) ?? DEFAULT_BROWSER_PORT) : DEFAULT_BROWSER_PORT;
      const browserSidecar = sidecars.find(s => s.suffix === 'browser');
      const browserNetHost = typeof browserSidecar?.network_container === 'string'
        ? `${projectName}-${browserSidecar.network_container}`
        : undefined;

      const projectVars: Record<string, string> = {};
      if (vars.adminPassword) projectVars.adminPassword = vars.adminPassword;
      if (requestVars.rancherTag) projectVars.rancherTag = requestVars.rancherTag;
      if (requestVars.nodeVersion) projectVars.nodeVersion = requestVars.nodeVersion;

      // Declared pipeline args (passed into the container as env vars above) —
      // persist them on the project for reference.
      const pipelineArgs: Record<string, string> = {};
      if (req.body.args && typeof req.body.args === 'object') {
        for (const [k, v] of Object.entries(req.body.args as Record<string, unknown>)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v) pipelineArgs[k] = v;
        }
      }

      const harnessJson: BenderJson = {
        ...(template && { template }),
        sidecars: sidecars.map(s => s.suffix),
        browserPort,
        ...(browserNetHost && { browserHost: browserNetHost }),
        ...(allocatedPort && { externalPorts: { rancher: allocatedPort } }),
        ...(Object.keys(projectVars).length && { vars: projectVars }),
        ...(Object.keys(pipelineArgs).length && { args: pipelineArgs }),
      };
      const harnessPath = path.join(projectPath, '.bender.json');
      fs.writeFileSync(harnessPath, JSON.stringify(harnessJson, null, 2));
      fs.chownSync(harnessPath, 1000, 1000);

      // Allow callers to skip sidecar startup (useful when batch-creating
      // projects and only spinning up sidecars on demand). Defaults to true
      // for backward compatibility.
      const shouldStartSidecars = req.body.startSidecars !== false;
      if (shouldStartSidecars) {
        startSidecars(projectName, sidecars);
        if (allocatedPort) {
          startPortForwardsForProject(projectName);
        }
      }

      runInitScript(projectName);

      if (shouldStartSidecars) {
        runSidecarsUpScript(projectName);
        injectStoredCookies(projectName);
      }

      broadcast('pipelines-changed');
      res.json({
        status: 'created',
        pipeline: projectName,
        container: containerName,
        sidecarsStarted: shouldStartSidecars,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get project status
  app.get('/api/status/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    const status = getContainerStatus(containerName);
    res.json({ project, status });
  });

  // Start a project container
  app.post('/api/start/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    try {
      const status = getContainerStatus(containerName);

      if (status === 'not_found') {
        const projectPath = path.join(PIPELINES_DIR, project);
        if (!fs.existsSync(projectPath)) {
          res.status(404).json({ error: 'Project directory not found' });
          return;
        }

        const result = spawnSync('docker', [
          'run', '-d',
          '--name', containerName,
          '--network', NETWORK_NAME,
          '--network-alias', project,
          '--restart', 'unless-stopped',
          '-e', 'PUID=1000',
          '-e', 'PGID=1000',
          '-e', 'CLAUDE_CODE_SKIP_PERMISSIONS_DISCLAIMER=1',
          '-e', `PROJECT_NAME=${project}`,
          '-v', `${PIPELINES_DIR}/${project}:/workspace`,
          '-v', `${DATA_DIR}/credentials:/claude-data`,
          '-v', `${DATA_DIR}/config:/claude-config`,
          BENDER_IMAGE,
        ], { encoding: 'utf-8' });

        if (result.status !== 0) {
          res.status(500).json({ error: `Failed to create container: ${result.stderr}` });
          return;
        }

        startSidecars(project);
        startPortForwardsForProject(project);
        runInitScript(project);
        runSidecarsUpScript(project);
        injectStoredCookies(project);
        broadcast('pipelines-changed');
        res.json({ status: 'created', project });
      } else {
        const result = spawnSync('docker', ['start', containerName], { encoding: 'utf-8' });
        if (result.status !== 0) {
          res.status(500).json({ error: String(result.stderr) });
          return;
        }
        startSidecars(project);
        startPortForwardsForProject(project);
        runInitScript(project);
        runSidecarsUpScript(project);
        injectStoredCookies(project);
        broadcast('pipelines-changed');
        res.json({ status: 'started', project });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop a project container
  app.post('/api/stop/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    try {
      stopPortForwardsForProject(project);
      stopSidecars(project);
      const result = spawnSync('docker', ['stop', containerName], { encoding: 'utf-8' });
      if (result.status !== 0) {
        res.status(500).json({ error: String(result.stderr) });
        return;
      }
      broadcast('pipelines-changed');
      res.json({ status: 'stopped', project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Restart a project container
  app.post('/api/restart/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    try {
      const result = spawnSync('docker', ['restart', containerName], { encoding: 'utf-8' });
      if (result.status !== 0) {
        res.status(500).json({ error: String(result.stderr) });
        return;
      }
      startSidecars(project);
      startPortForwardsForProject(project);
      runInitScript(project);
      runSidecarsUpScript(project);
      injectStoredCookies(project);
      broadcast('pipelines-changed');
      res.json({ status: 'restarted', project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Reprovision sidecars (stop+remove existing, recreate fresh)
  app.post('/api/reprovision/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    try {
      // Kill any running init.sh / setup-rancher.sh processes so they don't
      // linger waiting for a sidecar that's about to be removed
      spawnSync('docker', [
        'exec', containerName, 'bash', '-c',
        'pkill -f "init.sh" 2>/dev/null; pkill -f "setup-rancher.sh" 2>/dev/null; true',
      ], { encoding: 'utf-8' });
      // Remove the setup-done marker so init will re-run setup against the fresh sidecar
      spawnSync('docker', [
        'exec', containerName, 'rm', '-f', '/workspace/.rancher-setup-done',
      ], { encoding: 'utf-8' });
      removeSidecars(project);
      startSidecars(project);
      startPortForwardsForProject(project);
      runInitScript(project);
      runSidecarsUpScript(project);
      injectStoredCookies(project);
      broadcast('pipelines-changed');
      res.json({ status: 'reprovisioned', project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Start sidecars only (project container must already exist). Useful for
  // projects that were created with startSidecars=false.
  app.post('/api/sidecars/start/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    try {
      if (!fs.existsSync(path.join(PIPELINES_DIR, project))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      // Make sure the main container is running so the on-sidecars-up hook
      // has somewhere to execute.
      const status = getContainerStatus(containerName);
      if (status === 'stopped') {
        spawnSync('docker', ['start', containerName], { encoding: 'utf-8' });
      } else if (status === 'not_found') {
        res.status(400).json({ error: 'Project container does not exist — call /api/start first' });
        return;
      }
      startSidecars(project);
      startPortForwardsForProject(project);
      runSidecarsUpScript(project);
      injectStoredCookies(project);
      res.json({ status: 'sidecars-started', project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop sidecars only — leaves the project container running.
  app.post('/api/sidecars/stop/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    try {
      if (!fs.existsSync(path.join(PIPELINES_DIR, project))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      stopPortForwardsForProject(project);
      stopSidecars(project);
      res.json({ status: 'sidecars-stopped', project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Delete a project (streams SSE logs for shutdown script progress)
  app.delete('/api/pipelines/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    function sendEvent(type: string, message?: string) {
      const data = message !== undefined ? { type, message } : { type };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    function runShutdownScript(): Promise<void> {
      return new Promise((resolve) => {
        // Check if shutdown script exists in the running container
        const check = spawnSync('docker', [
          'exec', containerName, 'test', '-f', '/workspace/shutdown.sh',
        ], { encoding: 'utf-8' });

        if (check.status !== 0) {
          resolve();
          return;
        }

        sendEvent('log', 'Running shutdown script...');

        const timeout = setTimeout(() => {
          sendEvent('log', 'Shutdown script timed out, proceeding with deletion...');
          proc.kill();
          resolve();
        }, 300_000); // 5 minute timeout

        const proc = spawn('docker', [
          'exec', '-u', '1000:1000', containerName,
          'bash', '/workspace/shutdown.sh',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let buffer = '';
        function processOutput(chunk: Buffer) {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) sendEvent('log', line);
          }
        }

        proc.stdout?.on('data', processOutput);
        proc.stderr?.on('data', processOutput);

        proc.on('close', () => {
          clearTimeout(timeout);
          if (buffer.trim()) sendEvent('log', buffer.trim());
          resolve();
        });
      });
    }

    (async () => {
      try {
        // Run shutdown script before teardown (sidecars still running)
        if (getContainerStatus(containerName) === 'running') {
          await runShutdownScript();
        }

        sendEvent('log', 'Stopping containers...');
        stopPortForwardsForProject(project);
        removeSidecars(project);
        spawnSync('docker', ['stop', containerName], { encoding: 'utf-8' });
        spawnSync('docker', ['rm', containerName], { encoding: 'utf-8' });

        sendEvent('log', 'Removing project files...');
        const projectPath = path.join(PIPELINES_DIR, project);
        if (fs.existsSync(projectPath)) {
          fs.rmSync(projectPath, { recursive: true, force: true });
        }

        const rancherDataPath = path.join(DATA_DIR, 'rancher-data', project);
        if (fs.existsSync(rancherDataPath)) {
          fs.rmSync(rancherDataPath, { recursive: true, force: true });
        }

        broadcast('pipelines-changed');
        sendEvent('done');
      } catch (err) {
        sendEvent('error', String(err));
      } finally {
        res.end();
      }
    })();
  });

  // --- Pipeline definitions ---

  const DEFINITIONS_DIR = path.join(__dirname, '..', 'pipeline-definitions');

  app.get('/api/pipeline-definitions', (_req: Request, res: Response) => {
    try {
      const files = fs.readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith('.pipeline.md'));
      const definitions = files.map(f => {
        const content = fs.readFileSync(path.join(DEFINITIONS_DIR, f), 'utf-8');
        return {
          id: f.replace('.pipeline.md', ''),
          name: f.replace('.pipeline.md', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          filename: f,
          stages: parsePipelineStages(content),
        };
      });
      res.json({ definitions });
    } catch {
      res.json({ definitions: [] });
    }
  });

  app.get('/api/pipeline-definitions/:id', (req: Request, res: Response) => {
    try {
      const filePath = path.join(DEFINITIONS_DIR, `${req.params.id}.pipeline.md`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Pipeline definition not found' });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ id: req.params.id, content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Pipeline runs (execution records) ---

  const DB_PATH = path.join(DATA_DIR, 'config', 'runs.db');
  let runsDb: Database.Database;

  function getRunsDb(): Database.Database {
    if (!runsDb) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      runsDb = new Database(DB_PATH);
      runsDb.pragma('journal_mode = WAL');
      runsDb.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          pipeline_md TEXT
        );
        CREATE TABLE IF NOT EXISTS pipeline_stage_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
          stage_index INTEGER NOT NULL,
          stage_name TEXT NOT NULL,
          skill TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT,
          completed_at TEXT,
          duration_ms INTEGER,
          error TEXT,
          success_criteria TEXT,
          success_criteria_met INTEGER DEFAULT 0,
          logs TEXT,
          artifacts TEXT,
          skill_md TEXT,
          next_indices TEXT,
          UNIQUE(run_id, stage_index)
        );
        CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON pipeline_runs(pipeline);
        CREATE INDEX IF NOT EXISTS idx_stages_run ON pipeline_stage_records(run_id);
      `);

      // Migrate older tables that predate later columns
      const cols = runsDb.prepare('PRAGMA table_info(pipeline_stage_records)').all() as { name: string }[];
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('logs')) runsDb.exec('ALTER TABLE pipeline_stage_records ADD COLUMN logs TEXT');
      if (!colNames.has('artifacts')) runsDb.exec('ALTER TABLE pipeline_stage_records ADD COLUMN artifacts TEXT');
      if (!colNames.has('skill_md')) runsDb.exec('ALTER TABLE pipeline_stage_records ADD COLUMN skill_md TEXT');
      if (!colNames.has('next_indices')) runsDb.exec('ALTER TABLE pipeline_stage_records ADD COLUMN next_indices TEXT');
      const runCols = runsDb.prepare('PRAGMA table_info(pipeline_runs)').all() as { name: string }[];
      if (!new Set(runCols.map(c => c.name)).has('pipeline_md')) runsDb.exec('ALTER TABLE pipeline_runs ADD COLUMN pipeline_md TEXT');

      // Any run/stage left 'running' belongs to a prior process — mark it cancelled
      runsDb.exec(`
        UPDATE pipeline_stage_records SET status = 'cancelled' WHERE status IN ('running', 'pending') AND run_id IN (SELECT id FROM pipeline_runs WHERE status = 'running');
        UPDATE pipeline_runs SET status = 'cancelled' WHERE status = 'running';
      `);
    }
    return runsDb;
  }

  // --- Stage execution simulator ---
  // Tracks in-flight runs so they can be cancelled mid-execution.
  const activeRuns = new Map<number, { cancelled: boolean }>();

  const LOG_VERBS = ['Scanning', 'Analyzing', 'Checking', 'Processing', 'Evaluating', 'Inspecting', 'Building', 'Resolving', 'Fetching', 'Compiling'];
  const LOG_TARGETS = ['src/index.ts', 'package.json', 'components/App.vue', 'utils/helpers.ts', 'node_modules', 'config.yaml', 'dist/bundle.js', 'tests/unit', 'api/routes.ts', 'styles/theme.css'];
  const LOG_RESULTS = ['ok', 'done', '3 issues found', 'no problems', 'passed', '1 warning', 'cached', 'skipped'];
  const ERRORS = ['Exit code 1: violations found', 'Timeout waiting for dependency', 'Assertion failed in test suite', 'Vulnerability CVE-2024-3821 detected', 'Build failed: unresolved import', 'Coverage below threshold (62% < 80%)'];

  function randInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function hexId(len: number): string {
    let s = '';
    while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, len);
  }

  function logLine(): string {
    const ts = new Date().toISOString().slice(11, 19);
    return `[${ts}] ${pick(LOG_VERBS)} ${pick(LOG_TARGETS)}... ${pick(LOG_RESULTS)}`;
  }

  // Artifacts are written to the pipeline's workspace (shared volume, /workspace inside
  // the pipeline container) under artifacts/run-<id>/stage-<idx>/ and served back via the API.
  const ARTIFACTS_ROOT = 'artifacts';

  function stageArtifactDir(project: string, runId: number, stageIndex: number): string {
    return path.join(PIPELINES_DIR, project, ARTIFACTS_ROOT, `run-${runId}`, `stage-${stageIndex}`);
  }

  function artifactUrl(project: string, runId: number, stageIndex: number, filename: string): string {
    return `/api/pipelines/${encodeURIComponent(project)}/runs/${runId}/artifacts/${stageIndex}/${encodeURIComponent(filename)}`;
  }

  function runFfmpeg(args: string[]): Promise<boolean> {
    return new Promise(resolve => {
      const p = spawn('ffmpeg', args, { stdio: 'ignore' });
      p.on('close', code => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
  }

  function screenshotSvg(stageName: string): string {
    const w = 480, h = 300;
    const bars = Array.from({ length: 5 }, (_, i) => {
      const y = 96 + i * 32;
      return `<rect x="24" y="${y}" width="${randInt(120, 400)}" height="14" rx="3" fill="#3a2e38"/>`;
    }).join('\n  ');
    const captured = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#1a1418"/>
  <rect width="${w}" height="40" fill="#251e24"/>
  <circle cx="20" cy="20" r="5" fill="#e85858"/>
  <circle cx="40" cy="20" r="5" fill="#e8a060"/>
  <circle cx="60" cy="20" r="5" fill="#5ba8a0"/>
  <text x="90" y="25" fill="#a08898" font-family="monospace" font-size="13">${stageName} — captured ${captured}</text>
  ${bars}
  <rect x="24" y="${h - 56}" width="140" height="32" rx="6" fill="#b068a0"/>
  <text x="44" y="${h - 35}" fill="#fff" font-family="monospace" font-size="13">${pick(['Run', 'Submit', 'Deploy', 'Verify'])}</text>
</svg>`;
  }

  // Build a realistic multi-file unified diff and return accurate add/del counts
  function unifiedDiff(): { text: string; additions: number; deletions: number } {
    const numFiles = randInt(1, 4);
    const used = new Set<string>();
    let text = '';
    let additions = 0, deletions = 0;

    for (let f = 0; f < numFiles; f++) {
      let file = pick(LOG_TARGETS);
      let guard = 0;
      while (used.has(file) && guard++ < 6) file = pick(LOG_TARGETS);
      used.add(file);

      const adds = randInt(1, 10);
      const dels = randInt(0, 6);
      text += `diff --git a/${file} b/${file}\n`;
      text += `index ${hexId(7)}..${hexId(7)} 100644\n`;
      text += `--- a/${file}\n+++ b/${file}\n`;
      text += `@@ -1,${dels + 2} +1,${adds + 2} @@\n`;
      text += ` import { defineComponent } from 'vue'\n`;
      for (let i = 0; i < dels; i++) { text += `-  ${pick(['const old', 'let prev', 'return null', 'console.log'])}(${hexId(4)})\n`; deletions++; }
      for (let i = 0; i < adds; i++) { text += `+  ${pick(['const next', 'await run', 'return value', 'handle'])}(${hexId(4)})\n`; additions++; }
      text += ` }\n`;
    }
    return { text, additions, deletions };
  }

  function fileContent(name: string, stageName: string): string {
    if (name.endsWith('.json')) return JSON.stringify({ stage: stageName, generatedAt: new Date().toISOString(), findings: randInt(0, 12), passed: Math.random() > 0.3 }, null, 2);
    if (name.endsWith('.csv')) return 'metric,value\nduration_ms,' + randInt(5000, 20000) + '\nwarnings,' + randInt(0, 9) + '\nerrors,' + randInt(0, 4) + '\n';
    if (name.endsWith('.sarif')) return JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: stageName } }, results: [] } ] }, null, 2);
    if (name.endsWith('.md')) return `# ${stageName} Report\n\nGenerated ${new Date().toISOString()}\n\n- Status: ${pick(['pass', 'warn', 'fail'])}\n- Items checked: ${randInt(10, 200)}\n`;
    return `${stageName} log output\n` + Array.from({ length: randInt(3, 10) }, () => logLine()).join('\n') + '\n';
  }

  async function genArtifacts(project: string, runId: number, stageIndex: number, stageName: string): Promise<any[]> {
    const dir = stageArtifactDir(project, runId, stageIndex);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const slug = stageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage';
    const out: any[] = [];
    const count = randInt(1, 4);
    const kinds = ['screenshot', 'video', 'commit', 'link', 'file'];

    for (let i = 0; i < count; i++) {
      const kind = pick(kinds);
      try {
        if (kind === 'screenshot') {
          const fname = `${slug}-${i + 1}.svg`;
          fs.writeFileSync(path.join(dir, fname), screenshotSvg(stageName));
          out.push({ type: 'screenshot', name: fname, url: artifactUrl(project, runId, stageIndex, fname), path: `${ARTIFACTS_ROOT}/run-${runId}/stage-${stageIndex}/${fname}`, size: fs.statSync(path.join(dir, fname)).size });
        } else if (kind === 'video') {
          const fname = `recording-${i + 1}.mp4`;
          const abs = path.join(dir, fname);
          const ok = await runFfmpeg(['-y', '-f', 'lavfi', '-i', `testsrc=duration=2:size=320x240:rate=12`, '-pix_fmt', 'yuv420p', abs]);
          if (ok && fs.existsSync(abs)) {
            out.push({ type: 'video', name: fname, url: artifactUrl(project, runId, stageIndex, fname), path: `${ARTIFACTS_ROOT}/run-${runId}/stage-${stageIndex}/${fname}`, size: fs.statSync(abs).size });
          }
        } else if (kind === 'commit') {
          const sha = hexId(7);
          const fname = `${sha}.diff`;
          const { text: diff, additions, deletions } = unifiedDiff();
          fs.writeFileSync(path.join(dir, fname), diff);
          out.push({ type: 'commit', name: sha, message: `${pick(['fix', 'refactor', 'chore', 'feat'])}: ${pick(['handle edge case', 'update deps', 'tidy imports', 'add guard', 'rename helper'])}`, url: artifactUrl(project, runId, stageIndex, fname), path: `${ARTIFACTS_ROOT}/run-${runId}/stage-${stageIndex}/${fname}`, additions, deletions });
        } else if (kind === 'link') {
          out.push({ type: 'link', name: pick(['Coverage report', 'Build dashboard', 'Scan results', 'Trace timeline']), url: `https://reports.example.com/${hexId(12)}` });
        } else {
          const fname = pick(['report.json', 'lint-output.txt', 'metrics.csv', 'scan-results.sarif', 'summary.md']);
          fs.writeFileSync(path.join(dir, fname), fileContent(fname, stageName));
          out.push({ type: 'file', name: fname, url: artifactUrl(project, runId, stageIndex, fname), path: `${ARTIFACTS_ROOT}/run-${runId}/stage-${stageIndex}/${fname}`, size: fs.statSync(path.join(dir, fname)).size });
        }
      } catch (err) {
        console.error('artifact generation failed', err);
      }
    }
    return out;
  }

  async function cancellableSleep(ms: number, ctrl: { cancelled: boolean }): Promise<void> {
    const step = 250;
    let elapsed = 0;
    while (elapsed < ms) {
      if (ctrl.cancelled) return;
      await new Promise(r => setTimeout(r, Math.min(step, ms - elapsed)));
      elapsed += step;
    }
  }

  function finalizeRun(runId: number, pipeline: string, status: string): void {
    const db = getRunsDb();
    db.prepare('UPDATE pipeline_runs SET status = ?, completed_at = ? WHERE id = ?').run(status, new Date().toISOString(), runId);
    broadcast('pipeline-run-changed', { pipeline, runId });
  }

  // Prompt handed to Claude for a single stage. The skill does the real work;
  // the trailing STAGE_RESULT line is how we read the success-criteria verdict.
  function buildStagePrompt(stage: any, wsArtifacts: string): string {
    return [
      `You are executing ONE stage of an automated pipeline for this project, non-interactively.`,
      ``,
      `Stage: ${stage.stage_name}`,
      `Skill: use the "${stage.skill}" skill (its instructions are in .claude/skills/${stage.skill}/SKILL.md).`,
      stage.success_criteria ? `Success criteria: ${stage.success_criteria}` : ``,
      ``,
      `Perform the work that skill describes for this project. Pipeline inputs are available as environment variables (e.g. $ISSUE_URL).`,
      `Save every artifact you produce into the directory $STAGE_ARTIFACTS (${wsArtifacts}):`,
      `  - screenshots/images as .png or .svg`,
      `  - videos as .mp4 or .webm`,
      `  - a git diff as <name>.diff`,
      `  - an external link as <name>.url (a text file whose contents are the URL)`,
      `  - anything else (notes, reports, logs) as a normal file`,
      ``,
      `When you are done, evaluate the success criteria and print — as the VERY LAST line of your output — exactly one of:`,
      `STAGE_RESULT: PASS - <one line on why the success criteria is met>`,
      `STAGE_RESULT: FAIL - <one line on why it is not>`,
    ].filter(Boolean).join('\n');
  }

  function parseVerdict(logs: string): { met: boolean | null; reason: string } {
    const matches = [...logs.matchAll(/STAGE_RESULT:\s*(PASS|FAIL)\b[\s—:-]*(.*)/gi)];
    if (!matches.length) return { met: null, reason: '' };
    const last = matches[matches.length - 1];
    return { met: /pass/i.test(last[1]), reason: (last[2] || '').trim() };
  }

  // Classify and copy the files a stage wrote into $STAGE_ARTIFACTS over to the
  // served artifact dir, producing artifact records the UI can render.
  function collectArtifacts(project: string, runId: number, stageIndex: number, srcDir: string): any[] {
    const out: any[] = [];
    if (!fs.existsSync(srcDir)) return out;
    const destDir = stageArtifactDir(project, runId, stageIndex);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { walk(abs, relPath); continue; }
        const lower = entry.name.toLowerCase();
        const flat = relPath.replace(/\//g, '__');
        try {
          if (lower.endsWith('.url')) {
            const url = fs.readFileSync(abs, 'utf-8').trim();
            out.push({ type: 'link', name: entry.name.replace(/\.url$/i, ''), url });
            continue;
          }
          fs.copyFileSync(abs, path.join(destDir, flat));
          const size = fs.statSync(abs).size;
          const url = artifactUrl(project, runId, stageIndex, flat);
          const pathRel = `${ARTIFACTS_ROOT}/run-${runId}/stage-${stageIndex}/${flat}`;
          if (/\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) {
            out.push({ type: 'screenshot', name: relPath, url, path: pathRel, size });
          } else if (/\.(mp4|webm|mov|m4v)$/i.test(lower)) {
            out.push({ type: 'video', name: relPath, url, path: pathRel, size });
          } else if (/\.(diff|patch)$/i.test(lower)) {
            const text = fs.readFileSync(abs, 'utf-8');
            const additions = (text.match(/^\+(?!\+\+)/gm) || []).length;
            const deletions = (text.match(/^-(?!--)/gm) || []).length;
            out.push({ type: 'commit', name: relPath, message: relPath.replace(/\.(diff|patch)$/i, ''), url, path: pathRel, additions, deletions });
          } else {
            out.push({ type: 'file', name: relPath, url, path: pathRel, size });
          }
        } catch (err) {
          console.error('artifact collect failed for', relPath, err);
        }
      }
    };
    walk(srcDir, '');
    return out;
  }

  // Run one stage for real: execute its skill via the Claude CLI inside the
  // pipeline container, stream Claude's output as the stage logs, read the
  // success-criteria verdict, and collect the artifacts it produced.
  async function runSingleStage(stage: any, runId: number, pipeline: string, ctrl: { cancelled: boolean }): Promise<'completed' | 'failed' | 'cancelled'> {
    const db = getRunsDb();
    const container = `${COMPOSE_PROJECT}-${pipeline}-1`;
    const idx = stage.stage_index;
    const startISO = new Date().toISOString();
    const ts = () => new Date().toISOString().slice(11, 19);
    let logs = `[${ts()}] Starting stage "${stage.stage_name}" — running skill "${stage.skill}" via Claude in ${container}`;
    const persist = () => db.prepare('UPDATE pipeline_stage_records SET logs = ? WHERE id = ?').run(logs, stage.id);
    db.prepare(
      `UPDATE pipeline_stage_records SET status = 'running', started_at = ?, completed_at = NULL, duration_ms = NULL, error = NULL, success_criteria_met = 0, logs = ?, artifacts = '[]' WHERE id = ?`
    ).run(startISO, logs, stage.id);
    broadcast('pipeline-run-changed', { pipeline, runId });

    // Make sure the pipeline container is up (no-op if already running).
    spawnSync('docker', ['start', container], { stdio: 'ignore' });

    // Stage artifact drop inside the workspace (host path is the same dir via the
    // /workspace bind mount), cleared before the run.
    const wsArtifacts = `/workspace/.artifacts/stage-${idx}`;
    const hostArtifacts = path.join(PIPELINES_DIR, pipeline, '.artifacts', `stage-${idx}`);
    fs.rmSync(hostArtifacts, { recursive: true, force: true });
    fs.mkdirSync(hostArtifacts, { recursive: true });
    try { chownRecursive(path.join(PIPELINES_DIR, pipeline, '.artifacts'), 1000, 1000); } catch { /* best effort */ }

    const prompt = buildStagePrompt(stage, wsArtifacts);

    const exitCode = await new Promise<number>((resolve) => {
      const p = spawn('docker', [
        'exec', '-u', '1000:1000',
        '-e', `CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}`,
        '-e', `STAGE_ARTIFACTS=${wsArtifacts}`,
        '-e', `STAGE_PROMPT=${prompt}`,
        container,
        'bash', '-lc',
        'mkdir -p "$STAGE_ARTIFACTS"; cd /workspace && claude --dangerously-skip-permissions -p "$STAGE_PROMPT" 2>&1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let lastFlush = Date.now();
      const onData = (d: Buffer) => {
        logs += '\n' + d.toString().replace(/\s+$/, '');
        const now = Date.now();
        if (now - lastFlush > 1000) { lastFlush = now; persist(); broadcast('pipeline-run-changed', { pipeline, runId }); }
      };
      p.stdout?.on('data', onData);
      p.stderr?.on('data', onData);

      const killTimer = setInterval(() => { if (ctrl.cancelled) { try { p.kill('SIGKILL'); } catch { /* ignore */ } } }, 500);
      p.on('error', (e) => { logs += `\n[exec error] ${e.message}`; clearInterval(killTimer); resolve(1); });
      p.on('close', (code) => { clearInterval(killTimer); resolve(code ?? 1); });
    });

    if (ctrl.cancelled) return 'cancelled';

    const verdict = parseVerdict(logs);
    const artifacts = collectArtifacts(pipeline, runId, idx, hostArtifacts);
    const endISO = new Date().toISOString();
    const durationMs = new Date(endISO).getTime() - new Date(startISO).getTime();

    // A stage passes only when Claude exited cleanly AND the criteria verdict
    // isn't an explicit FAIL. Criteria-not-met halts downstream stages.
    let status: 'completed' | 'failed';
    let criteriaMet: boolean;
    let errMsg: string | null = null;
    if (exitCode !== 0) {
      status = 'failed';
      criteriaMet = false;
      errMsg = `Claude exited with code ${exitCode}${verdict.reason ? ` — ${verdict.reason}` : ''}`;
    } else if (verdict.met === false) {
      status = 'failed';
      criteriaMet = false;
      errMsg = `Success criteria not met${verdict.reason ? `: ${verdict.reason}` : ''}`;
    } else {
      status = 'completed';
      criteriaMet = true;
    }

    logs += `\n[${ts()}] Stage ${status} — ${criteriaMet ? 'success criteria met' : 'success criteria NOT met'}${artifacts.length ? ` · ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}` : ''}`;
    db.prepare(
      `UPDATE pipeline_stage_records SET status = ?, completed_at = ?, duration_ms = ?, error = ?, success_criteria_met = ?, logs = ?, artifacts = ? WHERE id = ?`
    ).run(status, endISO, durationMs, errMsg, criteriaMet ? 1 : 0, logs, JSON.stringify(artifacts), stage.id);
    broadcast('pipeline-run-changed', { pipeline, runId });

    return status;
  }

  // Parallel fork/join executor: a stage runs once all its predecessors have
  // completed; completing a stage unlocks its successors. Already-completed
  // stages (rerun case) count as satisfied. Stages that can never become
  // ready (downstream of a failure, or in a cycle) are marked skipped.
  async function executeGraph(runId: number, pipeline: string, ctrl: { cancelled: boolean }): Promise<void> {
    const db = getRunsDb();
    const records = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId) as any[];
    const N = records.length;
    if (!N) { finalizeRun(runId, pipeline, 'completed'); return; }

    const next: number[][] = records.map(r => {
      try { return (JSON.parse(r.next_indices || '[]') as number[]).filter(j => j >= 0 && j < N); }
      catch { return []; }
    });
    const preds: number[][] = records.map(() => []);
    next.forEach((succ, i) => succ.forEach(j => preds[j].push(i)));

    const status: string[] = records.map(r => r.status);
    const satisfied = (i: number) => preds[i].every(p => status[p] === 'completed');
    const running = new Map<number, Promise<{ i: number; result: string }>>();
    let anyFailed = false;

    const launch = (i: number) => {
      status[i] = 'running';
      running.set(i, runSingleStage(records[i], runId, pipeline, ctrl).then(result => ({ i, result })));
    };

    while (true) {
      if (ctrl.cancelled) return;
      if (!anyFailed) {
        for (let i = 0; i < N; i++) {
          if (status[i] === 'pending' && !running.has(i) && satisfied(i)) launch(i);
        }
      }
      if (running.size === 0) break;
      const { i, result } = await Promise.race(running.values());
      running.delete(i);
      if (result === 'cancelled') return;
      status[i] = result;
      if (result === 'failed') anyFailed = true;
    }

    if (ctrl.cancelled) return;
    // Anything still pending can't run (blocked by a failure or unreachable) → skip
    for (let i = 0; i < N; i++) {
      if (status[i] === 'pending') {
        db.prepare("UPDATE pipeline_stage_records SET status = 'skipped' WHERE id = ?").run(records[i].id);
      }
    }
    broadcast('pipeline-run-changed', { pipeline, runId });
    finalizeRun(runId, pipeline, anyFailed ? 'failed' : 'completed');
  }

  function startExecution(runId: number, pipeline: string): void {
    const ctrl = { cancelled: false };
    activeRuns.set(runId, ctrl);
    executeGraph(runId, pipeline, ctrl)
      .catch(err => console.error('run execution error', err))
      .finally(() => activeRuns.delete(runId));
  }

  function cancelRun(runId: number, pipeline: string): void {
    const db = getRunsDb();
    const ctrl = activeRuns.get(runId);
    if (ctrl) ctrl.cancelled = true;
    const nowISO = new Date().toISOString();
    const running = db.prepare("SELECT * FROM pipeline_stage_records WHERE run_id = ? AND status = 'running'").all(runId) as any[];
    for (const s of running) {
      const dur = s.started_at ? new Date(nowISO).getTime() - new Date(s.started_at).getTime() : null;
      db.prepare("UPDATE pipeline_stage_records SET status = 'cancelled', completed_at = ?, duration_ms = ? WHERE id = ?").run(nowISO, dur, s.id);
    }
    db.prepare("UPDATE pipeline_stage_records SET status = 'cancelled' WHERE run_id = ? AND status = 'pending'").run(runId);
    db.prepare("UPDATE pipeline_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'running'").run(nowISO, runId);
    broadcast('pipeline-run-changed', { pipeline, runId });
  }

  function cancelActiveRunsForPipeline(pipeline: string): void {
    const db = getRunsDb();
    const active = db.prepare("SELECT id FROM pipeline_runs WHERE pipeline = ? AND status = 'running'").all(pipeline) as { id: number }[];
    for (const r of active) cancelRun(r.id, pipeline);
  }

  app.get('/api/pipelines/:name/runs', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const runs = db.prepare(
        'SELECT * FROM pipeline_runs WHERE pipeline = ? ORDER BY id DESC LIMIT ? OFFSET ?'
      ).all(req.params.name, limit, offset) as any[];

      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM pipeline_runs WHERE pipeline = ?'
      ).get(req.params.name) as { total: number };

      const stageStmt = db.prepare(
        'SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index'
      );

      // Snapshots (pipeline_md / skill_md) are large and fetched on demand, not in the list
      const result = runs.map(run => {
        const { pipeline_md, ...runRest } = run;
        const stages = (stageStmt.all(run.id) as any[]).map(s => {
          const { skill_md, ...sRest } = s;
          return sRest;
        });
        return { ...runRest, stages };
      });

      res.json({ runs: result, total: countRow.total });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Serve a generated artifact file from the pipeline workspace
  app.get('/api/pipelines/:name/runs/:runId/artifacts/:stageIndex/:filename', (req: Request, res: Response) => {
    const { name, filename } = req.params;
    const runId = Number(req.params.runId);
    const stageIndex = Number(req.params.stageIndex);
    if (!/^[a-zA-Z0-9._-]+$/.test(filename) || !Number.isInteger(runId) || !Number.isInteger(stageIndex)) {
      return res.status(400).json({ error: 'Invalid artifact path' });
    }
    const filePath = path.join(stageArtifactDir(name, runId, stageIndex), filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.sendFile(filePath);
  });

  // Read-only snapshot of pipeline.md as it was when this run started
  app.get('/api/pipelines/:name/runs/:runId/pipeline-md', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const row = db.prepare('SELECT pipeline_md FROM pipeline_runs WHERE id = ?').get(Number(req.params.runId)) as { pipeline_md: string | null } | undefined;
      if (!row) return res.status(404).json({ error: 'Run not found' });
      res.type('text/markdown').send(row.pipeline_md || '');
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Read-only snapshot of a stage's SKILL.md as it was when this run started
  app.get('/api/pipelines/:name/runs/:runId/stages/:stageIndex/skill-md', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const row = db.prepare('SELECT skill_md FROM pipeline_stage_records WHERE run_id = ? AND stage_index = ?')
        .get(Number(req.params.runId), Number(req.params.stageIndex)) as { skill_md: string | null } | undefined;
      if (!row) return res.status(404).json({ error: 'Stage not found' });
      res.type('text/markdown').send(row.skill_md || '');
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/pipelines/:name/runs', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const pipeline = req.params.name;

      const pipelineDir = path.join(PIPELINES_DIR, pipeline);
      if (!fs.existsSync(pipelineDir)) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      const stages = readPipelineStages(pipeline);
      if (!stages.length) {
        return res.status(400).json({ error: 'Pipeline has no stages defined' });
      }

      // A new run supersedes any run still in flight for this pipeline
      cancelActiveRunsForPipeline(pipeline);

      // Snapshot the pipeline.md and each stage's SKILL.md as they are right now,
      // so run history shows exactly what was executed (read-only, immutable).
      let pipelineMdSnapshot = '';
      try {
        const mdPath = path.join(pipelineDir, 'pipeline.md');
        if (fs.existsSync(mdPath)) pipelineMdSnapshot = fs.readFileSync(mdPath, 'utf-8');
      } catch { /* ignore */ }

      const now = new Date().toISOString();
      const runResult = db.prepare(
        'INSERT INTO pipeline_runs (pipeline, status, started_at, pipeline_md) VALUES (?, ?, ?, ?)'
      ).run(pipeline, 'running', now, pipelineMdSnapshot);

      const runId = Number(runResult.lastInsertRowid);
      const insertStage = db.prepare(
        'INSERT INTO pipeline_stage_records (run_id, stage_index, stage_name, skill, status, success_criteria, skill_md, next_indices) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      const insertMany = db.transaction(() => {
        stages.forEach((stage, i) => {
          let skillMd = '';
          try {
            const skillPath = resolveSkillPath(pipeline, stage.skill);
            if (skillPath && fs.existsSync(skillPath)) skillMd = fs.readFileSync(skillPath, 'utf-8');
          } catch { /* ignore */ }
          insertStage.run(runId, i, stage.name, stage.skill, 'pending', stage.successCriteria || null, skillMd, JSON.stringify(stage.next));
        });
      });
      insertMany();

      const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
      const stageRecords = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId);

      broadcast('pipeline-run-changed', { pipeline, runId });
      startExecution(runId, pipeline);
      res.json({ run: { ...run as any, stages: stageRecords } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/pipelines/:name/runs/:runId/stages/:stageIndex', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const { runId, stageIndex } = req.params;
      const { status, error, successCriteriaMet } = req.body;

      const stage = db.prepare(
        'SELECT * FROM pipeline_stage_records WHERE run_id = ? AND stage_index = ?'
      ).get(runId, stageIndex) as any;

      if (!stage) {
        return res.status(404).json({ error: 'Stage record not found' });
      }

      const now = new Date().toISOString();
      const updates: string[] = [];
      const params: any[] = [];

      if (status) {
        updates.push('status = ?');
        params.push(status);

        if (status === 'running' && !stage.started_at) {
          updates.push('started_at = ?');
          params.push(now);
        }
        if (status === 'completed' || status === 'failed') {
          updates.push('completed_at = ?');
          params.push(now);
          if (stage.started_at) {
            const durationMs = new Date(now).getTime() - new Date(stage.started_at).getTime();
            updates.push('duration_ms = ?');
            params.push(durationMs);
          }
        }
      }
      if (error !== undefined) {
        updates.push('error = ?');
        params.push(error || null);
      }
      if (successCriteriaMet !== undefined) {
        updates.push('success_criteria_met = ?');
        params.push(successCriteriaMet ? 1 : 0);
      }

      if (updates.length) {
        params.push(runId, stageIndex);
        db.prepare(
          `UPDATE pipeline_stage_records SET ${updates.join(', ')} WHERE run_id = ? AND stage_index = ?`
        ).run(...params);
      }

      // If stage completed successfully, auto-advance next stage to running
      if (status === 'completed') {
        const nextIndex = parseInt(stageIndex) + 1;
        const nextStage = db.prepare(
          'SELECT * FROM pipeline_stage_records WHERE run_id = ? AND stage_index = ?'
        ).get(runId, nextIndex) as any;

        if (nextStage && nextStage.status === 'pending') {
          db.prepare(
            'UPDATE pipeline_stage_records SET status = ?, started_at = ? WHERE run_id = ? AND stage_index = ?'
          ).run('running', now, runId, nextIndex);
        } else if (!nextStage) {
          // Last stage completed — mark run as completed
          db.prepare(
            'UPDATE pipeline_runs SET status = ?, completed_at = ? WHERE id = ?'
          ).run('completed', now, runId);
        }
      }

      if (status === 'failed') {
        db.prepare(
          'UPDATE pipeline_runs SET status = ?, completed_at = ? WHERE id = ?'
        ).run('failed', now, runId);
      }

      const updatedRun = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
      const stageRecords = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId);

      broadcast('pipeline-run-changed', { pipeline: req.params.name, runId: Number(runId) });
      res.json({ run: { ...updatedRun as any, stages: stageRecords } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/pipelines/:name/runs/:runId', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const runId = Number(req.params.runId);
      cancelRun(runId, req.params.name);
      db.prepare('DELETE FROM pipeline_stage_records WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM pipeline_runs WHERE id = ?').run(runId);
      // Remove the run's artifact files from the workspace
      fs.rmSync(path.join(PIPELINES_DIR, req.params.name, ARTIFACTS_ROOT, `run-${runId}`), { recursive: true, force: true });
      broadcast('pipeline-run-changed', { pipeline: req.params.name, runId });
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Cancel an in-flight run
  app.post('/api/pipelines/:name/runs/:runId/cancel', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const runId = Number(req.params.runId);
      cancelRun(runId, req.params.name);
      const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
      const stages = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId);
      res.json({ run: { ...run as any, stages } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Claude auth (shared across all pipeline containers via CLAUDE_CONFIG_DIR) ──
  // Check whether the Claude CLI that runs stages is authenticated, and drive an
  // OAuth sign-in when it isn't, so a run can be gated on valid auth.
  function checkClaudeAuth(container: string): { authenticated: boolean; method: string; loggedIn: boolean } {
    if (process.env.ANTHROPIC_API_KEY) return { authenticated: true, method: 'apiKey', loggedIn: false };
    const r = spawnSync('docker', ['exec', '-u', '1000:1000', '-e', `CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}`, container, 'claude', 'auth', 'status'], { encoding: 'utf-8' });
    let loggedIn = false, method = 'none';
    try { const j = JSON.parse((r.stdout || '').trim()); loggedIn = !!j.loggedIn; method = j.authMethod || 'none'; } catch { /* not logged in / not running */ }
    return { authenticated: loggedIn, method, loggedIn };
  }

  // In-flight `claude auth login` processes, keyed by a session id, awaiting a code.
  const loginSessions = new Map<string, { proc: ChildProcess; pipeline: string }>();

  app.get('/api/pipelines/:name/claude-auth', (req: Request, res: Response) => {
    try { res.json(checkClaudeAuth(`${COMPOSE_PROJECT}-${req.params.name}-1`)); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // Start an OAuth sign-in: returns the URL to visit. The login process stays
  // alive awaiting the pasted code (submitted to the endpoint below).
  app.post('/api/pipelines/:name/claude-auth/login', (req: Request, res: Response) => {
    const container = `${COMPOSE_PROJECT}-${req.params.name}-1`;
    const proc = spawn('docker', ['exec', '-i', '-u', '1000:1000', '-e', `CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}`, container, 'claude', 'auth', 'login', '--claudeai'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const sid = hexId(8);
    let out = '';
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { proc.kill(); } catch { /* ignore */ } if (!res.headersSent) res.status(504).json({ error: 'Timed out waiting for sign-in URL' }); } }, 20000);
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = out.match(/https:\/\/\S*oauth\S*/);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        loginSessions.set(sid, { proc, pipeline: req.params.name });
        res.json({ sessionId: sid, url: m[0] });
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); if (!res.headersSent) res.status(500).json({ error: String(e) }); } });
    proc.on('close', () => { if (!done) { done = true; clearTimeout(timer); if (!res.headersSent) res.status(500).json({ error: 'Sign-in process exited early', output: out.slice(0, 500) }); } });
  });

  // Submit the pasted OAuth code to complete sign-in; re-checks auth after.
  app.post('/api/pipelines/:name/claude-auth/login/:sid', async (req: Request, res: Response) => {
    const session = loginSessions.get(req.params.sid);
    if (!session) return res.status(404).json({ error: 'No active sign-in session' });
    const code = (req.body.code || '').trim();
    if (!code) return res.status(400).json({ error: 'code is required' });
    try { session.proc.stdin?.write(code + '\n'); } catch { /* ignore */ }
    const completed = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 25000);
      session.proc.on('close', () => { clearTimeout(t); resolve(true); });
    });
    loginSessions.delete(req.params.sid);
    const status = checkClaudeAuth(`${COMPOSE_PROJECT}-${req.params.name}-1`);
    res.json({ completed, ...status });
  });

  // Rerun a single stage within an existing run (resets it + later stages, re-executes)
  app.post('/api/pipelines/:name/runs/:runId/stages/:stageIndex/rerun', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const pipeline = req.params.name;
      const runId = Number(req.params.runId);
      const idx = parseInt(req.params.stageIndex);

      const stage = db.prepare(
        'SELECT * FROM pipeline_stage_records WHERE run_id = ? AND stage_index = ?'
      ).get(runId, idx) as any;
      if (!stage) {
        return res.status(404).json({ error: 'Stage record not found' });
      }

      // Stop any in-flight execution of this run before resetting
      cancelActiveRunsForPipeline(pipeline);

      const reset = db.transaction(() => {
        // Reset the target stage and all later stages back to pending
        db.prepare(
          `UPDATE pipeline_stage_records
           SET status = 'pending', started_at = NULL, completed_at = NULL, duration_ms = NULL, error = NULL, success_criteria_met = 0, logs = NULL, artifacts = NULL
           WHERE run_id = ? AND stage_index >= ?`
        ).run(runId, idx);
        db.prepare(
          "UPDATE pipeline_runs SET status = 'running', completed_at = NULL WHERE id = ?"
        ).run(runId);
      });
      reset();

      broadcast('pipeline-run-changed', { pipeline, runId });
      startExecution(runId, pipeline);

      const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
      const stages = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId);
      res.json({ run: { ...run as any, stages } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Pipeline.md & skill editing ---

  app.get('/api/pipelines/:name/pipeline-md', (req: Request, res: Response) => {
    try {
      const mdPath = path.join(PIPELINES_DIR, req.params.name, 'pipeline.md');
      const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/pipelines/:name/pipeline-md', (req: Request, res: Response) => {
    try {
      const pipelineDir = path.join(PIPELINES_DIR, req.params.name);
      if (!fs.existsSync(pipelineDir)) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }
      const content = typeof req.body.content === 'string' ? req.body.content : '';
      fs.writeFileSync(path.join(pipelineDir, 'pipeline.md'), content);
      broadcast('pipelines-changed');
      res.json({ stages: parsePipelineStages(content) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Resolve a skill's SKILL.md path within a pipeline workspace, guarding against traversal
  function resolveSkillPath(project: string, skill: string): string | null {
    if (!/^[a-zA-Z0-9._-]+$/.test(skill)) return null;
    return path.join(PIPELINES_DIR, project, '.claude', 'skills', skill, 'SKILL.md');
  }

  app.get('/api/pipelines/:name/skills/:skill', (req: Request, res: Response) => {
    try {
      const skillPath = resolveSkillPath(req.params.name, req.params.skill);
      if (!skillPath) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      const exists = fs.existsSync(skillPath);
      const content = exists ? fs.readFileSync(skillPath, 'utf-8') : '';
      res.json({ content, exists });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/pipelines/:name/skills/:skill', (req: Request, res: Response) => {
    try {
      const skillPath = resolveSkillPath(req.params.name, req.params.skill);
      if (!skillPath) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      const pipelineDir = path.join(PIPELINES_DIR, req.params.name);
      if (!fs.existsSync(pipelineDir)) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }
      const content = typeof req.body.content === 'string' ? req.body.content : '';
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, content);
      res.json({ status: 'saved' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Push a pipeline's pipeline.md + its referenced skills to the global definitions repo
  app.post('/api/pipelines/:name/push-definition', (req: Request, res: Response) => {
    try {
      const pipeline = req.params.name;
      const pipelineDir = path.join(PIPELINES_DIR, pipeline);
      const mdPath = path.join(pipelineDir, 'pipeline.md');
      if (!fs.existsSync(mdPath)) {
        return res.status(404).json({ error: 'Pipeline has no pipeline.md' });
      }
      const definitionId = (req.body.definitionId || pipeline).trim();
      const message = (req.body.message || `Update ${definitionId} from ${pipeline}`).trim();

      const pipelineMd = fs.readFileSync(mdPath, 'utf-8');
      // Gather the SKILL.md for each unique skill referenced by the pipeline
      const skills: Array<{ name: string; content: string }> = [];
      const seen = new Set<string>();
      for (const stage of parsePipelineStages(pipelineMd)) {
        if (!stage.skill || seen.has(stage.skill)) continue;
        seen.add(stage.skill);
        const sp = resolveSkillPath(pipeline, stage.skill);
        if (sp && fs.existsSync(sp)) {
          skills.push({ name: stage.skill, content: fs.readFileSync(sp, 'utf-8') });
        }
      }

      const { sha } = writeDefinition({ id: definitionId, pipelineMd, skills, message });
      res.json({ id: definitionId, sha, skillCount: skills.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Template management ---

  app.get('/api/templates', (_req: Request, res: Response) => {
    try {
      res.json({ templates: listTemplates() });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/templates', (req: Request, res: Response) => {
    try {
      const id = (req.body.id || '').trim();
      const name = (req.body.name || '').trim();
      const description = (req.body.description || '').trim();

      if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
        res.status(400).json({ error: 'Invalid template ID. Use alphanumeric, hyphens, underscores.' });
        return;
      }
      if (!name) {
        res.status(400).json({ error: 'Template name is required' });
        return;
      }

      const template = createTemplate(id, name, description);
      res.json({ status: 'created', template });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/templates/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const name = (req.body.name || '').trim();
      const description = (req.body.description || '').trim();

      if (!name) {
        res.status(400).json({ error: 'Template name is required' });
        return;
      }

      updateTemplateMeta(id, name, description);
      res.json({ status: 'updated', id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/templates/:id', (req: Request, res: Response) => {
    try {
      deleteTemplate(req.params.id);
      res.json({ status: 'deleted', id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/templates/:id/icon', (req: Request, res: Response) => {
    const svg = getTemplateIcon(req.params.id);
    if (!svg) {
      res.status(404).json({ error: 'No icon found' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  });

  app.put('/api/templates/:id/icon', (req: Request, res: Response) => {
    try {
      const svg = req.body.svg || '';
      if (!svg) {
        res.status(400).json({ error: 'SVG content is required' });
        return;
      }
      setTemplateIcon(req.params.id, svg);
      res.json({ status: 'updated' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Template keys ---

  app.get('/api/templates/:id/keys', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const settings = readSettings();
      const values = settings.templateKeys?.[id] || {};
      res.json({ keys: values });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/templates/:id/keys', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const keys = req.body;
      if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
        res.status(400).json({ error: 'Keys must be an object' });
        return;
      }
      const settings = readSettings();
      if (!settings.templateKeys) settings.templateKeys = {};
      const merged = { ...settings.templateKeys[id], ...keys };
      for (const [k, v] of Object.entries(merged)) {
        if (!v) delete merged[k];
      }
      settings.templateKeys[id] = merged;
      writeSettings(settings);
      res.json({ status: 'updated', keys: merged });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Browser cookie sync (inject host browser cookies into sidecar Chromium via CDP) ---
  // The browser sidecar shares the project container's network namespace,
  // so CDP at localhost:9222 is only reachable from inside that namespace.
  // We use `docker exec` into the project container to run a Node.js script
  // that connects to CDP via localhost and sets the cookies.

  interface CookieParam {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite?: string;
    expirationDate?: number;
  }

  // Snapshot of host github cookies, pushed by the extension SW. Used to
  // auto-inject into newly-started browser sidecars so they come up logged in.
  const COOKIE_SNAPSHOT_PATH = path.join(DATA_DIR, 'config', 'github-cookies.json');

  function readCookieSnapshot(): CookieParam[] | null {
    try {
      const raw = fs.readFileSync(COOKIE_SNAPSHOT_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.cookies)) return parsed.cookies as CookieParam[];
      return null;
    } catch {
      return null;
    }
  }

  // Map sameSite values from Chrome extension format to CDP format.
  const SAMESITE_MAP: Record<string, string> = {
    no_restriction: 'None',
    lax: 'Lax',
    strict: 'Strict',
    unspecified: 'None',
  };

  function toCdpCookies(cookies: CookieParam[]) {
    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: SAMESITE_MAP[(c.sameSite || '').toLowerCase()] || 'Lax',
      ...(c.expirationDate ? { expires: c.expirationDate } : {}),
    }));
  }

  // Inject cookies into the browser sidecar of `project` via CDP. The script
  // runs inside the project container (which shares network namespace with
  // its browser sidecar, so CDP at localhost:9222 is reachable from there).
  // `waitMs` controls how long to retry connecting to CDP — used for the
  // auto-inject-on-start path where the sidecar may not be ready yet.
  function injectCookiesIntoSidecar(project: string, cookies: CookieParam[], waitMs = 0): { ok: boolean; error?: string } {
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    if (getContainerStatus(containerName) !== 'running') {
      return { ok: false, error: 'Project container is not running' };
    }
    const cdpCookies = toCdpCookies(cookies);
    const deadline = Date.now() + waitMs;

    const script = `
      const http = require('http');
      const crypto = require('crypto');
      const cookies = ${JSON.stringify(cdpCookies)};
      const deadline = ${deadline};

      function get(url) {
        return new Promise((resolve, reject) => {
          http.get(url, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
      }
      function rawWsSend(wsUrl, message) {
        return new Promise((resolve, reject) => {
          const u = new URL(wsUrl);
          const key = crypto.randomBytes(16).toString('base64');
          const req = http.request({
            hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET',
            headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
          });
          req.on('upgrade', (res, socket) => {
            const payload = Buffer.from(message);
            const mask = crypto.randomBytes(4);
            let header;
            if (payload.length < 126) {
              header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2);
            } else if (payload.length < 65536) {
              header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); mask.copy(header, 4);
            } else {
              header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); mask.copy(header, 10);
            }
            const masked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
            socket.write(Buffer.concat([header, masked]));
            let buf = Buffer.alloc(0);
            socket.on('data', chunk => {
              buf = Buffer.concat([buf, chunk]);
              if (buf.length < 2) return;
              let offset = 2;
              let len = buf[1] & 0x7f;
              if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
              else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
              if (buf.length < offset + len) return;
              const data = buf.slice(offset, offset + len).toString();
              socket.destroy();
              try { resolve(JSON.parse(data)); } catch { resolve(data); }
            });
            socket.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        });
      }
      async function getTargetsWithRetry() {
        while (true) {
          try { return await get('http://localhost:9222/json'); }
          catch (e) {
            if (Date.now() > deadline) throw new Error('CDP not reachable: ' + e.message);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
      (async () => {
        const targets = await getTargetsWithRetry();
        const page = targets.find(t => t.type === 'page');
        if (!page) throw new Error('No page target found in CDP');
        const wsUrl = page.webSocketDebuggerUrl;
        if (!wsUrl) throw new Error('No WebSocket debugger URL from CDP');
        const result = await rawWsSend(wsUrl, JSON.stringify({ id: 1, method: 'Network.setCookies', params: { cookies } }));
        console.log(JSON.stringify(result && result.error ? { error: result.error.message } : { ok: true }));
      })().catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
    `.trim();

    const result = spawnSync('docker', [
      'exec', containerName, 'node', '-e', script,
    ], { encoding: 'utf-8', timeout: Math.max(20_000, waitMs + 15_000) });

    if (result.status !== 0) {
      return { ok: false, error: (result.stderr || result.stdout || '').trim() };
    }
    const output = result.stdout.trim();
    try {
      const parsed = JSON.parse(output);
      if (parsed.error) return { ok: false, error: parsed.error };
    } catch {
      // Non-JSON output is fine if exit code was 0
    }
    return { ok: true };
  }

  // Read the latest pushed cookie snapshot and inject it into the sidecar.
  // Used by the auto-inject-on-sidecar-start path. Async/fire-and-forget.
  function injectStoredCookies(project: string) {
    const cookies = readCookieSnapshot();
    if (!cookies?.length) return;
    setTimeout(() => {
      const result = injectCookiesIntoSidecar(project, cookies, 30_000);
      if (!result.ok) {
        console.warn(`[cookie-snapshot] auto-inject into ${project} failed: ${result.error}`);
      }
    }, 0);
  }

  // Receive a github cookie snapshot from the host extension SW.
  app.post('/api/browser/cookie-snapshot', (req: Request, res: Response) => {
    try {
      const { cookies } = req.body as { cookies: CookieParam[] };
      if (!Array.isArray(cookies)) {
        res.status(400).json({ error: 'cookies array is required' });
        return;
      }
      fs.mkdirSync(path.dirname(COOKIE_SNAPSHOT_PATH), { recursive: true });
      const payload = { updatedAt: Date.now(), count: cookies.length, cookies };
      fs.writeFileSync(COOKIE_SNAPSHOT_PATH, JSON.stringify(payload));
      res.json({ status: 'stored', count: cookies.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/browser/cookie-snapshot/status', (_req: Request, res: Response) => {
    try {
      const raw = fs.readFileSync(COOKIE_SNAPSHOT_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      res.json({ present: true, updatedAt: parsed.updatedAt, count: parsed.count });
    } catch {
      res.json({ present: false });
    }
  });

  // Manual sync from the cookie-bridge UI: inject into one project AND
  // persist the snapshot so future sidecar starts auto-inject too.
  app.post('/api/browser/sync-cookies', async (req: Request, res: Response) => {
    try {
      const { project, cookies } = req.body as { project: string; cookies: CookieParam[] };
      if (!project || !cookies?.length) {
        res.status(400).json({ error: 'project and cookies are required' });
        return;
      }
      // Persist snapshot for auto-inject on future sidecar starts.
      try {
        fs.mkdirSync(path.dirname(COOKIE_SNAPSHOT_PATH), { recursive: true });
        fs.writeFileSync(COOKIE_SNAPSHOT_PATH, JSON.stringify({ updatedAt: Date.now(), count: cookies.length, cookies }));
      } catch { /* persistence failure is non-fatal */ }
      const result = injectCookiesIntoSidecar(project, cookies);
      if (!result.ok) {
        res.status(502).json({ error: `CDP cookie injection failed: ${result.error}` });
        return;
      }
      res.json({ status: 'synced', count: cookies.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Template editor (VS Code container for editing template files) ---

  function generateTemplateClaudeMd(templateId: string, meta: TemplateMeta | null): string {
    return `# Template: ${meta?.name || templateId}

${meta?.description ? meta.description + '\n' : ''}
## How Templates Work

This directory IS the template. When a user creates a new project with this template, every file here (except metadata files) gets copied into the new project's workspace.

### Handlebars (.hbs) files
Files ending in \`.hbs\` are processed through **Handlebars** during scaffolding. The \`.hbs\` extension is stripped from the output filename.

For example: \`init.sh.hbs\` becomes \`init.sh\` in the project.

### Available template variables
Use \`{{variableName}}\` in .hbs files. Available variables:

| Variable | Description |
|----------|-------------|
| \`{{projectName}}\` | The project name chosen by the user |
| \`{{adminPassword}}\` | Auto-generated secure password |
| \`{{userPassword1}}\` through \`{{userPassword3}}\` | Additional auto-generated passwords |
| \`{{gitName}}\` | User's git name from gitconfig |
| \`{{gitEmail}}\` | User's git email from gitconfig |
| \`{{githubToken}}\` | GitHub OAuth token from gh CLI config |
| \`{{appcoEmail}}\` | AppCo email from harness settings |
| \`{{appcoToken}}\` | AppCo access token from harness settings |
| \`{{nodeVersion}}\` | Node version (if specified during project creation) |
| \`{{rancherTag}}\` | Rancher tag (if specified during project creation) |
| \`{{rancherPublicUrl}}\` | Public URL for rancher (auto-generated for rancher templates) |

### Metadata files (not copied to projects)
These files configure the template itself and are NOT scaffolded:

- **template.json** — Template metadata (name, description, sidecars). Edit this to change the template's display name, description, or to configure sidecar containers.
- **browser-port.json** — Sets the default browser sidecar port (e.g., \`{"port": 3000}\`)
- **icon.svg** — Template icon shown in the UI
- **CLAUDE.md** — This file (auto-generated, not scaffolded)

### template.json structure
\`\`\`json
{
  "name": "Template Display Name",
  "description": "What this template does",
  "sidecars": [
    {
      "suffix": "browser",
      "image": "lscr.io/linuxserver/chromium:latest",
      "shm_size": "1gb",
      "network_container": true,
      "env": {
        "PUID": "1000",
        "PGID": "1000",
        "CUSTOM_PORT": "3000"
      }
    }
  ]
}
\`\`\`

Sidecars are additional Docker containers started alongside the project. Common sidecars:
- **browser** — Chromium browser accessible via the harness UI
- **rancher** — Rancher server container with network_container pointing to it

### Shell scripts
Files ending in \`.sh\` automatically get executable permissions (chmod 755).

### Special files
- **init.sh** — If present, runs inside the project container after startup
- **shutdown.sh** — If present, runs before the project is deleted
- **.env** — Environment variables for the project

### Key conventions
- Use Handlebars for anything that needs to be customized per-project (passwords, names, URLs)
- Non-.hbs files are copied verbatim
- Directory structure is preserved exactly
- The project workspace is at \`/workspace\` in the project container
- Projects run as UID 1000
`;
  }

  const TEMPLATE_EDITOR_PREFIX = 'bender-tpl-';

  function getTemplateEditorContainer(templateId: string): string {
    return `${TEMPLATE_EDITOR_PREFIX}${templateId}-1`;
  }

  app.get('/api/templates/:id/editor', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const containerName = getTemplateEditorContainer(id);
      const status = getContainerStatus(containerName);
      res.json({ status });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/templates/:id/editor', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const templateDir = getTemplatePath(id);
      if (!fs.existsSync(templateDir)) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }

      const containerName = getTemplateEditorContainer(id);
      const networkAlias = `tpl-${id}`;
      const status = getContainerStatus(containerName);

      if (status === 'running') {
        res.json({ status: 'already_running' });
        return;
      }

      if (status === 'stopped') {
        spawnSync('docker', ['start', containerName], { encoding: 'utf-8' });
        res.json({ status: 'started' });
        return;
      }

      // Generate CLAUDE.md for the template editor workspace
      const meta = getTemplateMeta(id);
      const claudeMdPath = path.join(templateDir, 'CLAUDE.md');
      const claudeMd = generateTemplateClaudeMd(id, meta);
      fs.writeFileSync(claudeMdPath, claudeMd);

      // The templates volume is mounted from the Docker host at /data/templates
      const hostTemplatePath = `/data/templates/${id}`;

      // Start a new VS Code container for the template directory
      const result = spawnSync('docker', [
        'run', '-d',
        '--name', containerName,
        '--network', NETWORK_NAME,
        '--network-alias', networkAlias,
        '--restart', 'unless-stopped',
        '-e', 'PUID=1000',
        '-e', 'PGID=1000',
        '-e', 'CLAUDE_CODE_SKIP_PERMISSIONS_DISCLAIMER=1',
        '-e', `PROJECT_NAME=${networkAlias}`,
        '-v', `${hostTemplatePath}:/workspace`,
        '-v', `${DATA_DIR}/credentials:/claude-data`,
        '-v', `${DATA_DIR}/config:/claude-config`,
        BENDER_IMAGE,
      ], { encoding: 'utf-8' });

      if (result.status !== 0) {
        res.status(500).json({ error: `Failed to start editor: ${result.stderr}` });
        return;
      }

      res.json({ status: 'created' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/templates/:id/editor', (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const containerName = getTemplateEditorContainer(id);
      const status = getContainerStatus(containerName);

      if (status === 'not_found') {
        res.json({ status: 'not_running' });
        return;
      }

      spawnSync('docker', ['stop', containerName], { encoding: 'utf-8' });
      spawnSync('docker', ['rm', containerName], { encoding: 'utf-8' });
      res.json({ status: 'stopped' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Upload screenshot
  app.post('/api/upload/:pipeline', (req: Request, res: Response) => {
    const pipeline = req.params.pipeline;
    const project = pipeline;
    try {
      const projectPath = path.join(PIPELINES_DIR, project);
      if (!fs.existsSync(projectPath)) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      let imageData: string = req.body.data || '';
      const filename: string = req.body.filename || '';

      if (!imageData) {
        res.status(400).json({ error: 'No image data provided' });
        return;
      }

      let ext = 'png';
      if (imageData.startsWith('data:')) {
        const [header, data] = imageData.split(',', 2);
        imageData = data;
        if (header.includes('image/png')) ext = 'png';
        else if (header.includes('image/jpeg') || header.includes('image/jpg')) ext = 'jpg';
        else if (header.includes('image/gif')) ext = 'gif';
        else if (header.includes('image/webp')) ext = 'webp';
      }

      const screenshotsDir = path.join(projectPath, 'screenshots');
      fs.mkdirSync(screenshotsDir, { recursive: true });
      fs.chownSync(screenshotsDir, 1000, 1000);

      const timestamp = Date.now();
      let finalFilename: string;
      if (filename) {
        const safeName = path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_');
        finalFilename = `${safeName}_${timestamp}.${ext}`;
      } else {
        finalFilename = `screenshot_${timestamp}.${ext}`;
      }

      const filePath = path.join(screenshotsDir, finalFilename);
      fs.writeFileSync(filePath, Buffer.from(imageData, 'base64'));
      fs.chownSync(filePath, 1000, 1000);

      const relativePath = `/workspace/screenshots/${finalFilename}`;

      res.json({ status: 'uploaded', path: relativePath, filename: finalFilename });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // System stats (memory + disk)
  app.get('/api/system/stats', (_req: Request, res: Response) => {
    try {
      // Memory from /proc/meminfo
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
      const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0') * 1024;
      const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0') * 1024;
      const memUsed = memTotal - memAvailable;

      // Disk from df on /data
      const df = spawnSync('df', ['-B1', '/data'], { encoding: 'utf-8' });
      let diskTotal = 0, diskUsed = 0;
      if (df.status === 0) {
        const lines = df.stdout.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          diskTotal = parseInt(parts[1]) || 0;
          diskUsed = parseInt(parts[2]) || 0;
        }
      }

      res.json({ memTotal, memUsed, diskTotal, diskUsed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Docker system prune (streaming)
  app.post('/api/system/prune', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const child = spawn('docker', ['system', 'prune', '--volumes', '-f'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
      }
    });

    child.on('close', (code) => {
      res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
      res.end();
    });

    child.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
    });
  });

  // Get settings (port range + allocations + external IP)
  app.get('/api/settings', async (_req: Request, res: Response) => {
    try {
      const settings = readSettings();
      const allocations: Array<{ port: number; project: string; service: string }> = [];

      if (fs.existsSync(PIPELINES_DIR)) {
        for (const name of fs.readdirSync(PIPELINES_DIR).sort()) {
          const fullPath = path.join(PIPELINES_DIR, name);
          if (!fs.statSync(fullPath).isDirectory()) continue;
          const meta = readBenderJson(name);
          if (meta?.externalPorts) {
            for (const [service, port] of Object.entries(meta.externalPorts)) {
              allocations.push({ port, project: name, service });
            }
          }
        }
      }

      const externalIp = await getExternalIp();
      res.json({ portRange: settings.portRange, allocations, externalIp, keys: settings.keys || {} });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Update port range
  app.put('/api/settings/port-range', (req: Request, res: Response) => {
    try {
      const { start, end } = req.body;
      if (typeof start !== 'number' || typeof end !== 'number' || start >= end || start < 1024 || end > 65535) {
        res.status(400).json({ error: 'Invalid port range. Must be 1024-65535, start < end.' });
        return;
      }
      const settings = readSettings();
      settings.portRange = { start, end };
      writeSettings(settings);
      res.json({ status: 'updated', portRange: settings.portRange });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Assign external port to a project service
  app.post('/api/settings/port-mappings', (req: Request, res: Response) => {
    try {
      const { project, service, port } = req.body;
      if (!project || !service || typeof port !== 'number') {
        res.status(400).json({ error: 'project, service, and port are required' });
        return;
      }

      const settings = readSettings();
      if (port < settings.portRange.start || port > settings.portRange.end) {
        res.status(400).json({ error: `Port must be in range ${settings.portRange.start}-${settings.portRange.end}` });
        return;
      }

      // Check port not already in use by another project
      if (fs.existsSync(PIPELINES_DIR)) {
        for (const name of fs.readdirSync(PIPELINES_DIR)) {
          if (name === project) continue;
          const meta = readBenderJson(name);
          if (meta?.externalPorts) {
            for (const existingPort of Object.values(meta.externalPorts)) {
              if (existingPort === port) {
                res.status(409).json({ error: `Port ${port} already allocated to project ${name}` });
                return;
              }
            }
          }
        }
      }

      const meta = readBenderJson(project);
      if (!meta) {
        res.status(404).json({ error: 'Pipeline not found' });
        return;
      }

      meta.externalPorts = meta.externalPorts || {};
      meta.externalPorts[service] = port;
      const harnessPath = path.join(PIPELINES_DIR, project, '.bender.json');
      fs.writeFileSync(harnessPath, JSON.stringify(meta, null, 2));

      res.json({ status: 'assigned', pipeline: project, service, port });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Remove external port mapping
  app.delete('/api/settings/port-mappings/:pipeline/:service', (req: Request, res: Response) => {
    try {
      const pipeline = req.params.pipeline;
      const service = req.params.service;
      const meta = readBenderJson(pipeline);
      if (!meta) {
        res.status(404).json({ error: 'Pipeline not found' });
        return;
      }

      if (meta.externalPorts) {
        delete meta.externalPorts[service];
        if (Object.keys(meta.externalPorts).length === 0) {
          delete meta.externalPorts;
        }
      }

      const harnessPath = path.join(PIPELINES_DIR, pipeline, '.bender.json');
      fs.writeFileSync(harnessPath, JSON.stringify(meta, null, 2));

      res.json({ status: 'removed', pipeline, service });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Update keys
  app.put('/api/settings/keys', (req: Request, res: Response) => {
    try {
      const keys = req.body;
      if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
        res.status(400).json({ error: 'Keys must be an object' });
        return;
      }
      const settings = readSettings();
      const merged = { ...settings.keys, ...keys };
      // Remove keys with empty values
      for (const [k, v] of Object.entries(merged)) {
        if (!v) delete merged[k];
      }
      settings.keys = merged;
      writeSettings(settings);
      res.json({ status: 'updated', keys: settings.keys });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Delete a single key
  app.delete('/api/settings/keys/:key', (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const settings = readSettings();
      if (settings.keys) {
        delete settings.keys[key];
        if (Object.keys(settings.keys).length === 0) {
          delete settings.keys;
        }
      }
      writeSettings(settings);
      res.json({ status: 'deleted', key });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Port forwarding (map a public port to a local port in a project container) ---

  // Get available public ports and listening ports for a project
  app.get('/api/forwards/options/:pipeline', (req: Request, res: Response) => {
    try {
      const pipeline = req.params.pipeline;
    const project = pipeline;
      const settings = readSettings();

      // Find used public ports (from harness.json allocations + active forwards)
      const usedPorts = new Set<number>();
      if (fs.existsSync(PIPELINES_DIR)) {
        for (const name of fs.readdirSync(PIPELINES_DIR)) {
          const fullPath = path.join(PIPELINES_DIR, name);
          if (!fs.statSync(fullPath).isDirectory()) continue;
          const meta = readBenderJson(name);
          if (meta?.externalPorts) {
            for (const port of Object.values(meta.externalPorts)) {
              usedPorts.add(port);
            }
          }
        }
      }
      const forwards = readPortForwards();
      for (const f of forwards) {
        if (getContainerStatus(`port-forward-${f.publicPort}`) === 'running') {
          usedPorts.add(f.publicPort);
        }
      }

      // Available public ports
      const availablePorts: number[] = [];
      for (let p = settings.portRange.start; p <= settings.portRange.end; p++) {
        if (!usedPorts.has(p)) availablePorts.push(p);
      }

      // Detect listening ports inside the project container via /proc/net/tcp
      // This works everywhere without needing ss/netstat installed
      const containerName = `${COMPOSE_PROJECT}-${project}-1`;
      let listeningPorts: number[] = [];
      if (getContainerStatus(containerName) === 'running') {
        const result = spawnSync('docker', [
          'exec', containerName,
          'sh', '-c', "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4==\"0A\"{print $2}' | grep -oE '[0-9A-F]+$' | sort -u",
        ], { encoding: 'utf-8', timeout: 5000 });
        if (result.status === 0 && result.stdout.trim()) {
          const seen = new Set<number>();
          for (const hex of result.stdout.trim().split('\n')) {
            const port = parseInt(hex, 16);
            if (!isNaN(port) && port > 0) seen.add(port);
          }
          listeningPorts = [...seen].sort((a, b) => a - b);
        }
      }

      res.json({ availablePorts, listeningPorts });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const PORT_FORWARDS_STATE = '/data/config/port-forwards.json';

  interface PortForwardEntry {
    publicPort: number;
    localPort: number;
    project: string;
  }

  function readPortForwards(): PortForwardEntry[] {
    try {
      if (fs.existsSync(PORT_FORWARDS_STATE)) {
        return JSON.parse(fs.readFileSync(PORT_FORWARDS_STATE, 'utf-8'));
      }
    } catch {}
    return [];
  }

  function writePortForwards(forwards: PortForwardEntry[]): void {
    fs.writeFileSync(PORT_FORWARDS_STATE, JSON.stringify(forwards, null, 2));
  }

  // List active forwards
  app.get('/api/forwards', (_req: Request, res: Response) => {
    const forwards = readPortForwards().filter(f =>
      getContainerStatus(`port-forward-${f.publicPort}`) === 'running'
    );
    res.json({ forwards });
  });

  // Create a port forward
  app.post('/api/forwards', async (req: Request, res: Response) => {
    try {
      const { project, publicPort, localPort } = req.body;
      if (!project || typeof project !== 'string') {
        res.status(400).json({ error: 'project is required' });
        return;
      }
      if (!publicPort || !localPort || typeof publicPort !== 'number' || typeof localPort !== 'number') {
        res.status(400).json({ error: 'publicPort and localPort are required (numbers)' });
        return;
      }
      const containerName = `${COMPOSE_PROJECT}-${project}-1`;
      if (getContainerStatus(containerName) !== 'running') {
        res.status(400).json({ error: `Project ${project} is not running` });
        return;
      }

      // Stop existing forward on this public port
      stopPortForward(publicPort);

      const ip = await waitForContainerIp(containerName);
      if (!ip) {
        res.status(500).json({ error: `Could not get IP for ${containerName}` });
        return;
      }

      const fwdName = `port-forward-${publicPort}`;
      const result = spawnSync('docker', [
        'run', '-d',
        '--name', fwdName,
        '--network', NETWORK_NAME,
        '-p', `${publicPort}:${publicPort}`,
        '--restart', 'unless-stopped',
        'alpine/socat',
        `TCP-LISTEN:${publicPort},fork,reuseaddr`,
        `TCP:${ip}:${localPort}`,
      ], { encoding: 'utf-8' });
      if (result.status !== 0) {
        res.status(500).json({ error: `Failed to start forward: ${result.stderr}` });
        return;
      }

      // Update state
      const forwards = readPortForwards().filter(f => f.publicPort !== publicPort);
      forwards.push({ publicPort, localPort, project });
      writePortForwards(forwards);

      console.log(`Port forward: 0.0.0.0:${publicPort} -> ${ip}:${localPort} (${containerName})`);
      res.json({ status: 'started', publicPort, localPort, project });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop a port forward
  app.delete('/api/forwards/:publicPort', (req: Request, res: Response) => {
    try {
      const publicPort = parseInt(req.params.publicPort, 10);
      if (isNaN(publicPort)) {
        res.status(400).json({ error: 'Invalid port' });
        return;
      }
      stopPortForward(publicPort);
      const forwards = readPortForwards().filter(f => f.publicPort !== publicPort);
      writePortForwards(forwards);
      res.json({ status: 'stopped' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Harness self-hosted development ---

  const HARNESS_CLONE_DIR = '/data/bender-src';
  const HARNESS_DEV_CONTAINER = 'bender-dev';
  const HARNESS_API_DEV_CONTAINER = 'bender-api-dev';
  const HARNESS_API_DEV_IMAGE = 'bender-api-dev';


  // Find the actual harness root inside the clone (may be at root or in a subdirectory)
  function getHarnessSrcDir(): string {
    if (fs.existsSync(path.join(HARNESS_CLONE_DIR, 'api-service'))) {
      return HARNESS_CLONE_DIR;
    }
    // Check one level of subdirectories
    try {
      for (const entry of fs.readdirSync(HARNESS_CLONE_DIR, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(HARNESS_CLONE_DIR, entry.name, 'api-service'))) {
          return path.join(HARNESS_CLONE_DIR, entry.name);
        }
      }
    } catch {}
    return HARNESS_CLONE_DIR;
  }

  function isHarnessDevRunning(): boolean {
    return getContainerStatus(HARNESS_DEV_CONTAINER) === 'running' &&
           getContainerStatus(HARNESS_API_DEV_CONTAINER) === 'running';
  }

  function setupSSE(res: Response): (type: string, message?: string) => void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    return (type: string, message?: string) => {
      const data = message !== undefined ? { type, message } : { type };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
  }

  function execSync(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(cmd, args, { encoding: 'utf-8' });
    return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
  }

  // Get harness dev environment status
  app.get('/api/harness/status', (_req: Request, res: Response) => {
    try {
      const devContainerStatus = getContainerStatus(HARNESS_DEV_CONTAINER);
      const devApiStatus = getContainerStatus(HARNESS_API_DEV_CONTAINER);
      const sourceExists = fs.existsSync(HARNESS_CLONE_DIR);
      res.json({
        devRunning: devContainerStatus === 'running' && devApiStatus === 'running',
        devContainerStatus,
        devApiStatus,
        sourceExists,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Start dev environment
  app.post('/api/harness/start', (_req: Request, res: Response) => {
    const sendEvent = setupSSE(res);

    (async () => {
      try {
        // Check if already running
        if (isHarnessDevRunning()) {
          sendEvent('log', 'Dev environment already running');
          sendEvent('done');
          res.end();
          return;
        }

        // Step 1: Clone source repo to persistent volume
        if (!fs.existsSync(path.join(HARNESS_CLONE_DIR, '.git'))) {
          // Clean up any stale partial directory
          if (fs.existsSync(HARNESS_CLONE_DIR)) {
            fs.rmSync(HARNESS_CLONE_DIR, { recursive: true, force: true });
          }
          const gitUrl = process.env.HARNESS_GIT_URL;
          const gitUser = process.env.HARNESS_GIT_USER;
          const gitPass = process.env.HARNESS_GIT_PASS;
          if (!gitUrl || !gitUser || !gitPass) {
            throw new Error('HARNESS_GIT_URL, HARNESS_GIT_USER, and HARNESS_GIT_PASS must be set');
          }

          sendEvent('log', 'Cloning harness source...');
          const urlObj = new URL(gitUrl);
          urlObj.username = gitUser;
          urlObj.password = gitPass;
          const cloneResult = execSync('git', ['clone', urlObj.toString(), HARNESS_CLONE_DIR]);
          if (cloneResult.status !== 0) throw new Error(`Git clone failed: ${cloneResult.stderr}`);

          // Configure git for future operations
          execSync('git', ['-C', HARNESS_CLONE_DIR, 'config', 'user.email', 'bender-dev@local']);
          execSync('git', ['-C', HARNESS_CLONE_DIR, 'config', 'user.name', 'Harness Dev']);

          // Fix ownership for VS Code container
          execSync('chown', ['-R', '1000:1000', HARNESS_CLONE_DIR]);
          sendEvent('log', 'Source cloned');
        } else {
          sendEvent('log', 'Using existing dev source...');
        }

        // Step 2: Start VS Code container
        sendEvent('log', 'Starting VS Code container...');
        execSync('docker', ['rm', '-f', HARNESS_DEV_CONTAINER]);
        const devRun = execSync('docker', [
          'run', '-d',
          '--name', HARNESS_DEV_CONTAINER,
          '--network', NETWORK_NAME,
          '--network-alias', HARNESS_DEV_CONTAINER,
          '--restart', 'unless-stopped',
          '-e', 'PUID=1000',
          '-e', 'PGID=1000',
          '-e', 'CLAUDE_CODE_SKIP_PERMISSIONS_DISCLAIMER=1',
          '-e', `PROJECT_NAME=${HARNESS_DEV_CONTAINER}`,
          '-v', `${HARNESS_CLONE_DIR}:/workspace`,
          '-v', `${DATA_DIR}/credentials:/claude-data`,
          '-v', `${DATA_DIR}/config:/claude-config`,
          BENDER_IMAGE,
        ]);
        if (devRun.status !== 0) throw new Error(`Failed to start VS Code container: ${devRun.stderr}`);
        sendEvent('log', 'VS Code container started');

        // Step 3: Build dev API image
        sendEvent('log', 'Building dev API image...');
        execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
        execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
        const apiBuild = execSync('docker', ['build', '-t', HARNESS_API_DEV_IMAGE, path.join(getHarnessSrcDir(), 'api-service')]);
        if (apiBuild.status !== 0) throw new Error(`Dev API build failed: ${apiBuild.stderr}`);
        sendEvent('log', 'Dev API image built');

        // Step 4: Start dev API container
        sendEvent('log', 'Starting dev API container...');
        const apiRun = execSync('docker', [
          'run', '-d',
          '--name', HARNESS_API_DEV_CONTAINER,
          '--network', NETWORK_NAME,
          '--network-alias', 'api-dev',
          '-v', '/var/run/docker.sock:/var/run/docker.sock',
          '-v', `${DATA_DIR}:/data`,
          '-v', `${path.join(getHarnessSrcDir(), 'api-service/templates')}:/app/templates`,
          '-e', 'DOCKER_HOST=unix:///var/run/docker.sock',
          HARNESS_API_DEV_IMAGE,
        ]);
        if (apiRun.status !== 0) throw new Error(`Failed to start dev API: ${apiRun.stderr}`);
        sendEvent('log', 'Dev API started');

        // Step 5: Start dev portal (Vite dev server with HMR)
        sendEvent('log', 'Installing dev portal dependencies...');
        execSync('docker', ['rm', '-f', 'harness-portal-dev']);
        execSync('docker', ['volume', 'create', 'portal-dev-modules']);
        const portalInstall = execSync('docker', [
          'run', '--rm',
          '-v', `${path.join(getHarnessSrcDir(), 'portal')}:/app`,
          '-v', 'portal-dev-modules:/app/node_modules',
          '-w', '/app',
          'node:22-slim',
          'sh', '-c', 'npm ci',
        ]);
        if (portalInstall.status !== 0) throw new Error(`Portal npm install failed: ${portalInstall.stderr}`);
        sendEvent('log', 'Starting dev portal server...');
        const portalRun = execSync('docker', [
          'run', '-d',
          '--name', 'harness-portal-dev',
          '--network', NETWORK_NAME,
          '--network-alias', 'portal-dev',
          '-v', `${path.join(getHarnessSrcDir(), 'portal')}:/app`,
          '-v', 'portal-dev-modules:/app/node_modules',
          '-w', '/app',
          '-e', 'VITE_BASE=/dev/',
          '-e', 'VITE_API_BASE=/dev/api',
          '-e', 'VITE_URL_PREFIX=/dev',
          'node:22-slim',
          'sh', '-c', 'npx vite --host 0.0.0.0 --port 5173',
        ]);
        if (portalRun.status !== 0) throw new Error(`Failed to start dev portal: ${portalRun.stderr}`);
        sendEvent('log', 'Dev portal server started (HMR enabled)');

        // Step 6: Reload nginx to pick up dev portal
        sendEvent('log', 'Reloading nginx...');
        execSync('docker', ['exec', 'bender-nginx', 'nginx', '-s', 'reload']);
        sendEvent('log', 'Nginx reloaded');

        sendEvent('done');
      } catch (err) {
        sendEvent('error', String(err));
      } finally {
        res.end();
      }
    })();
  });

  // Rebuild dev API and portal from current source
  app.post('/api/harness/rebuild', (_req: Request, res: Response) => {
    const sendEvent = setupSSE(res);

    (async () => {
      try {
        if (!fs.existsSync(HARNESS_CLONE_DIR)) {
          sendEvent('error', 'No dev source found. Start dev environment first.');
          res.end();
          return;
        }

        // Rebuild dev API
        sendEvent('log', 'Rebuilding dev API...');
        execSync('docker', ['stop', HARNESS_API_DEV_CONTAINER]);
        execSync('docker', ['rm', HARNESS_API_DEV_CONTAINER]);
        execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
        const apiBuild = execSync('docker', ['build', '-t', HARNESS_API_DEV_IMAGE, path.join(getHarnessSrcDir(), 'api-service')]);
        if (apiBuild.status !== 0) throw new Error(`Dev API build failed: ${apiBuild.stderr}`);

        const apiRun = execSync('docker', [
          'run', '-d',
          '--name', HARNESS_API_DEV_CONTAINER,
          '--network', NETWORK_NAME,
          '--network-alias', 'api-dev',
          '-v', '/var/run/docker.sock:/var/run/docker.sock',
          '-v', `${DATA_DIR}:/data`,
          '-v', `${path.join(getHarnessSrcDir(), 'api-service/templates')}:/app/templates`,
          '-e', 'DOCKER_HOST=unix:///var/run/docker.sock',
          HARNESS_API_DEV_IMAGE,
        ]);
        if (apiRun.status !== 0) throw new Error(`Failed to start dev API: ${apiRun.stderr}`);
        sendEvent('log', 'Dev API rebuilt');

        sendEvent('log', 'Portal uses HMR - no rebuild needed');

        sendEvent('done');
      } catch (err) {
        sendEvent('error', String(err));
      } finally {
        res.end();
      }
    })();
  });

  // Promote dev to prod
  app.post('/api/harness/promote', (_req: Request, res: Response) => {
    const sendEvent = setupSSE(res);

    (async () => {
      try {
        if (!fs.existsSync(HARNESS_CLONE_DIR)) {
          sendEvent('error', 'No dev source found.');
          res.end();
          return;
        }

        // Step 1: Commit and push changes
        sendEvent('log', 'Committing changes...');
        execSync('git', ['-C', HARNESS_CLONE_DIR, 'add', '-A']);
        const commitResult = execSync('git', ['-C', HARNESS_CLONE_DIR, 'commit', '-m', `Promote ${new Date().toISOString()}`, '--allow-empty']);
        sendEvent('log', commitResult.stdout.trim() || 'Changes committed');

        sendEvent('log', 'Pushing to remote...');
        const pushResult = execSync('git', ['-C', HARNESS_CLONE_DIR, 'push']);
        if (pushResult.status !== 0) sendEvent('log', `Push warning: ${pushResult.stderr.trim()}`);
        else sendEvent('log', 'Pushed to remote');

        // Step 2: Build new prod portal
        sendEvent('log', 'Building production portal...');
        const prodHtmlDir = '/data/html-new';
        const promotedHtmlDir = '/data/html-promoted';
        if (fs.existsSync(prodHtmlDir)) {
          fs.rmSync(prodHtmlDir, { recursive: true, force: true });
        }
        fs.mkdirSync(prodHtmlDir, { recursive: true });
        const portalBuild = execSync('docker', [
          'run', '--rm',
          '-v', `${path.join(getHarnessSrcDir(), 'portal')}:/src:ro`,
          '-v', `${prodHtmlDir}:/out`,
          '-w', '/tmp/build',
          'node:22-slim',
          'sh', '-c', 'cp -r /src/. . && rm -rf node_modules && npm ci && npx vite build && cp -r dist/. /out/',
        ]);
        if (portalBuild.status !== 0) throw new Error(`Prod portal build failed: ${portalBuild.stderr}`);
        sendEvent('log', 'Production portal built');

        // Step 3: Build new prod API image
        sendEvent('log', 'Building production API...');
        execSync('docker', ['rmi', 'bender-api-new']);
        const apiBuild = execSync('docker', ['build', '-t', 'bender-api-new', path.join(getHarnessSrcDir(), 'api-service')]);
        if (apiBuild.status !== 0) throw new Error(`Prod API build failed: ${apiBuild.stderr}`);
        sendEvent('log', 'Production API built');

        // Step 4: Swap prod portal files
        sendEvent('log', 'Swapping production portal...');
        if (fs.existsSync(promotedHtmlDir)) {
          fs.rmSync(promotedHtmlDir, { recursive: true, force: true });
        }
        fs.renameSync(prodHtmlDir, promotedHtmlDir);

        // Step 5: Stop old prod API and start new one
        sendEvent('log', 'Swapping production API...');
        let r;
        r = execSync('docker', ['rm', '-f', 'bender-api']);
        sendEvent('log', `  rm old API: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
        r = execSync('docker', ['tag', 'bender-api-new', 'bender-api']);
        sendEvent('log', `  tag new API: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
        r = execSync('docker', ['rmi', 'bender-api-new']);
        sendEvent('log', `  rmi old tag: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);

        // Sync templates from promoted source
        execSync('cp', ['-r', path.join(getHarnessSrcDir(), 'api-service/templates/.'), '/data/templates']);

        const apiRun = execSync('docker', [
          'run', '-d',
          '--name', 'bender-api',
          '--network', NETWORK_NAME,
          '--network-alias', 'api',
          '-v', '/var/run/docker.sock:/var/run/docker.sock',
          '-v', `${DATA_DIR}:/data`,
          '-v', '/data/templates:/app/templates',
          '-e', 'DOCKER_HOST=unix:///var/run/docker.sock',
          '-e', `HARNESS_GIT_URL=${process.env.HARNESS_GIT_URL || ''}`,
          '-e', `HARNESS_GIT_USER=${process.env.HARNESS_GIT_USER || ''}`,
          '-e', `HARNESS_GIT_PASS=${process.env.HARNESS_GIT_PASS || ''}`,
          'bender-api',
        ]);
        sendEvent('log', `  run new API: ${apiRun.status === 0 ? 'ok' : apiRun.stderr.trim()}`);
        if (apiRun.status !== 0) throw new Error(`Failed to start new prod API: ${apiRun.stderr}`);
        sendEvent('log', 'Production API swapped');

        // Step 6: Restart nginx with new portal volume
        sendEvent('log', 'Restarting nginx with promoted portal...');
        r = execSync('docker', ['rm', '-f', 'bender-nginx']);
        sendEvent('log', `  rm nginx: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
        r = execSync('docker', [
          'run', '-d',
          '--name', 'bender-nginx',
          '--network', NETWORK_NAME,
          '-p', '80:80',
          '-p', '443:443',
          '-v', `${promotedHtmlDir}:/usr/share/nginx/html:ro`,
          '-v', '/app/nginx.conf:/etc/nginx/conf.d/default.conf:ro',
          '-v', '/app/ssl:/etc/nginx/ssl:ro',
          'nginx:alpine',
        ]);
        sendEvent('log', `  run nginx: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
        sendEvent('log', 'Nginx restarted');

        // Step 7: Clean up dev containers (except this API - clean it last)
        sendEvent('log', 'Cleaning up dev environment...');
        execSync('docker', ['rm', '-f', HARNESS_DEV_CONTAINER]);
        execSync('docker', ['rm', '-f', 'harness-portal-dev']);
        execSync('docker', ['volume', 'rm', '-f', 'portal-dev-modules']);

        // Mark source as promoted (for setup.sh to use on restart)
        fs.writeFileSync(path.join(HARNESS_CLONE_DIR, '.promoted'), new Date().toISOString());

        sendEvent('log', 'Promotion complete! Production is now using the dev changes.');
        sendEvent('done');
        res.end();

        // Kill the dev API last (this container) - runs after response is sent
        setTimeout(() => {
          execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
          execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
        }, 1000);
        return;
      } catch (err) {
        sendEvent('error', String(err));
      } finally {
        res.end();
      }
    })();
  });

  // Abandon dev environment
  app.post('/api/harness/abandon', (_req: Request, res: Response) => {
    const sendEvent = setupSSE(res);

    (async () => {
      try {
        // Stop and remove dev containers (except this API)
        sendEvent('log', 'Stopping dev containers...');
        execSync('docker', ['rm', '-f', HARNESS_DEV_CONTAINER]);
        execSync('docker', ['rm', '-f', 'harness-portal-dev']);
        execSync('docker', ['volume', 'rm', '-f', 'portal-dev-modules']);
        sendEvent('log', 'Dev containers removed');

        // Remove dev source (discard changes)
        sendEvent('log', 'Removing dev source...');
        if (fs.existsSync(HARNESS_CLONE_DIR) && !fs.existsSync(path.join(HARNESS_CLONE_DIR, '.promoted'))) {
          fs.rmSync(HARNESS_CLONE_DIR, { recursive: true, force: true });
          sendEvent('log', 'Dev source removed');
        } else {
          sendEvent('log', 'Keeping promoted source (only removing dev containers)');
        }

        // Reload nginx
        execSync('docker', ['exec', 'bender-nginx', 'nginx', '-s', 'reload']);

        sendEvent('done');
        res.end();

        // Kill this dev API container last - after response is sent
        setTimeout(() => {
          execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
          execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
        }, 1000);
        return;
      } catch (err) {
        sendEvent('error', String(err));
      } finally {
        res.end();
      }
    })();
  });

}
