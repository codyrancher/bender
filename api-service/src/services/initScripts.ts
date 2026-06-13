// Project lifecycle hook scripts run inside the project container: init.sh on
// creation, and on-sidecars-up.sh whenever sidecars transition stopped → running.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PIPELINES_DIR, COMPOSE_PROJECT } from '../config/constants';
import { getContainerStatus } from '../utils/container';

export function runInitScript(project: string): void {
  const initScript = path.join(PIPELINES_DIR, project, 'init.sh');
  if (!fs.existsSync(initScript)) return;
  const containerName = `${COMPOSE_PROJECT}-${project}-1`;
  spawn('docker', [
    'exec', '-d', '-u', '1000:1000', containerName, 'bash', '-c',
    'chmod +x /workspace/init.sh && /workspace/init.sh > /workspace/.init.log 2>&1',
  ], { stdio: 'ignore', detached: true }).unref();
}

// Run the on-sidecars-up.sh hook (if present) inside the project container.
// Called whenever sidecars transition from stopped → running.
export function runSidecarsUpScript(project: string): void {
  const hookScript = path.join(PIPELINES_DIR, project, 'on-sidecars-up.sh');
  if (!fs.existsSync(hookScript)) return;
  const containerName = `${COMPOSE_PROJECT}-${project}-1`;
  if (getContainerStatus(containerName) !== 'running') return;
  spawn('docker', [
    'exec', '-d', '-u', '1000:1000', containerName, 'bash', '-c',
    'chmod +x /workspace/on-sidecars-up.sh && /workspace/on-sidecars-up.sh > /workspace/.on-sidecars-up.log 2>&1',
  ], { stdio: 'ignore', detached: true }).unref();
}
