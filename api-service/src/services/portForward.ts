// Public port forwarding: allocates ports from the configured range and runs a
// socat container per forward (public 0.0.0.0:port → sidecar container:port).
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  PIPELINES_DIR, COMPOSE_PROJECT, NETWORK_NAME, EXTERNAL_PORT_TARGETS,
} from '../config/constants';
import { getContainerStatus, getContainerIp, waitForContainerIp } from '../utils/container';
import { readBenderJson } from './benderJson';
import { readSettings } from './settings';

export function findNextAvailablePort(): number | null {
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

export function stopPortForward(port: number): void {
  const name = `port-forward-${port}`;
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf-8', stdio: 'ignore' });
}

export function startPortForwardAsync(port: number, targetContainer: string, targetPort: number): void {
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

export function startPortForwardsForProject(project: string): void {
  const meta = readBenderJson(project);
  if (!meta?.externalPorts) return;
  for (const [service, port] of Object.entries(meta.externalPorts)) {
    const targetPort = EXTERNAL_PORT_TARGETS[service];
    if (!targetPort) continue;
    const containerName = `${COMPOSE_PROJECT}-${project}-${service}-1`;
    startPortForwardAsync(port, containerName, targetPort);
  }
}

export function stopPortForwardsForProject(project: string): void {
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
