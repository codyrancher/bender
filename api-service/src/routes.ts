import { Express, Request, Response } from 'express';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getTemplateIds, scaffoldTemplate, getTemplateVars, getTemplateMeta, getBrowserPort, DEFAULT_BROWSER_SIDECAR, DEFAULT_BROWSER_PORT, SidecarDef, TemplateMeta, renderString } from './services/templates';
import { extractPipelineFlags } from './utils/pipelineFlags';
import { broadcast } from './services/events';
import { materializeInto as materializeDefinition, writeDefinition, getDefinition } from './services/definitions';

import {
  PIPELINES_DIR, COMPOSE_PROJECT, CLAUDE_CONFIG_DIR, STAGE_TIMEOUT_MS, BENDER_IMAGE,
  NETWORK_NAME, DATA_DIR, SETTINGS_PATH, EXTERNAL_PORT_TARGETS, KEY_DEFAULTS,
  ENV_KEY_MAP, CONTAINER_CRED_ENV, SNAPSHOT_STAGES, BROWSER_RECORDER_JS,
} from './config/constants';
import { Settings, PortRange, readSettings, writeSettings, getExternalIp, envKeys } from './services/settings';
import { readGithubToken, credentialEnvArgs } from './services/credentials';
import { getContainerStatus, getContainerIp, waitForContainerIp, chownRecursive } from './utils/container';
import { BenderJson, readBenderJson, pipelineUid, pipelineArgEnvArgs } from './services/benderJson';
import { PipelineStage, parsePipelineStages, resolveGraph, readPipelineStages, parsePipelineArgs } from './utils/pipelineParser';
import { snapshotDir, snapshotWorkspace, restoreWorkspace } from './services/snapshots';
import { getSidecarContainerNames, startSidecars, stopSidecars, removeSidecars } from './services/sidecars';
import {
  findNextAvailablePort, stopPortForward, startPortForwardAsync,
  startPortForwardsForProject, stopPortForwardsForProject, initPortForwards,
} from './services/portForward';
import { runInitScript, runSidecarsUpScript } from './services/initScripts';
import { getRunsDb, stageArtifactDir, startExecution, cancelRun, cancelActiveRunsForPipeline } from './services/runExecutor';
import { hexId } from './utils/id';
import { execSync } from './utils/exec';

// Re-exported so server.ts (and others) keep importing it from here.
export { initPortForwards };

export function registerRoutes(app: Express): void {
  // List all projects
  app.get('/api/pipelines', (_req: Request, res: Response) => {
    try {
      const pipelines: Array<{
        name: string;
        container: string;
        status: string;
        template?: string;
        definition?: string;
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
            const status = fs.existsSync(path.join(fullPath, '.deleting')) ? 'deleting' : getContainerStatus(containerName);
            const meta = readBenderJson(name);
            const browserPort = meta?.browserPort ?? (meta?.template ? getBrowserPort(meta.template) : null);

            const stages = readPipelineStages(name);
            pipelines.push({
              name,
              container: containerName,
              status,
              ...(meta?.template && { template: meta.template }),
              ...(meta?.definitionId && { definition: meta.definitionId }),
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
        const mdPath = path.join(projectPath, 'pipeline.yaml');
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

      // A pipeline definition can carry its own CLAUDE.md. When present it is the
      // single source of truth at run time: render it with the same template vars
      // and overwrite the one the template scaffolded, so only the pipeline's
      // CLAUDE.md is in the workspace. Definitions without one keep the template's.
      if (req.body.definitionId) {
        const def = getDefinition(req.body.definitionId);
        if (def?.claudeMd) {
          const claudePath = path.join(projectPath, 'CLAUDE.md');
          fs.writeFileSync(claudePath, renderString(def.claudeMd, vars));
          fs.chownSync(claudePath, 1000, 1000);
        }
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
        ...(req.body.definitionId && { definitionId: String(req.body.definitionId).trim() }),
        uid: `${Date.now().toString(36)}-${hexId(8)}`,
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
  function dockerAsync(args: string[]): Promise<void> {
    return new Promise((resolve) => {
      const p = spawn('docker', args, { stdio: 'ignore' });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }

  // Tear down a pipeline's resources without blocking the event loop: bounded
  // shutdown hook, async `docker rm -f` for the container + sidecars (k3s is
  // slow to stop), async fs removal of the (large) workspace, then purge runs.
  async function cleanupPipelineAsync(project: string, containerName: string): Promise<void> {
    try {
      if (getContainerStatus(containerName) === 'running') {
        const hasShutdown = spawnSync('docker', ['exec', containerName, 'test', '-f', '/workspace/shutdown.sh'], { stdio: 'ignore' }).status === 0;
        if (hasShutdown) {
          await new Promise<void>((resolve) => {
            const p = spawn('docker', ['exec', '-u', '1000:1000', containerName, 'bash', '/workspace/shutdown.sh'], { stdio: 'ignore' });
            const t = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } resolve(); }, 120_000);
            p.on('close', () => { clearTimeout(t); resolve(); });
            p.on('error', () => { clearTimeout(t); resolve(); });
          });
        }
      }

      stopPortForwardsForProject(project);
      await dockerAsync(['rm', '-f', containerName]);
      for (const s of getSidecarContainerNames(project)) await dockerAsync(['rm', '-f', s]);

      await fs.promises.rm(path.join(PIPELINES_DIR, project), { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(path.join(DATA_DIR, 'rancher-data', project), { recursive: true, force: true }).catch(() => {});

      try {
        const rdb = getRunsDb();
        rdb.prepare('DELETE FROM pipeline_stage_records WHERE run_id IN (SELECT id FROM pipeline_runs WHERE pipeline = ?)').run(project);
        rdb.prepare('DELETE FROM pipeline_runs WHERE pipeline = ?').run(project);
      } catch { /* ignore */ }
    } catch (err) {
      console.error('pipeline cleanup failed for', project, err);
    } finally {
      broadcast('pipelines-changed');
    }
  }

  app.delete('/api/pipelines/:pipeline', (req: Request, res: Response) => {
    const project = req.params.pipeline;
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    const projectPath = path.join(PIPELINES_DIR, project);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Mark deleting + respond immediately; the heavy teardown runs detached with
    // async I/O so a delete never blocks the rest of the API.
    try { fs.writeFileSync(path.join(projectPath, '.deleting'), new Date().toISOString()); } catch { /* ignore */ }
    broadcast('pipelines-changed');
    res.json({ status: 'deleting', pipeline: project });

    void cleanupPipelineAsync(project, containerName);
  });

  // --- Pipeline definitions ---

  // --- Pipeline runs: the run-execution engine lives in services/runExecutor.ts ---

  app.get('/api/pipelines/:name/runs', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      // Only this pipeline instance's runs (scoped by UID, NULL-safe for legacy).
      const uid = pipelineUid(req.params.name);
      const runs = db.prepare(
        `SELECT *, (SELECT COUNT(*) FROM pipeline_runs r2 WHERE r2.pipeline = pipeline_runs.pipeline AND r2.pipeline_uid IS pipeline_runs.pipeline_uid AND r2.id <= pipeline_runs.id) AS run_number
         FROM pipeline_runs WHERE pipeline = ? AND pipeline_uid IS ? ORDER BY id DESC LIMIT ? OFFSET ?`
      ).all(req.params.name, uid, limit, offset) as any[];

      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM pipeline_runs WHERE pipeline = ? AND pipeline_uid IS ?'
      ).get(req.params.name, uid) as { total: number };

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
      res.type('text/yaml').send(row.pipeline_md || '');
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
        const mdPath = path.join(pipelineDir, 'pipeline.yaml');
        if (fs.existsSync(mdPath)) pipelineMdSnapshot = fs.readFileSync(mdPath, 'utf-8');
      } catch { /* ignore */ }

      const now = new Date().toISOString();
      const runResult = db.prepare(
        'INSERT INTO pipeline_runs (pipeline, status, started_at, pipeline_md, pipeline_uid) VALUES (?, ?, ?, ?, ?)'
      ).run(pipeline, 'running', now, pipelineMdSnapshot, pipelineUid(pipeline));

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

      const run = db.prepare('SELECT *, (SELECT COUNT(*) FROM pipeline_runs r2 WHERE r2.pipeline = pipeline_runs.pipeline AND r2.pipeline_uid IS pipeline_runs.pipeline_uid AND r2.id <= pipeline_runs.id) AS run_number FROM pipeline_runs WHERE id = ?').get(runId);
      const stageRecords = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(runId);

      broadcast('pipeline-run-changed', { pipeline, runId });
      startExecution(runId, pipeline);
      res.json({ run: { ...run as any, stages: stageRecords } });
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
      const run = db.prepare('SELECT *, (SELECT COUNT(*) FROM pipeline_runs r2 WHERE r2.pipeline = pipeline_runs.pipeline AND r2.pipeline_uid IS pipeline_runs.pipeline_uid AND r2.id <= pipeline_runs.id) AS run_number FROM pipeline_runs WHERE id = ?').get(runId);
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

  // Rerun the pipeline starting at a particular stage as a brand-new run. The
  // preceding stages are copied verbatim from the source run (their status,
  // logs, artifacts, timing) so they read as already-done, and execution begins
  // at the chosen stage. The workspace is restored to that stage's start-of-run
  // snapshot from the source run, while stage definitions for the remaining
  // stages are re-synced from the CURRENT pipeline.md / skills (so edits take
  // effect). The source run is left untouched as history.
  app.post('/api/pipelines/:name/runs/:runId/stages/:stageIndex/rerun-new', (req: Request, res: Response) => {
    try {
      const db = getRunsDb();
      const pipeline = req.params.name;
      const srcRunId = Number(req.params.runId);
      const idx = parseInt(req.params.stageIndex);

      const pipelineDir = path.join(PIPELINES_DIR, pipeline);
      if (!fs.existsSync(pipelineDir)) return res.status(404).json({ error: 'Pipeline not found' });

      const srcRecords = db.prepare(
        'SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index'
      ).all(srcRunId) as any[];
      if (!srcRecords.length) return res.status(404).json({ error: 'Source run not found' });

      const stages = readPipelineStages(pipeline);
      if (!stages.length) return res.status(400).json({ error: 'Pipeline has no stages defined' });
      if (idx < 0 || idx >= stages.length) return res.status(400).json({ error: 'Stage index out of range' });

      // A new run supersedes any run still in flight for this pipeline.
      cancelActiveRunsForPipeline(pipeline);

      // Restore the workspace to the chosen stage's start-of-run snapshot from
      // the source run (keeps the current/edited pipeline.md + skills).
      const restored = restoreWorkspace(pipeline, srcRunId, idx);

      const srcByIndex = new Map<number, any>(srcRecords.map(r => [r.stage_index, r]));

      let pipelineMdSnapshot = '';
      try {
        const mdPath = path.join(pipelineDir, 'pipeline.yaml');
        if (fs.existsSync(mdPath)) pipelineMdSnapshot = fs.readFileSync(mdPath, 'utf-8');
      } catch { /* ignore */ }

      const now = new Date().toISOString();
      const runResult = db.prepare(
        'INSERT INTO pipeline_runs (pipeline, status, started_at, pipeline_md, pipeline_uid) VALUES (?, ?, ?, ?, ?)'
      ).run(pipeline, 'running', now, pipelineMdSnapshot, pipelineUid(pipeline));
      const newRunId = Number(runResult.lastInsertRowid);

      const insertStage = db.prepare(
        `INSERT INTO pipeline_stage_records
           (run_id, stage_index, stage_name, skill, status, started_at, completed_at, duration_ms,
            error, success_criteria, success_criteria_met, logs, artifacts, skill_md, next_indices)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertMany = db.transaction(() => {
        stages.forEach((stage, i) => {
          // next_indices always come from the CURRENT definition so the graph
          // (predecessors/successors) stays internally consistent.
          const nextIndices = JSON.stringify(stage.next);
          const src = srcByIndex.get(i);
          if (i < idx && src) {
            // Preceding stage: replay its prior execution verbatim.
            insertStage.run(
              newRunId, i, src.stage_name, src.skill, src.status,
              src.started_at, src.completed_at, src.duration_ms, src.error,
              src.success_criteria, src.success_criteria_met, src.logs, src.artifacts,
              src.skill_md, nextIndices,
            );
          } else {
            // Chosen stage and everything after: fresh, synced from current defs.
            let skillMd = '';
            try {
              const sp = resolveSkillPath(pipeline, stage.skill);
              if (sp && fs.existsSync(sp)) skillMd = fs.readFileSync(sp, 'utf-8');
            } catch { /* ignore */ }
            insertStage.run(
              newRunId, i, stage.name, stage.skill, 'pending',
              null, null, null, null,
              stage.successCriteria || null, 0, null, null,
              skillMd, nextIndices,
            );
          }
        });
      });
      insertMany();

      if (!restored) {
        // No snapshot for this stage (older run) — note it; the stage still runs,
        // just against the current workspace rather than the captured state.
        try {
          const cur = db.prepare('SELECT logs FROM pipeline_stage_records WHERE run_id = ? AND stage_index = ?').get(newRunId, idx) as any;
          db.prepare('UPDATE pipeline_stage_records SET logs = ? WHERE run_id = ? AND stage_index = ?')
            .run(`[note] No saved snapshot for this stage in the source run — running against the current workspace.\n${cur?.logs || ''}`, newRunId, idx);
        } catch { /* ignore */ }
      }

      broadcast('pipeline-run-changed', { pipeline, runId: newRunId });
      startExecution(newRunId, pipeline);

      const run = db.prepare('SELECT *, (SELECT COUNT(*) FROM pipeline_runs r2 WHERE r2.pipeline = pipeline_runs.pipeline AND r2.pipeline_uid IS pipeline_runs.pipeline_uid AND r2.id <= pipeline_runs.id) AS run_number FROM pipeline_runs WHERE id = ?').get(newRunId);
      const stageRecords = db.prepare('SELECT * FROM pipeline_stage_records WHERE run_id = ? ORDER BY stage_index').all(newRunId);
      res.json({ run: { ...run as any, stages: stageRecords } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Pipeline.md & skill editing ---



  // Live CLAUDE.md for a pipeline workspace — the agent's run-time instructions.


  // Declared pipeline args (from the workspace pipeline.md "## Args" section) with
  // their current values (from .bender.json). Values feed future runs as env vars.
  app.get('/api/pipelines/:name/args', (req: Request, res: Response) => {
    try {
      const dir = path.join(PIPELINES_DIR, req.params.name);
      if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Pipeline not found' });
      const mdPath = path.join(dir, 'pipeline.yaml');
      const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
      const declared = parsePipelineArgs(md);
      const current = readBenderJson(req.params.name)?.args || {};
      const args = declared.map(a => ({
        name: a.name,
        description: a.description,
        required: a.required,
        default: a.default,
        value: current[a.name] ?? '',
      }));
      // Surface any stored args not (or no longer) declared so they aren't hidden.
      for (const [k, v] of Object.entries(current)) {
        if (!declared.some(a => a.name === k)) args.push({ name: k, description: '', required: false, default: '', value: v });
      }
      res.json({ args });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/pipelines/:name/args', (req: Request, res: Response) => {
    try {
      const dir = path.join(PIPELINES_DIR, req.params.name);
      if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Pipeline not found' });
      const meta = readBenderJson(req.params.name) || { sidecars: [] } as BenderJson;
      const values = (req.body.values && typeof req.body.values === 'object') ? req.body.values : {};
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
        // Valid env-var name + non-empty string value; empty drops the arg.
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v) next[k] = v;
      }
      meta.args = next;
      const filePath = path.join(dir, '.bender.json');
      fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
      try { fs.chownSync(filePath, 1000, 1000); } catch { /* best effort */ }
      res.json({ status: 'saved', args: next });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Resolve a skill's SKILL.md path within a pipeline workspace, guarding against traversal
  function resolveSkillPath(project: string, skill: string): string | null {
    if (!/^[a-zA-Z0-9._-]+$/.test(skill)) return null;
    return path.join(PIPELINES_DIR, project, '.claude', 'skills', skill, 'SKILL.md');
  }



  // Push a pipeline's pipeline.md + its referenced skills to the global definitions repo
  app.post('/api/pipelines/:name/push-definition', (req: Request, res: Response) => {
    try {
      const pipeline = req.params.name;
      const pipelineDir = path.join(PIPELINES_DIR, pipeline);
      const mdPath = path.join(pipelineDir, 'pipeline.yaml');
      if (!fs.existsSync(mdPath)) {
        return res.status(404).json({ error: 'Pipeline has no pipeline.yaml' });
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

  // ── GitHub session gate ─────────────────────────────────────────────────────
  // Uploading screenshots/videos to a PR/issue (user-attachments) happens through
  // a logged-in GitHub *browser session*, not a token — GitHub has no PAT/API path
  // for user-attachments. The session is the cookie snapshot that gets injected
  // into the sidecar browser on start. This gate lets the UI verify a usable
  // session exists before a run (mirroring the Claude-auth gate) and capture one
  // straight from the running sidecar browser after a manual sign-in.

  // Does the stored snapshot contain an active GitHub login?
  function checkGithubAuth(): { authenticated: boolean; login?: string; updatedAt?: number; count?: number; reason?: string } {
    let snap: any;
    try { snap = JSON.parse(fs.readFileSync(COOKIE_SNAPSHOT_PATH, 'utf-8')); }
    catch { return { authenticated: false, reason: 'No GitHub session has been synced yet.' }; }
    const cookies: any[] = Array.isArray(snap.cookies) ? snap.cookies : [];
    const isGh = (c: any) => String(c.domain || '').replace(/^\./, '').endsWith('github.com');
    const now = Date.now() / 1000;
    const live = (c: any) => !c.expirationDate || c.expirationDate > now;
    const gh = cookies.filter(isGh);
    const session = gh.find(c => c.name === 'user_session' && live(c));
    const loggedIn = gh.find(c => c.name === 'logged_in' && String(c.value).toLowerCase() === 'yes' && live(c));
    const user = gh.find(c => c.name === 'dotcom_user');
    const authenticated = !!(session || loggedIn);
    return {
      authenticated,
      login: user?.value,
      updatedAt: snap.updatedAt,
      count: snap.count ?? cookies.length,
      reason: authenticated ? undefined : 'No active GitHub login found in the synced session — sign in to github.com (with the bender browser extension) or sign in via the sidecar browser and capture it.',
    };
  }

  // Read all cookies out of the running sidecar browser via CDP
  // (Network.getAllCookies), using the same raw-WS bridge as the inject path.
  function readCookiesFromSidecar(project: string): { ok: boolean; cookies?: any[]; error?: string } {
    const containerName = `${COMPOSE_PROJECT}-${project}-1`;
    if (getContainerStatus(containerName) !== 'running') {
      return { ok: false, error: 'Project container is not running' };
    }
    const script = `
      const http = require('http');
      const crypto = require('crypto');
      function get(url) {
        return new Promise((resolve, reject) => {
          http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
        });
      }
      function rawWsSend(wsUrl, message) {
        return new Promise((resolve, reject) => {
          const u = new URL(wsUrl);
          const key = crypto.randomBytes(16).toString('base64');
          const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET',
            headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
          req.on('upgrade', (res, socket) => {
            const payload = Buffer.from(message);
            const mask = crypto.randomBytes(4);
            let header;
            if (payload.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2); }
            else if (payload.length < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); mask.copy(header, 4); }
            else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); mask.copy(header, 10); }
            const masked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
            socket.write(Buffer.concat([header, masked]));
            let buf = Buffer.alloc(0);
            socket.on('data', chunk => {
              buf = Buffer.concat([buf, chunk]);
              if (buf.length < 2) return;
              let offset = 2; let len = buf[1] & 0x7f;
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
      (async () => {
        const targets = await get('http://localhost:9222/json');
        const page = targets.find(t => t.type === 'page');
        if (!page || !page.webSocketDebuggerUrl) throw new Error('No page target in CDP');
        const result = await rawWsSend(page.webSocketDebuggerUrl, JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
        const cookies = (result && result.result && result.result.cookies) || [];
        console.log(JSON.stringify({ cookies }));
      })().catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
    `.trim();

    const result = spawnSync('docker', ['exec', containerName, 'node', '-e', script], { encoding: 'utf-8', timeout: 30_000 });
    if (result.status !== 0) {
      return { ok: false, error: (result.stderr || result.stdout || '').trim() || 'CDP read failed' };
    }
    try {
      const parsed = JSON.parse(result.stdout.trim());
      if (parsed.error) return { ok: false, error: parsed.error };
      return { ok: true, cookies: parsed.cookies || [] };
    } catch {
      return { ok: false, error: 'Could not parse cookies from CDP' };
    }
  }

  // Convert CDP cookies (Network.getAllCookies) into the snapshot/CookieParam
  // shape readCookieSnapshot/toCdpCookies expect, so they round-trip on re-inject.
  function cdpToSnapshotCookies(cdp: any[]): CookieParam[] {
    const sameSiteRev: Record<string, string> = { None: 'no_restriction', Lax: 'lax', Strict: 'strict' };
    return cdp.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: sameSiteRev[c.sameSite] || 'lax',
      ...(typeof c.expires === 'number' && c.expires > 0 ? { expirationDate: c.expires } : {}),
    })) as CookieParam[];
  }

  app.get('/api/pipelines/:name/github-auth', (_req: Request, res: Response) => {
    try { res.json(checkGithubAuth()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // Capture the GitHub session straight from the project's running sidecar
  // browser (after the user signs in there) and persist it as the snapshot, so
  // it survives sidecar restarts and is what future runs inject.
  app.post('/api/pipelines/:name/github-auth/capture', (req: Request, res: Response) => {
    try {
      const project = req.params.name;
      const read = readCookiesFromSidecar(project);
      if (!read.ok) {
        return res.status(502).json({ error: read.error || 'Could not read cookies from the sidecar browser', ...checkGithubAuth() });
      }
      const ghCdp = (read.cookies || []).filter(c => String(c.domain || '').replace(/^\./, '').endsWith('github.com'));
      if (!ghCdp.length) {
        return res.status(200).json({ authenticated: false, reason: 'The sidecar browser has no github.com cookies yet — sign in to github.com there first, then capture.' });
      }
      const cookies = cdpToSnapshotCookies(ghCdp);
      try {
        fs.mkdirSync(path.dirname(COOKIE_SNAPSHOT_PATH), { recursive: true });
        fs.writeFileSync(COOKIE_SNAPSHOT_PATH, JSON.stringify({ updatedAt: Date.now(), count: cookies.length, cookies }));
      } catch { /* persistence failure is non-fatal */ }
      res.json(checkGithubAuth());
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

  // Delete a single key

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

}

