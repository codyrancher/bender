import { spawnSync } from 'child_process';

// Synchronous command runner returning a normalized { status, stdout, stderr }
// (vs node's child_process.execSync which throws and returns only stdout).
export function execSync(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}
