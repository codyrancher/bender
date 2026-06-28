// The global Claude CLI terminal: workspace/credential setup, the persistent
// tmux+claude PTY websocket session, and the CLAUDE.md + upload file operations
// its routes expose.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { chownRecursive } from '../utils/container';
import {
  CLI_USER, CLI_UID, CLI_GID, CLI_HOME, CLI_WORKSPACE, TMUX_PREFIX, RUNNER,
  CLI_CLAUDE_CONFIG_DIR, CLAUDE_MD_PATH, UPLOADS_DIR, GLOBAL_CLAUDE_MD,
} from '../config/cli';

// A tmux/claude session id is the suffix of its session name. Restrict it to a
// safe charset so it can't break out of the tmux -s/-t argument.
function safeSessionId(id: string): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : 'main';
}

// Run a command as the cli user with the shared HOME + CLAUDE_CONFIG_DIR.
function asCliUser(cmd: string[]): string[] {
  return ['gosu', CLI_USER, 'env',
    `HOME=${CLI_HOME}`, `CLAUDE_CONFIG_DIR=${CLI_CLAUDE_CONFIG_DIR}`,
    'PATH=/usr/local/bin:/usr/bin:/bin', ...cmd];
}

// The terminal session ids that currently have a live tmux session.
export function listCliSessions(): string[] {
  const [c, ...a] = asCliUser(['tmux', 'list-sessions', '-F', '#{session_name}']);
  const r = spawnSync(c, a, { encoding: 'utf-8' });
  if (r.status !== 0) return [];
  return (r.stdout || '').split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith(`${TMUX_PREFIX}-`))
    .map(s => s.slice(TMUX_PREFIX.length + 1));
}

export function killCliSession(id: string): void {
  const [c, ...a] = asCliUser(['tmux', 'kill-session', '-t', `${TMUX_PREFIX}-${safeSessionId(id)}`]);
  spawnSync(c, a, { stdio: 'ignore' });
}

// ── Global Claude auth (shared with pipelines via CLI_CLAUDE_CONFIG_DIR) ──
export function cliAuthStatus(): { authenticated: boolean; method: string; loggedIn: boolean } {
  const [c, ...a] = asCliUser(['claude', 'auth', 'status']);
  const r = spawnSync(c, a, { encoding: 'utf-8' });
  let loggedIn = false, method = 'none';
  try { const j = JSON.parse((r.stdout || '').trim()); loggedIn = !!j.loggedIn; method = j.authMethod || 'none'; } catch { /* not logged in */ }
  return { authenticated: loggedIn, method, loggedIn };
}

// In-flight `claude auth login` processes for the global CLI, keyed by sid.
const cliLoginSessions = new Map<string, ChildProcess>();

export function startCliLogin(): Promise<{ sessionId: string; url: string }> {
  return new Promise((resolve, reject) => {
    const [c, ...a] = asCliUser(['claude', 'auth', 'login', '--claudeai']);
    const proc = spawn(c, a, { stdio: ['pipe', 'pipe', 'pipe'] });
    const sid = Math.random().toString(36).slice(2, 10);
    let out = '', done = false;
    const timer = setTimeout(() => { if (!done) { done = true; try { proc.kill(); } catch { /* ignore */ } reject(new Error('Timed out waiting for sign-in URL')); } }, 20000);
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = out.match(/https:\/\/\S*oauth\S*/);
      if (m && !done) { done = true; clearTimeout(timer); cliLoginSessions.set(sid, proc); resolve({ sessionId: sid, url: m[0] }); }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    proc.on('close', () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('Sign-in process exited early')); } });
  });
}

export async function submitCliLogin(sid: string, code: string): Promise<{ completed: boolean; authenticated: boolean; method: string; loggedIn: boolean }> {
  const proc = cliLoginSessions.get(sid);
  if (!proc) throw new Error('No active sign-in session');
  try { proc.stdin?.write(code.trim() + '\n'); } catch { /* ignore */ }
  const completed = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 25000);
    proc.on('close', () => { clearTimeout(t); resolve(true); });
  });
  cliLoginSessions.delete(sid);
  return { completed, ...cliAuthStatus() };
}


export function ensureSetup(): void {
  fs.mkdirSync(CLI_HOME, { recursive: true });
  fs.mkdirSync(CLI_WORKSPACE, { recursive: true });
  fs.mkdirSync(path.join(CLI_HOME, '.claude'), { recursive: true });

  // Only seed CLAUDE.md on first boot so user edits persist across restarts.
  if (!fs.existsSync(CLAUDE_MD_PATH)) {
    fs.writeFileSync(CLAUDE_MD_PATH, GLOBAL_CLAUDE_MD);
  }

  // Ensure everything under /data/cli is owned by the cli user so claude
  // (which refuses to run as root) can write credentials, chat history, etc.
  try {
    chownRecursive('/data/cli', CLI_UID, CLI_GID);
  } catch (err) {
    console.error('chown /data/cli failed:', err);
  }

  // Give the cli user access to the docker socket so it can list/exec into
  // projects and sidecars. The api-service container runs as root so we can
  // loosen the socket perms here.
  const dockerSock = '/var/run/docker.sock';
  try {
    if (fs.existsSync(dockerSock)) {
      fs.chmodSync(dockerSock, 0o666);
    }
  } catch (err) {
    console.error('chmod docker.sock failed:', err);
  }

  // tmux config: mouse off (xterm.js handles selection/scrollback), 50k scrollback.
  const tmuxConfPath = path.join(CLI_HOME, '.tmux.conf');
  const tmuxConf = `# Mouse on so the scroll wheel scrolls tmux's 50k-line scrollback (it enters
# copy-mode automatically and exits at the bottom). Hold Shift to drag-select
# with xterm.js instead of tmux.
set -g mouse on
set -g history-limit 50000
`;
  fs.writeFileSync(tmuxConfPath, tmuxConf);
  try { fs.chownSync(tmuxConfPath, CLI_UID, CLI_GID); } catch { /* ignore */ }

  // Runner script that loops claude so the tmux pane doesn't die if claude exits.
  // Backs off if claude exits too quickly (prevents tight loop on errors).
  const runner = `#!/bin/bash
export HOME=${CLI_HOME}
export CLAUDE_CONFIG_DIR=${CLI_CLAUDE_CONFIG_DIR}
export BENDER_API=http://localhost:8080/api
cd ${CLI_WORKSPACE}
while true; do
  start=$(date +%s)
  claude --dangerously-skip-permissions --continue 2>/dev/null || \\
    claude --dangerously-skip-permissions
  end=$(date +%s)
  if [ $((end - start)) -lt 3 ]; then
    echo ""
    echo "[claude exited quickly — likely an error. Sleeping 5s before restart...]"
    sleep 5
  fi
  echo ""
  echo "[claude exited — press Enter to restart, Ctrl-C to quit]"
  read -r || exit 0
done
`;
  fs.writeFileSync(RUNNER, runner, { mode: 0o755 });

  // Clean up uploaded files older than 24h
  try {
    if (fs.existsSync(UPLOADS_DIR)) {
      const maxAge = 24 * 60 * 60 * 1000;
      const now = Date.now();
      for (const file of fs.readdirSync(UPLOADS_DIR)) {
        try {
          const stat = fs.statSync(path.join(UPLOADS_DIR, file));
          if (now - stat.mtimeMs > maxAge) fs.unlinkSync(path.join(UPLOADS_DIR, file));
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// Save an uploaded file (timestamped, sanitized name) into the CLI uploads dir.
export function saveUpload(data: Buffer, origName: string): { path: string } {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  try { fs.chownSync(UPLOADS_DIR, CLI_UID, CLI_GID); } catch { /* ignore */ }
  const ext = path.extname(origName) || '';
  const base = path.basename(origName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(UPLOADS_DIR, `${base}-${ts}${ext}`);
  fs.writeFileSync(filePath, data);
  try { fs.chownSync(filePath, CLI_UID, CLI_GID); } catch { /* ignore */ }
  return { path: filePath };
}

// Resolve an uploads filename to a path, or null if it escapes the dir / is missing.
export function resolveUploadPath(filename: string): string | null {
  const filePath = path.join(UPLOADS_DIR, path.basename(filename));
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) return null;
  return filePath;
}

export function readClaudeMd(): string {
  return fs.existsSync(CLAUDE_MD_PATH) ? fs.readFileSync(CLAUDE_MD_PATH, 'utf-8') : GLOBAL_CLAUDE_MD;
}

export function writeClaudeMd(content: string): void {
  fs.mkdirSync(CLI_WORKSPACE, { recursive: true });
  fs.writeFileSync(CLAUDE_MD_PATH, content);
  try { fs.chownSync(CLAUDE_MD_PATH, CLI_UID, CLI_GID); } catch { /* ignore */ }
}

// Reset CLAUDE.md to the default and return the new content.
export function resetClaudeMd(): string {
  writeClaudeMd(GLOBAL_CLAUDE_MD);
  return GLOBAL_CLAUDE_MD;
}

// Attach the CLI terminal websocket server: each connection gets a tmux+claude
// PTY (run as the cli user). The tmux session persists across disconnects.
export function attachCliServer(server: http.Server): void {
  ensureSetup();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/cli')) return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    // The tab's session id comes from ?session=<id>; each id is its own tmux
    // session (so multiple tabs run independent claude conversations) but they
    // all share the cli user's credentials, so auth is shared.
    const q = new URLSearchParams((req.url || '').split('?')[1] || '');
    const sessionName = `${TMUX_PREFIX}-${safeSessionId(q.get('session') || 'main')}`;
    // gosu into the cli user so claude (which refuses root) can run.
    // Using `env -i HOME=... PATH=...` to scrub inherited root env.
    const term = pty.spawn('gosu', [
      CLI_USER,
      'env',
      `HOME=${CLI_HOME}`,
      `CLAUDE_CONFIG_DIR=${CLI_CLAUDE_CONFIG_DIR}`,
      'PATH=/usr/local/bin:/usr/bin:/bin',
      `BENDER_API=http://localhost:8080/api`,
      'TERM=xterm-256color',
      'tmux', 'new-session', '-A',
      '-s', sessionName,
      '-c', CLI_WORKSPACE,
      RUNNER,
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: CLI_WORKSPACE,
      env: process.env as { [key: string]: string },
    });

    term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    term.onExit(() => {
      try { ws.close(); } catch { /* ignore */ }
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'input' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          try { term.resize(msg.cols, msg.rows); } catch { /* ignore */ }
        }
      } catch {
        term.write(text);
      }
    });

    ws.on('close', () => {
      // Detach only — the tmux session itself keeps running so the next
      // client can reattach to the same claude process.
      try { term.kill(); } catch { /* ignore */ }
    });
  });
}
