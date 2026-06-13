// Shared paths, container naming, and configuration constants for the API.

export const DATA_DIR = '/data';
export const PIPELINES_DIR = '/data/pipelines';
export const SETTINGS_PATH = '/data/config/settings.json';

export const COMPOSE_PROJECT = 'bender';
export const BENDER_IMAGE = 'bender-claude';
export const NETWORK_NAME = 'bender_default';

// Shared, persistent Claude credential dir (the /data/credentials volume mounted
// into every pipeline container as /claude-data). Pointing CLAUDE_CONFIG_DIR here
// means a single sign-in authenticates every pipeline run.
export const CLAUDE_CONFIG_DIR = '/claude-data';

// Hard cap on a single stage's Claude run, so a stage blocked indefinitely
// (e.g. wait-for-sidecars waiting on a sidecar endpoint that never comes up)
// fails with a clear message instead of hanging the whole pipeline forever.
export const STAGE_TIMEOUT_MS = Number(process.env.STAGE_TIMEOUT_MS) || 35 * 60 * 1000;

// Snapshot the workspace at the start of each stage so a stage can be re-run from
// its exact starting state. Disabled with SNAPSHOT_STAGES=0.
export const SNAPSHOT_STAGES = process.env.SNAPSHOT_STAGES !== '0';

// Maps sidecar suffix → the internal port a public forward targets.
export const EXTERNAL_PORT_TARGETS: Record<string, number> = {
  rancher: 443,
};

// Default values for settings keys (used when a key is empty/unset).
export const KEY_DEFAULTS: Record<string, string> = {
  rancherTag: 'head',
};

// Configurable keys are sourced from environment variables (see .env.example)
// rather than a settings UI. Maps the template/settings key id → env var name.
export const ENV_KEY_MAP: Record<string, string> = {
  figmaApiKey: 'FIGMA_API_KEY',
  appcoEmail: 'APPCO_EMAIL',
  appcoToken: 'APPCO_TOKEN',
  rancherTag: 'RANCHER_TAG',
};

// Credentials forwarded into project containers as environment variables. They
// are NEVER written into scaffolded files — tooling inside the container reads
// them straight from the environment.
export const CONTAINER_CRED_ENV = [
  'ANTHROPIC_API_KEY', // authenticates the Claude CLI that executes pipeline stages
  'FIGMA_API_KEY',
  'APPCO_EMAIL',
  'APPCO_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
  'DIGITALOCEAN_ACCESS_TOKEN',
];

// Best-effort browser-session recorder, written into the workspace and run via
// `docker exec` alongside a stage. Connects to the live browser over CDP,
// follows the active tab, and screencasts JPEG frames into an ffmpeg mp4 — so
// the artifact shows exactly how the agent drove the browser. Self-deletes the
// output if nothing was captured.
export const BROWSER_RECORDER_JS = `
const { spawn } = require('child_process');
const fs = require('fs');
const OUT = process.argv[2];
(async () => {
  let chromium;
  try { chromium = require('/workspace/node_modules/playwright-core').chromium; } catch (e) { process.exit(0); }
  let browser;
  try { browser = await chromium.connectOverCDP('http://localhost:9222'); } catch (e) { process.exit(0); }
  const ff = spawn('ffmpeg', ['-y','-f','image2pipe','-use_wallclock_as_timestamps','1','-i','-',
    '-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
    '-pix_fmt','yuv420p','-r','10', OUT], { stdio: ['pipe','ignore','ignore'] });
  ff.on('error', function(){});
  let frames = 0, cur = null;
  async function attach(page) {
    try {
      if (cur && cur.cdp) { try { await cur.cdp.send('Page.stopScreencast'); } catch(e){} try { await cur.cdp.detach(); } catch(e){} }
      const cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', async function(f){
        try { ff.stdin.write(Buffer.from(f.data, 'base64')); frames++; } catch(e){}
        try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch(e){}
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 35, maxWidth: 1280, maxHeight: 720, everyNthFrame: 3 });
      cur = { page: page, cdp: cdp };
    } catch(e){}
  }
  function latest() {
    const ctxs = browser.contexts();
    for (let i = ctxs.length - 1; i >= 0; i--) {
      const ps = ctxs[i].pages();
      for (let j = ps.length - 1; j >= 0; j--) {
        const u = ps[j].url() || '';
        if (u.indexOf('about:blank') !== 0 && u.indexOf('devtools://') !== 0) return ps[j];
      }
    }
    return ctxs[0] ? ctxs[0].pages()[0] : null;
  }
  const init = latest();
  if (init) await attach(init);
  for (const ctx of browser.contexts()) ctx.on('page', function(p){ attach(p); });
  let finishing = false;
  function finish() {
    if (finishing) return; finishing = true;
    try { ff.stdin.end(); } catch(e){}
    const done = function(){ if (frames === 0) { try { fs.unlinkSync(OUT); } catch(e){} } process.exit(0); };
    ff.on('close', done);
    setTimeout(done, 5000);
  }
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
})().catch(function(){ process.exit(0); });
`;
