// Thin wrappers around `docker` for inspecting containers and their IPs, plus a
// recursive chown used when fixing up scaffolded file ownership.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export function getContainerStatus(containerName: string): string {
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

export function getContainerIp(containerName: string): string | null {
  const result = spawnSync('docker', [
    'inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', containerName,
  ], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const ip = result.stdout.trim();
  return ip || null;
}

export function waitForContainerIp(containerName: string, timeout = 30000): Promise<string | null> {
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

export function chownRecursive(target: string, uid: number, gid: number): void {
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
