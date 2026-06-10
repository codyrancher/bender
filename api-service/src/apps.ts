import { Router, Request, Response } from 'express';
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { SidecarDef } from './templates';

const DATA_DIR = '/data';
const APPS_FILE = path.join(DATA_DIR, 'config', 'shared-apps.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'config', 'app-sessions.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'config', 'settings.json');
const PIPELINES_DIR = path.join(DATA_DIR, 'pipelines');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const COMPOSE_PROJECT = 'bender';
const NETWORK_NAME = 'bender_default';

const KEY_DEFAULTS: Record<string, string> = {
  rancherTag: 'v2.13-head',
};

interface SharedApp {
  project: string;
  template?: string;
  sharedBy: string;
  sharedAt: string;
}

interface AppSession {
  id: string;
  project: string;
  user: string;
  browserPort?: number;
  browserHost?: string;
  status: 'running' | 'stopped';
  startedAt: string;
  containerName: string;
}

function readApps(): SharedApp[] {
  try {
    return JSON.parse(fs.readFileSync(APPS_FILE, 'utf-8'));
  } catch { return []; }
}

function writeApps(apps: SharedApp[]): void {
  fs.mkdirSync(path.dirname(APPS_FILE), { recursive: true });
  fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2));
}


function readBenderJson(project: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(PIPELINES_DIR, project, '.bender.json'), 'utf-8'));
  } catch { return null; }
}

function getContainerStatus(name: string): 'running' | 'stopped' | 'not_found' {
  try {
    const out = execSync(`docker inspect --format '{{.State.Running}}' ${name} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return out === 'true' ? 'running' : 'stopped';
  } catch { return 'not_found'; }
}


function readSettings(): any {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch {}
  return { portRange: { start: 8200, end: 8299 } };
}

function getTemplateBrowserSidecar(project: string): SidecarDef | null {
  const meta = readBenderJson(project);
  if (!meta) return null;

  // Read from template.json (same source as startSidecars in routes.ts)
  if (meta.template) {
    try {
      const tmplPath = path.join(TEMPLATES_DIR, meta.template, 'template.json');
      const tmpl = JSON.parse(fs.readFileSync(tmplPath, 'utf-8'));
      const browserSidecar = tmpl.sidecars?.find((s: any) => s.suffix === 'browser');
      if (browserSidecar) return browserSidecar;
    } catch {}
  }

  // Default browser sidecar (matches DEFAULT_BROWSER_SIDECAR in templates.ts)
  return {
    suffix: 'browser',
    image: 'lscr.io/linuxserver/chromium:latest',
    shm_size: '1gb',
    network_container: true,
    env: {
      PUID: '1000',
      PGID: '1000',
      CUSTOM_PORT: '3000',
      CHROME_CLI: '--no-first-run --start-maximized --disable-infobars --ignore-certificate-errors --force-dark-mode',
    },
  };
}

export function registerAppRoutes(router: Router): void {
  // List shared apps
  router.get('/api/apps', (_req: Request, res: Response) => {
    const apps = readApps();
    // Filter out apps whose projects no longer exist
    const valid = apps.filter(a => fs.existsSync(path.join(PIPELINES_DIR, a.project)));
    if (valid.length !== apps.length) writeApps(valid);
    res.json({ apps: valid });
  });

  // Check if a specific project is shared
  router.get('/api/apps/:pipeline', (req: Request, res: Response) => {
    const apps = readApps();
    const shared = apps.some(a => a.project === req.params.pipeline);
    res.json({ shared });
  });

  // Share a project
  router.post('/api/apps/:pipeline/share', (req: Request, res: Response) => {
    const project = req.params.pipeline;
    if (!fs.existsSync(path.join(PIPELINES_DIR, project))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const apps = readApps();
    if (apps.some(a => a.project === project)) {
      return res.json({ status: 'already_shared' });
    }

    const meta = readBenderJson(project);
    const user = 'local';

    apps.push({
      project,
      template: meta?.template,
      sharedBy: user,
      sharedAt: new Date().toISOString(),
    });
    writeApps(apps);
    res.json({ status: 'shared' });
  });

  // Unshare a project
  router.post('/api/apps/:pipeline/unshare', (req: Request, res: Response) => {
    const project = req.params.pipeline;
    const apps = readApps();
    const filtered = apps.filter(a => a.project !== project);
    writeApps(filtered);

    // Stop the shared app session container for this project
    const sessionContainer = `${COMPOSE_PROJECT}-${project}-app-session`;
    try {
      execSync(`docker stop ${sessionContainer} && docker rm ${sessionContainer}`, { stdio: 'ignore' });
    } catch {}

    res.json({ status: 'unshared' });
  });

  // Build the shared session object for a project (one per project, all users share it).
  // Returns null if the shared session container is not running.
  function getSharedSession(project: string, user: string): AppSession | null {
    const containerName = `${COMPOSE_PROJECT}-${project}-app-session`;
    if (getContainerStatus(containerName) !== 'running') return null;
    const sidecarDef = getTemplateBrowserSidecar(project);
    const browserPort = sidecarDef?.env?.CUSTOM_PORT ? parseInt(sidecarDef.env.CUSTOM_PORT) : 3000;
    return {
      id: 'shared',
      project,
      user,
      browserPort,
      browserHost: containerName,
      status: 'running',
      startedAt: '',
      containerName,
    };
  }

  // List sessions for an app — returns the shared session if running
  router.get('/api/apps/:pipeline/sessions', (req: Request, res: Response) => {
    const project = req.params.pipeline;
    const user = 'local';
    const session = getSharedSession(project, user);
    res.json({ sessions: session ? [session] : [] });
  });

  // Launch/join shared app session — one container per project, reused by all users
  router.post('/api/apps/:pipeline/sessions', async (req: Request, res: Response) => {
    const project = req.params.pipeline;
    const user = 'local';

    // Check app is shared
    const apps = readApps();
    if (!apps.some(a => a.project === project)) {
      return res.status(404).json({ error: 'App not shared' });
    }

    // Check project container is running
    const projectContainer = `${COMPOSE_PROJECT}-${project}-1`;
    if (getContainerStatus(projectContainer) !== 'running') {
      return res.status(400).json({ error: 'Project is not running' });
    }

    // Reuse the shared session container if already running
    const existing = getSharedSession(project, user);
    if (existing) return res.json(existing);

    const containerName = `${COMPOSE_PROJECT}-${project}-app-session`;

    // Get the browser sidecar config from the project's template
    const sidecarDef = getTemplateBrowserSidecar(project);
    if (!sidecarDef) {
      return res.status(500).json({ error: 'Could not determine browser config' });
    }

    // Get the project container's IP so apphost resolves to it inside the session browser.
    let projectIp = '';
    try {
      projectIp = execSync(
        `docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${projectContainer}`,
        { encoding: 'utf-8' }
      ).trim();
    } catch {}

    const settings = readSettings();
    const args = [
      'run', '-d',
      '--name', containerName,
      '--restart', 'unless-stopped',
      '--network', NETWORK_NAME,
    ];

    if (projectIp) {
      args.push('--add-host', `apphost:${projectIp}`);
    }

    if (sidecarDef.privileged) args.push('--privileged');
    if (sidecarDef.shm_size) args.push('--shm-size', sidecarDef.shm_size);
    if (sidecarDef.cap_add) {
      for (const cap of sidecarDef.cap_add) args.push('--cap-add', cap);
    }
    if (sidecarDef.volumes) {
      for (const vol of sidecarDef.volumes) {
        args.push('-v', vol.replace(/\{\{projectName\}\}/g, project));
      }
    }
    if (sidecarDef.entrypoint) args.push('--entrypoint', sidecarDef.entrypoint);

    if (sidecarDef.env) {
      const meta = readBenderJson(project);
      for (const [k, v] of Object.entries(sidecarDef.env)) {
        let value = v.replace(/\{\{projectName\}\}/g, project);
        value = value.replace(/\{\{settings\.(\w+)\}\}/g, (_: string, key: string) => settings.keys?.[key] || KEY_DEFAULTS[key] || '');
        value = value.replace(/\{\{harness\.(\w+)\}\}/g, (_: string, key: string) => meta?.vars?.[key] || '');
        if (projectIp) value = value.replace(/localhost/g, 'apphost');
        args.push('-e', `${k}=${value}`);
      }
    }

    let image = sidecarDef.image.replace(/\{\{settings\.(\w+)\}\}/g, (_: string, key: string) => settings.keys?.[key] || KEY_DEFAULTS[key] || '');
    args.push(image);
    if (sidecarDef.command) args.push(...sidecarDef.command);

    console.log(`Starting shared app session ${containerName}`);
    try {
      execFileSync('docker', args, { stdio: 'pipe' });
    } catch (err: any) {
      console.error(`Failed to start app session: ${err.stderr?.toString()}`);
      return res.status(500).json({ error: 'Failed to start session container' });
    }

    res.json(getSharedSession(project, user));
  });

  // Stop the shared app session (owner only, removes container so it recreates fresh)
  router.delete('/api/apps/:pipeline/sessions/:sessionId', (req: Request, res: Response) => {
    const { project } = req.params;
    const containerName = `${COMPOSE_PROJECT}-${project}-app-session`;
    try {
      execSync(`docker stop ${containerName} && docker rm ${containerName}`, { stdio: 'ignore' });
    } catch {}
    res.json({ status: 'stopped' });
  });

  // Ensure a port forwarder exists for a shared app's loopback port.
  // Creates a socat container sharing the project container's network namespace
  // that forwards from 0.0.0.0:{exposedPort} to 127.0.0.1:{port}.
  // The exposed port is 10000 + original port (e.g., 6006 -> 16006).
  // nginx then proxies to the project container on the exposed port.
  router.post('/api/apps/:pipeline/port-forward/:port', (req: Request, res: Response) => {
    const { project } = req.params;
    const port = parseInt(req.params.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Invalid port' });
    }

    const projectContainer = `${COMPOSE_PROJECT}-${project}-1`;
    if (getContainerStatus(projectContainer) !== 'running') {
      return res.status(400).json({ error: 'Project is not running' });
    }

    const exposedPort = 10000 + port;
    const forwarderName = `${COMPOSE_PROJECT}-${project}-pf-${port}`;

    // If already running, return immediately
    if (getContainerStatus(forwarderName) === 'running') {
      return res.json({ status: 'running', exposedPort, container: forwarderName });
    }

    // Clean up stopped container if exists
    try { execSync(`docker rm ${forwarderName}`, { stdio: 'ignore' }); } catch {}

    try {
      execFileSync('docker', [
        'run', '-d',
        '--name', forwarderName,
        '--restart', 'unless-stopped',
        '--network', `container:${projectContainer}`,
        'alpine/socat',
        `TCP-LISTEN:${exposedPort},fork,reuseaddr`,
        `TCP:127.0.0.1:${port}`,
      ], { stdio: 'pipe' });
    } catch (err: any) {
      console.error(`Failed to start port forwarder: ${err.stderr?.toString()}`);
      return res.status(500).json({ error: 'Failed to start port forwarder' });
    }

    res.json({ status: 'started', exposedPort, container: forwarderName });
  });
}
