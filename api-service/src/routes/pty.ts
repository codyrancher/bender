import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Express, Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';

const CLI_USER = 'node';
const CLI_UID = 1000;
const CLI_GID = 1000;
const CLI_HOME = '/data/cli/home';
const CLI_WORKSPACE = '/data/cli/workspace';
const TMUX_SESSION = 'bender-global';
const RUNNER = '/usr/local/bin/bender-global-session';

const GLOBAL_CLAUDE_MD = `# Bender — Global CLI

You're the persistent, global Claude session for the Bender. You run inside the \`bender-api\` container, with access to:

## Docker CLI
You can \`docker ps\`, \`docker exec\`, \`docker logs\` to interact with every running project and its sidecars. Project containers are named \`bender-<project>-1\`. Sidecars: \`bender-<project>-<suffix>-1\` (e.g. \`bender-pr-12345-rancher-1\`).

Examples:
\`\`\`bash
docker ps --format '{{.Names}}'                        # list all running containers
docker exec -it bender-pr-12345-1 bash         # shell into a project
docker logs --tail 100 bender-pr-12345-rancher-1
\`\`\`

## Harness HTTP API
Base: \`http://localhost:8080/api\` (also \`$BENDER_API\`). Loopback requests bypass session auth — no token needed. Useful endpoints:
- \`GET /api/pipelines\` — list projects
- \`GET /api/pipelines/:id\` — project details
- \`POST /api/pipelines/:id/start\` / \`/stop\` — lifecycle
- \`GET /api/templates\` — available templates
- \`GET /api/insights/missing-tool\` — missing-tool reports across projects
- \`GET /api/system/stats\` — host resource usage

Example:
\`\`\`bash
curl -s $BENDER_API/projects | jq '.[].name'
\`\`\`

## Your workspace
Cwd: \`${CLI_WORKSPACE}\`. Files here persist across container restarts (backed by \`/data/cli/workspace\` on the host). Your credentials and chat history live in \`${CLI_HOME}\` (likewise persistent).

## Session persistence
You run inside a tmux session named \`${TMUX_SESSION}\`. If the browser disconnects, your session keeps running. On reconnect the terminal reattaches.

---

# Workflows

## Creating a Rancher project from a GitHub issue URL

When the user gives you a \`github.com/rancher/dashboard/issues/<num>\` URL:

1. Fetch the issue title with the GitHub API and pick a concise descriptive slug from it (2–4 kebab-case words).
2. Name the project \`<slug>-issue-<num>\` (e.g. \`chart-buttons-issue-10812\`). This matches existing naming — the harness auto-extracts the issue number and feeds it into the project's CLAUDE.md, and similar existing names in the harness look like \`pod-count-issue-16620\`, \`ns-permission-issue-10094\`.
3. Create the project via the API, **skipping sidecars** (they're expensive and not needed until the user is actively working on it):

\`\`\`bash
# Fetch issue title
TITLE=$(curl -s https://api.github.com/repos/rancher/dashboard/issues/<num> | jq -r .title)
# Derive a slug (ask the user to confirm the slug when it matters)
SLUG="<3-4-kebab-word-slug>"
NAME="\${SLUG}-issue-<num>"

# Create without sidecars
curl -s -X POST \$BENDER_API/projects \\
  -H 'Content-Type: application/json' \\
  -d "{\\"name\\":\\"\$NAME\\",\\"template\\":\\"rancher-dashboard\\",\\"startSidecars\\":false}"
\`\`\`

Always confirm the final name with the user before POSTing. Prime mode is available by including \`prime\` as a name token (e.g. \`chart-buttons-issue-10812-prime\`).

## Auto-fixing the issue after creation

Once the project is created, kick off an unattended claude run inside the project workspace. It follows the project's own CLAUDE.md (\`# Fix Issue\` → \`# Create a commit message\`) and writes everything to \`auto.logs\`.

\`\`\`bash
NAME=<project-name>
CONTAINER=bender-\${NAME}-1

# Launches detached: waits for init.sh to finish, then runs claude -p.
# Streaming of /workspace/auto.logs is handled automatically by the project's
# auto-log-tailer (started by init.sh) — it watches claude's own session
# transcript and writes a human-readable stream to auto.logs regardless of
# how claude is invoked. init.sh writes /workspace/.init-done on success
# and exits non-zero on failure.
docker exec -u 1000:1000 -d "\$CONTAINER" bash -lc '
  for i in \$(seq 1 180); do
    [ -f /workspace/.init-done ] && break
    sleep 5
  done
  if [ ! -f /workspace/.init-done ]; then
    echo "[auto] init never completed — see /workspace/.init.log for details" > /workspace/.auto-run.out
    exit 1
  fi
  cd /workspace/dashboard
  claude --dangerously-skip-permissions \\
         --model claude-opus-4-6 \\
         -p "Follow the Fix Issue section of /workspace/CLAUDE.md. When the fix is complete, stage the changes and follow the Create a commit message section to produce one commit on a new branch." \\
    > /workspace/.auto-run.out 2>&1
'

# Watch progress (auto.logs is on the host at /data/pipelines/<name>/auto.logs)
tail -f /data/pipelines/\$NAME/auto.logs
\`\`\`

Notes:
- The project container doesn't have sidecars running yet; the project-level CLAUDE.md tells the agent how to bring up sidecars via \`$HARNESS_API/sidecars/start/$HARNESS_PROJECT\` if reproducing/testing the issue requires them.
- Tell the user the auto-fix is running in the background and how to watch \`auto.logs\`. Offer to show a live tail when they ask.
- \`auto.logs\` updates **live** as the agent works (human-readable, one line per event). Powered by a per-project background tailer that reads claude's own session transcript at \`/workspace/.claude-local/projects/…/<session>.jsonl\` — so it works whether claude was invoked via \`-p\`, stream-json, or an interactive session. The raw transcript is in the same directory if you need full tool inputs/outputs. \`.auto-run.out\` captures any startup-level errors from the docker-exec wrapper itself.

## Starting sidecars when the user is ready to work

Sidecars (rancher, browser, figma) are started separately so batch project creation stays cheap:

\`\`\`bash
curl -s -X POST \$BENDER_API/sidecars/start/<project>
\`\`\`

This also runs the project's \`on-sidecars-up.sh\` hook (bootstrap Rancher, start socat, etc.). Stop with \`POST /sidecars/stop/<project>\`.

## Finding unclaimed mixin issues

Rancher Dashboard tracks small-scope (mixin) issues with the \`small-scope (mixin)\` label. To list the ones that don't have a project yet in this harness:

\`\`\`bash
# All open mixin issues (paginate if >100)
gh api -X GET 'search/issues' \\
  -f q='repo:rancher/dashboard is:issue is:open label:"small-scope (mixin)"' \\
  -F per_page=100 | jq -r '.items[] | "\\(.number)\\t\\(.title)"' > /tmp/mixins.tsv

# Names of projects already in the harness
curl -s \$BENDER_API/projects | jq -r '.projects[].name' > /tmp/projects.txt

# Mixin issues NOT already covered (by issue number anywhere in a project name)
while IFS=$'\\t' read -r num title; do
  if ! grep -qE "issue-\${num}(\$|[-_])" /tmp/projects.txt; then
    printf '%s\\t%s\\n' "\$num" "\$title"
  fi
done < /tmp/mixins.tsv
\`\`\`

Show the user the filtered list and ask which they'd like to start on. Then use the "Creating a Rancher project" workflow above. Issue URL for reference: <https://github.com/rancher/dashboard/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22small-scope%20(mixin)%22>.
`;

function ensureSetup() {
  fs.mkdirSync(CLI_HOME, { recursive: true });
  fs.mkdirSync(CLI_WORKSPACE, { recursive: true });
  fs.mkdirSync(path.join(CLI_HOME, '.claude'), { recursive: true });

  // Only seed CLAUDE.md on first boot so user edits persist across restarts.
  const mdPath = path.join(CLI_WORKSPACE, 'CLAUDE.md');
  if (!fs.existsSync(mdPath)) {
    fs.writeFileSync(mdPath, GLOBAL_CLAUDE_MD);
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

  // tmux config: mouse wheel scrolls (enters copy-mode when not in a TUI that
  // has mouse reporting enabled), 50k-line scrollback. Matches what the
  // project containers use.
  const tmuxConfPath = path.join(CLI_HOME, '.tmux.conf');
  const tmuxConf = `# Mouse off — xterm.js handles selection and scrollback natively (10k lines).
# Keeping mouse off prevents tmux copy-mode from hijacking drag-select and
# deselecting on mouseup.
set -g mouse off
set -g history-limit 50000
`;
  fs.writeFileSync(tmuxConfPath, tmuxConf);
  try { fs.chownSync(tmuxConfPath, CLI_UID, CLI_GID); } catch { /* ignore */ }

  // Runner script that loops claude so the tmux pane doesn't die if claude exits.
  // Backs off if claude exits too quickly (prevents tight loop on errors).
  const runner = `#!/bin/bash
export HOME=${CLI_HOME}
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
  const uploadsDir = path.join(CLI_WORKSPACE, 'uploads');
  try {
    if (fs.existsSync(uploadsDir)) {
      const maxAge = 24 * 60 * 60 * 1000;
      const now = Date.now();
      for (const file of fs.readdirSync(uploadsDir)) {
        try {
          const stat = fs.statSync(path.join(uploadsDir, file));
          if (now - stat.mtimeMs > maxAge) fs.unlinkSync(path.join(uploadsDir, file));
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function chownRecursive(target: string, uid: number, gid: number) {
  fs.chownSync(target, uid, gid);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) chownRecursive(full, uid, gid);
    else {
      try { fs.chownSync(full, uid, gid); } catch { /* ignore */ }
    }
  }
}

const CLAUDE_MD_PATH = path.join(CLI_WORKSPACE, 'CLAUDE.md');
const UPLOADS_DIR = path.join(CLI_WORKSPACE, 'uploads');
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export function registerCliRoutes(app: Express) {
  app.post('/api/cli/upload', (req: Request, res: Response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_SIZE) {
        res.status(413).json({ error: 'File too large (max 50MB)' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    });
    req.on('end', () => {
      if (res.headersSent) return;
      try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        try { fs.chownSync(UPLOADS_DIR, CLI_UID, CLI_GID); } catch { /* ignore */ }

        const origName = (req.headers['x-filename'] as string) || 'file';
        const ext = path.extname(origName) || '';
        const base = path.basename(origName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${base}-${ts}${ext}`;
        const filePath = path.join(UPLOADS_DIR, filename);

        fs.writeFileSync(filePath, Buffer.concat(chunks));
        try { fs.chownSync(filePath, CLI_UID, CLI_GID); } catch { /* ignore */ }
        res.json({ path: filePath });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  });

  app.get('/api/cli/uploads/:filename', (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(filePath);
  });

  app.get('/api/cli/md', (_req: Request, res: Response) => {
    try {
      const content = fs.existsSync(CLAUDE_MD_PATH)
        ? fs.readFileSync(CLAUDE_MD_PATH, 'utf-8')
        : GLOBAL_CLAUDE_MD;
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/cli/md', (req: Request, res: Response) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (content === null) {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    try {
      fs.mkdirSync(CLI_WORKSPACE, { recursive: true });
      fs.writeFileSync(CLAUDE_MD_PATH, content);
      try { fs.chownSync(CLAUDE_MD_PATH, CLI_UID, CLI_GID); } catch { /* ignore */ }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/cli/md/reset', (_req: Request, res: Response) => {
    try {
      fs.writeFileSync(CLAUDE_MD_PATH, GLOBAL_CLAUDE_MD);
      try { fs.chownSync(CLAUDE_MD_PATH, CLI_UID, CLI_GID); } catch { /* ignore */ }
      res.json({ ok: true, content: GLOBAL_CLAUDE_MD });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}

export function attachCliServer(server: http.Server) {
  ensureSetup();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/cli')) return;

    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    // gosu into the cli user so claude (which refuses root) can run.
    // Using `env -i HOME=... PATH=...` to scrub inherited root env.
    const term = pty.spawn('gosu', [
      CLI_USER,
      'env',
      `HOME=${CLI_HOME}`,
      'PATH=/usr/local/bin:/usr/bin:/bin',
      `BENDER_API=http://localhost:8080/api`,
      'TERM=xterm-256color',
      'tmux', 'new-session', '-A',
      '-s', TMUX_SESSION,
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
