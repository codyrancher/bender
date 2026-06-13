// Per-stage workspace snapshots (rsync, hardlink-deduped). Snapshot the workspace
// at the start of each stage so a stage can be re-run from its exact starting
// state, changing only the (edited) pipeline/skill definition. node_modules is
// excluded (stable/regenerable); --link-dest hardlinks unchanged files against the
// previous stage's snapshot so disk cost is just the delta.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PIPELINES_DIR, SNAPSHOT_STAGES } from '../config/constants';

export function snapshotDir(project: string, runId: number, stageIndex: number): string {
  return path.join(PIPELINES_DIR, project, '.snapshots', `run-${runId}`, `stage-${stageIndex}`);
}

export function snapshotWorkspace(project: string, runId: number, stageIndex: number): void {
  if (!SNAPSHOT_STAGES) return;
  const ws = path.join(PIPELINES_DIR, project);
  if (!fs.existsSync(ws)) return;
  const dest = snapshotDir(project, runId, stageIndex);
  fs.mkdirSync(dest, { recursive: true });
  const args = ['-a', '--delete', '--exclude=node_modules', '--exclude=.snapshots', '--exclude=.browser-recorder.mjs'];
  // Hardlink unchanged files against the previous stage's snapshot (cheap).
  const prev = snapshotDir(project, runId, stageIndex - 1);
  if (stageIndex > 0 && fs.existsSync(prev)) args.push(`--link-dest=${prev}`);
  args.push(ws + '/', dest + '/');
  spawnSync('rsync', args, { stdio: 'ignore' });
}

// Restore the workspace to a stage's snapshot, but keep the CURRENT pipeline.md
// and skills (so the only delta from the original run is the edited definition).
// node_modules and .snapshots are left untouched.
export function restoreWorkspace(project: string, runId: number, stageIndex: number): boolean {
  const snap = snapshotDir(project, runId, stageIndex);
  if (!fs.existsSync(snap)) return false;
  const ws = path.join(PIPELINES_DIR, project);
  const r = spawnSync('rsync', [
    '-a', '--delete',
    '--exclude=node_modules', '--exclude=.snapshots',
    '--exclude=/pipeline.md', '--exclude=/.claude/skills',
    snap + '/', ws + '/',
  ], { stdio: 'ignore' });
  return r.status === 0;
}
