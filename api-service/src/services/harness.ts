// Self-hosted development harness: clone the bender source into a persistent
// volume and run a dev VS Code + dev API + HMR portal alongside production, then
// promote those changes to prod or abandon them. The operations stream progress
// through a `send(type, message?)` emitter (the route wires that to SSE).
import fs from 'fs';
import path from 'path';
import { NETWORK_NAME, DATA_DIR, BENDER_IMAGE } from '../config/constants';
import { getContainerStatus } from '../utils/container';
import { execSync } from '../utils/exec';

type Send = (type: string, message?: string) => void;

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

export function getHarnessStatus() {
  const devContainerStatus = getContainerStatus(HARNESS_DEV_CONTAINER);
  const devApiStatus = getContainerStatus(HARNESS_API_DEV_CONTAINER);
  return {
    devRunning: devContainerStatus === 'running' && devApiStatus === 'running',
    devContainerStatus,
    devApiStatus,
    sourceExists: fs.existsSync(HARNESS_CLONE_DIR),
  };
}

export async function startHarness(send: Send): Promise<void> {
  if (isHarnessDevRunning()) {
    send('log', 'Dev environment already running');
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

    send('log', 'Cloning harness source...');
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
    send('log', 'Source cloned');
  } else {
    send('log', 'Using existing dev source...');
  }

  // Step 2: Start VS Code container
  send('log', 'Starting VS Code container...');
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
  send('log', 'VS Code container started');

  // Step 3: Build dev API image
  send('log', 'Building dev API image...');
  execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
  execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
  const apiBuild = execSync('docker', ['build', '-t', HARNESS_API_DEV_IMAGE, path.join(getHarnessSrcDir(), 'api-service')]);
  if (apiBuild.status !== 0) throw new Error(`Dev API build failed: ${apiBuild.stderr}`);
  send('log', 'Dev API image built');

  // Step 4: Start dev API container
  send('log', 'Starting dev API container...');
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
  send('log', 'Dev API started');

  // Step 5: Start dev portal (Vite dev server with HMR)
  send('log', 'Installing dev portal dependencies...');
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
  send('log', 'Starting dev portal server...');
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
  send('log', 'Dev portal server started (HMR enabled)');

  // Step 6: Reload nginx to pick up dev portal
  send('log', 'Reloading nginx...');
  execSync('docker', ['exec', 'bender-nginx', 'nginx', '-s', 'reload']);
  send('log', 'Nginx reloaded');
}

export async function rebuildHarness(send: Send): Promise<void> {
  if (!fs.existsSync(HARNESS_CLONE_DIR)) {
    throw new Error('No dev source found. Start dev environment first.');
  }

  send('log', 'Rebuilding dev API...');
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
  send('log', 'Dev API rebuilt');
  send('log', 'Portal uses HMR - no rebuild needed');
}

export async function promoteHarness(send: Send): Promise<void> {
  if (!fs.existsSync(HARNESS_CLONE_DIR)) {
    throw new Error('No dev source found.');
  }

  // Step 1: Commit and push changes
  send('log', 'Committing changes...');
  execSync('git', ['-C', HARNESS_CLONE_DIR, 'add', '-A']);
  const commitResult = execSync('git', ['-C', HARNESS_CLONE_DIR, 'commit', '-m', `Promote ${new Date().toISOString()}`, '--allow-empty']);
  send('log', commitResult.stdout.trim() || 'Changes committed');

  send('log', 'Pushing to remote...');
  const pushResult = execSync('git', ['-C', HARNESS_CLONE_DIR, 'push']);
  if (pushResult.status !== 0) send('log', `Push warning: ${pushResult.stderr.trim()}`);
  else send('log', 'Pushed to remote');

  // Step 2: Build new prod portal
  send('log', 'Building production portal...');
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
  send('log', 'Production portal built');

  // Step 3: Build new prod API image
  send('log', 'Building production API...');
  execSync('docker', ['rmi', 'bender-api-new']);
  const apiBuild = execSync('docker', ['build', '-t', 'bender-api-new', path.join(getHarnessSrcDir(), 'api-service')]);
  if (apiBuild.status !== 0) throw new Error(`Prod API build failed: ${apiBuild.stderr}`);
  send('log', 'Production API built');

  // Step 4: Swap prod portal files
  send('log', 'Swapping production portal...');
  if (fs.existsSync(promotedHtmlDir)) {
    fs.rmSync(promotedHtmlDir, { recursive: true, force: true });
  }
  fs.renameSync(prodHtmlDir, promotedHtmlDir);

  // Step 5: Stop old prod API and start new one
  send('log', 'Swapping production API...');
  let r;
  r = execSync('docker', ['rm', '-f', 'bender-api']);
  send('log', `  rm old API: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
  r = execSync('docker', ['tag', 'bender-api-new', 'bender-api']);
  send('log', `  tag new API: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
  r = execSync('docker', ['rmi', 'bender-api-new']);
  send('log', `  rmi old tag: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);

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
  send('log', `  run new API: ${apiRun.status === 0 ? 'ok' : apiRun.stderr.trim()}`);
  if (apiRun.status !== 0) throw new Error(`Failed to start new prod API: ${apiRun.stderr}`);
  send('log', 'Production API swapped');

  // Step 6: Restart nginx with new portal volume
  send('log', 'Restarting nginx with promoted portal...');
  r = execSync('docker', ['rm', '-f', 'bender-nginx']);
  send('log', `  rm nginx: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
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
  send('log', `  run nginx: ${r.status === 0 ? 'ok' : r.stderr.trim()}`);
  send('log', 'Nginx restarted');

  // Step 7: Clean up dev containers (except this API - clean it last)
  send('log', 'Cleaning up dev environment...');
  execSync('docker', ['rm', '-f', HARNESS_DEV_CONTAINER]);
  execSync('docker', ['rm', '-f', 'harness-portal-dev']);
  execSync('docker', ['volume', 'rm', '-f', 'portal-dev-modules']);

  // Mark source as promoted (for setup.sh to use on restart)
  fs.writeFileSync(path.join(HARNESS_CLONE_DIR, '.promoted'), new Date().toISOString());

  send('log', 'Promotion complete! Production is now using the dev changes.');

  // Kill the dev API last (this container) — runs after the response is sent.
  setTimeout(() => {
    execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
    execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
  }, 1000);
}

export async function abandonHarness(send: Send): Promise<void> {
  // Stop and remove dev containers (except this API)
  send('log', 'Stopping dev containers...');
  execSync('docker', ['rm', '-f', HARNESS_DEV_CONTAINER]);
  execSync('docker', ['rm', '-f', 'harness-portal-dev']);
  execSync('docker', ['volume', 'rm', '-f', 'portal-dev-modules']);
  send('log', 'Dev containers removed');

  // Remove dev source (discard changes)
  send('log', 'Removing dev source...');
  if (fs.existsSync(HARNESS_CLONE_DIR) && !fs.existsSync(path.join(HARNESS_CLONE_DIR, '.promoted'))) {
    fs.rmSync(HARNESS_CLONE_DIR, { recursive: true, force: true });
    send('log', 'Dev source removed');
  } else {
    send('log', 'Keeping promoted source (only removing dev containers)');
  }

  // Reload nginx
  execSync('docker', ['exec', 'bender-nginx', 'nginx', '-s', 'reload']);

  // Kill this dev API container last — after the response is sent.
  setTimeout(() => {
    execSync('docker', ['rmi', HARNESS_API_DEV_IMAGE]);
    execSync('docker', ['rm', '-f', HARNESS_API_DEV_CONTAINER]);
  }, 1000);
}
