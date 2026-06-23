// Configuration for the global Claude CLI terminal: paths, the cli user, the
// tmux session, the upload limit, and the default CLAUDE.md seeded into the
// workspace. (Behaviour lives in services/cli.ts.)
import path from 'path';

export const CLI_USER = 'node';
export const CLI_UID = 1000;
export const CLI_GID = 1000;
export const CLI_HOME = '/data/cli/home';
export const CLI_WORKSPACE = '/data/cli/workspace';
export const TMUX_SESSION = 'bender-global';
export const RUNNER = '/usr/local/bin/bender-global-session';

export const CLAUDE_MD_PATH = path.join(CLI_WORKSPACE, 'CLAUDE.md');
export const UPLOADS_DIR = path.join(CLI_WORKSPACE, 'uploads');
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export const GLOBAL_CLAUDE_MD = `# Bender — Global CLI

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

Sidecars (rancher, browser) are started separately so batch project creation stays cheap:

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
