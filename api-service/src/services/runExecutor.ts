// The pipeline run-execution engine: the runs SQLite database, and the fork/join
// executor that runs each stage's skill via the Claude CLI inside the pipeline
// container, streams its output as logs, reads the success-criteria verdict, and
// collects the artifacts it produced. Owns its DB connection + in-flight run set.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { broadcast } from './events';
import {
  DATA_DIR, PIPELINES_DIR, COMPOSE_PROJECT, CLAUDE_CONFIG_DIR, STAGE_TIMEOUT_MS, BROWSER_RECORDER_JS,
} from '../config/constants';
import { readBenderJson, pipelineArgEnvArgs } from './benderJson';
import { snapshotWorkspace } from './snapshots';
import { chownRecursive } from '../utils/container';
import { startSidecars } from './sidecars';

const DB_PATH = path.join(DATA_DIR, 'config', 'runs.db');
let runsDb: Database.Database;

export function getRunsDb(): Database.Database {
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
    const runCols = new Set((runsDb.prepare('PRAGMA table_info(pipeline_runs)').all() as { name: string }[]).map(c => c.name));
    if (!runCols.has('pipeline_md')) runsDb.exec('ALTER TABLE pipeline_runs ADD COLUMN pipeline_md TEXT');
    // Per-pipeline UID: runs are scoped to a specific pipeline instance so a
    // reused name doesn't inherit a previous pipeline's run history.
    if (!runCols.has('pipeline_uid')) runsDb.exec('ALTER TABLE pipeline_runs ADD COLUMN pipeline_uid TEXT');

    // Any run/stage left 'running' belongs to a prior process — mark it
    // cancelled. Stages that had actually started get a frozen completed_at +
    // duration so their elapsed timer stops (otherwise it ticks forever); ones
    // that never started just flip status.
    runsDb.exec(`
      UPDATE pipeline_stage_records
        SET status = 'cancelled',
            completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            duration_ms = CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
        WHERE status IN ('running', 'pending') AND started_at IS NOT NULL AND duration_ms IS NULL
          AND run_id IN (SELECT id FROM pipeline_runs WHERE status = 'running');
      UPDATE pipeline_stage_records
        SET status = 'cancelled'
        WHERE status IN ('running', 'pending') AND started_at IS NULL
          AND run_id IN (SELECT id FROM pipeline_runs WHERE status = 'running');
      UPDATE pipeline_runs
        SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE status = 'running';
    `);
    // Repair rows orphaned by an earlier build that lacked the freeze above.
    runsDb.exec(`
      UPDATE pipeline_stage_records
        SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            duration_ms = CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
        WHERE status = 'cancelled' AND started_at IS NOT NULL AND duration_ms IS NULL;
    `);
  }
  return runsDb;
}

// Tracks in-flight runs so they can be cancelled mid-execution.
const activeRuns = new Map<number, { cancelled: boolean }>();

// Artifacts are written to the pipeline's workspace (shared volume, /workspace
// inside the pipeline container) under artifacts/run-<id>/stage-<idx>/ and served
// back via the API.
const ARTIFACTS_ROOT = 'artifacts';

export function stageArtifactDir(project: string, runId: number, stageIndex: number): string {
  return path.join(PIPELINES_DIR, project, ARTIFACTS_ROOT, `run-${runId}`, `stage-${stageIndex}`);
}

function artifactUrl(project: string, runId: number, stageIndex: number, filename: string): string {
  return `/api/pipelines/${encodeURIComponent(project)}/runs/${runId}/artifacts/${stageIndex}/${encodeURIComponent(filename)}`;
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

// Short, human-readable summary of a tool_use block for the live log.
function toolSummary(b: any): string {
  const inp = b?.input || {};
  if (b?.name === 'Bash' && inp.command) return `: ${String(inp.command).split('\n')[0].slice(0, 160)}`;
  if (inp.file_path) return `: ${inp.file_path}`;
  if (inp.path) return `: ${inp.path}`;
  if (inp.pattern) return `: ${inp.pattern}`;
  if (inp.url) return `: ${inp.url}`;
  return '';
}

// Turn one `claude --output-format stream-json` event into a log line (or null).
function formatStreamEvent(evt: any): string | null {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.type === 'system' && evt.subtype === 'init') {
    return `[claude] model ${evt.model || '?'} · ${(evt.tools || []).length} tools`;
  }
  if (evt.type === 'assistant' && evt.message?.content) {
    const parts: string[] = [];
    for (const b of evt.message.content) {
      if (b.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
      else if (b.type === 'tool_use') parts.push(`→ ${b.name}${toolSummary(b)}`);
    }
    return parts.length ? parts.join('\n') : null;
  }
  if (evt.type === 'user' && evt.message?.content) {
    for (const b of evt.message.content) {
      if (b.type === 'tool_result') {
        const c = typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content) ? b.content.map((x: any) => x?.text || '').join('') : '';
        const firstLine = (c || '').split('\n').find((l: string) => l.trim()) || '';
        return firstLine ? `  ⎿ ${firstLine.slice(0, 200)}` : null;
      }
    }
  }
  return null;
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

  // Snapshot the workspace at the start of this stage so it can be re-run from
  // exactly this state later (changing only the pipeline/skill definition).
  try { snapshotWorkspace(pipeline, runId, idx); } catch { /* best effort */ }

  // Stage artifact drop inside the workspace (host path is the same dir via the
  // /workspace bind mount), cleared before the run.
  const wsArtifacts = `/workspace/.artifacts/stage-${idx}`;
  const hostArtifacts = path.join(PIPELINES_DIR, pipeline, '.artifacts', `stage-${idx}`);
  fs.rmSync(hostArtifacts, { recursive: true, force: true });
  fs.mkdirSync(hostArtifacts, { recursive: true });
  try { chownRecursive(path.join(PIPELINES_DIR, pipeline, '.artifacts'), 1000, 1000); } catch { /* best effort */ }

  // Best-effort: record the live browser session for this stage if the browser
  // CDP endpoint is reachable and playwright-core is available in the workspace.
  let recorder: ReturnType<typeof spawn> | null = null;
  try {
    const cdpUp = spawnSync('docker', ['exec', '-u', '1000:1000', container, 'bash', '-lc', 'curl -sf --max-time 3 http://localhost:9222/json/version >/dev/null'], { stdio: 'ignore' }).status === 0;
    const pwOk = cdpUp && spawnSync('docker', ['exec', container, 'test', '-d', '/workspace/node_modules/playwright-core'], { stdio: 'ignore' }).status === 0;
    if (pwOk) {
      fs.writeFileSync(path.join(PIPELINES_DIR, pipeline, '.browser-recorder.mjs'), BROWSER_RECORDER_JS);
      recorder = spawn('docker', ['exec', '-u', '1000:1000', container, 'bash', '-lc', `node /workspace/.browser-recorder.mjs ${wsArtifacts}/browser-session.mp4`], { stdio: 'ignore' });
      logs += `\n[${ts()}] Recording browser session (debug)…`;
    }
  } catch { /* best effort — recording is optional */ }

  const prompt = buildStagePrompt(stage, wsArtifacts);

  // Stream Claude's reasoning/tool-use live via stream-json (plain -p only
  // prints the final result once, at the very end — no live logs).
  let finalText = '';
  let timedOut = false;
  const exitCode = await new Promise<number>((resolve) => {
    const p = spawn('docker', [
      'exec', '-u', '1000:1000',
      '-e', `CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}`,
      '-e', `STAGE_ARTIFACTS=${wsArtifacts}`,
      '-e', `STAGE_PROMPT=${prompt}`,
      // Self-identity so the spawn-pipeline tool can tag any child pipeline with
      // its creator (parent pipeline / run / stage).
      '-e', `BENDER_PIPELINE=${pipeline}`,
      '-e', `BENDER_RUN_ID=${runId}`,
      '-e', `BENDER_STAGE_NAME=${stage.stage_name}`,
      '-e', `BENDER_STAGE_INDEX=${stage.stage_index}`,
      // Re-inject pipeline args from .bender.json so edits made between runs
      // (via the args editor) take effect without recreating the container.
      ...pipelineArgEnvArgs(readBenderJson(pipeline)?.args),
      container,
      'bash', '-lc',
      'mkdir -p "$STAGE_ARTIFACTS"; cd /workspace && claude --dangerously-skip-permissions --output-format stream-json --verbose -p "$STAGE_PROMPT" 2>&1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let lastFlush = Date.now();
    let buffer = '';
    const append = (line: string) => {
      logs += '\n' + line;
      const now = Date.now();
      if (now - lastFlush > 800) { lastFlush = now; persist(); broadcast('pipeline-run-changed', { pipeline, runId }); }
    };
    const handleLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('{')) {
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'result' && typeof evt.result === 'string') finalText = evt.result;
          const formatted = formatStreamEvent(evt);
          if (formatted) append(formatted);
          return;
        } catch { /* fall through: not a complete JSON line */ }
      }
      append(line); // plain text (e.g. "Not logged in") or unparseable line
    };
    const onData = (d: Buffer) => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) handleLine(l);
    };
    p.stdout?.on('data', onData);
    p.stderr?.on('data', onData);

    const deadline = Date.now() + STAGE_TIMEOUT_MS;
    const killTimer = setInterval(() => {
      if (ctrl.cancelled) { try { p.kill('SIGKILL'); } catch { /* ignore */ } }
      else if (Date.now() > deadline) {
        timedOut = true;
        append(`[${ts()}] Stage timed out after ${Math.round(STAGE_TIMEOUT_MS / 60000)}m — terminating Claude.`);
        try { p.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 1000);
    p.on('error', (e) => { logs += `\n[exec error] ${e.message}`; clearInterval(killTimer); resolve(1); });
    p.on('close', (code) => { if (buffer.trim()) handleLine(buffer); clearInterval(killTimer); resolve(code ?? 1); });
  });

  // Stop the browser recorder (SIGINT → ffmpeg flush) and wait for it to
  // finalize the mp4 before we collect artifacts from the same dir.
  if (recorder) {
    try { spawnSync('docker', ['exec', container, 'bash', '-lc', 'pkill -INT -f browser-recorder.mjs']); } catch { /* ignore */ }
    await new Promise<void>((res) => {
      const t = setTimeout(() => res(), 8000);
      recorder!.on('close', () => { clearTimeout(t); res(); });
    });
  }

  if (ctrl.cancelled) return 'cancelled';

  const verdict = parseVerdict(finalText || logs);
  const artifacts = collectArtifacts(pipeline, runId, idx, hostArtifacts);
  const endISO = new Date().toISOString();
  const durationMs = new Date(endISO).getTime() - new Date(startISO).getTime();

  // A stage passes only when Claude exited cleanly AND the criteria verdict
  // isn't an explicit FAIL. Criteria-not-met halts downstream stages.
  let status: 'completed' | 'failed';
  let criteriaMet: boolean;
  let errMsg: string | null = null;
  if (timedOut) {
    status = 'failed';
    criteriaMet = false;
    errMsg = `Stage timed out after ${Math.round(STAGE_TIMEOUT_MS / 60000)}m — Claude did not finish (often blocked waiting on a sidecar endpoint that never became ready).`;
  } else if (exitCode !== 0) {
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
// completed; completing a stage unlocks its successors. Already-completed stages
// (rerun case) count as satisfied. Stages that can never become ready (downstream
// of a failure, or in a cycle) are marked skipped.
async function executeGraph(runId: number, pipeline: string, ctrl: { cancelled: boolean }): Promise<void> {
  const db = getRunsDb();
  const records = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId) as any[];
  const N = records.length;
  if (!N) { finalizeRun(runId, pipeline, 'completed'); return; }

  // Proactively bring up the pipeline's sidecars (rancher takes minutes to boot)
  // so they're ready by the time a stage's skill calls wait-for-sidecars.
  try { startSidecars(pipeline); } catch { /* best effort */ }

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

export function startExecution(runId: number, pipeline: string): void {
  const ctrl = { cancelled: false };
  activeRuns.set(runId, ctrl);
  executeGraph(runId, pipeline, ctrl)
    .catch(err => console.error('run execution error', err))
    .finally(() => activeRuns.delete(runId));
}

export function cancelRun(runId: number, pipeline: string): void {
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

export function cancelActiveRunsForPipeline(pipeline: string): void {
  const db = getRunsDb();
  const active = db.prepare("SELECT id FROM pipeline_runs WHERE pipeline = ? AND status = 'running'").all(pipeline) as { id: number }[];
  for (const r of active) cancelRun(r.id, pipeline);
}
