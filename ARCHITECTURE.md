# Architecture

One privileged Docker-in-Docker container does everything. The `bender`
docker-compose service (built from `harness/Dockerfile`, based on `docker:dind`)
runs an inner Docker daemon; `harness/setup.sh` then starts the inner containers:

- **bender-nginx** — reverse proxy. Serves the portal and routes `/api/*` to the
  API and `/c/<pipeline>/*` to each pipeline's code-server / browser.
- **bender-api** — the Express/TypeScript API (built from `api-service/`). It is
  the control plane for everything the portal does:
  - **Pipeline lifecycle** — create instances (scaffold a template + materialize
    a definition into `pipelines/<slug>/`), start/stop/restart/reprovision their
    containers, and delete them.
  - **Run engine** (`services/runExecutor`) — executes a definition's stage graph
    (fork/join on the `next` edges), runs each stage's skill via the Claude CLI,
    streams logs, records the success verdict, and collects artifacts in a SQLite
    runs DB.
  - **Definitions & skills** — CRUD + git history/diff over the consolidated
    definitions repo, and per-item push/pull **sync** with a remote.
  - **Sidecars & snapshots** — start/stop browser/Rancher sidecars; take per-stage
    workspace snapshots so a stage can be re-run from its exact starting state.
  - **Global Claude CLI** — a persistent tmux + Claude PTY exposed over a
    websocket (the portal's terminal), plus workspace/upload/CLAUDE.md file ops.
  - **Insights** — a SQLite DB (e.g. missing-tool reports) with a read/query
    browser.
  - **Events** — a websocket bus that pushes live pipeline/run updates to the
    portal.
- **bender-&lt;pipeline&gt;-1** — one container per pipeline instance, with
  code-server, a browser sidecar, and an optional Rancher sidecar.

```
host
└── bender (docker-compose service, privileged DinD)   ← harness/Dockerfile
    ├── dockerd (inner)
    ├── bender-nginx        reverse proxy (portal + /api + /c/<pipeline>)
    ├── bender-api          Express/TS API                 ← api-service/Dockerfile
    └── bender-<pipeline>-1 per-pipeline workspace + sidecars
```

## Data

`/data` inside the container is bind-mounted from `~/bender` on the host
(override with `BENDER_DIR`):

- `pipelines/` — per-pipeline workspaces (each holds `.bender.json`, `pipeline.yaml`, skills)
- `.credentials/` — Claude login, persisted across restarts
- `.config/` — the consolidated **definitions** git repo (`pipelines/<id>/`, `skills/<id>/`)
- `.cli/`, `.browser-profile/`

## Images

| File | Purpose |
|------|---------|
| `harness/Dockerfile` | The outer DinD image. A build stage compiles the portal (`portal/`) and bakes it into `/app/html`; `api-service/` is copied in for the inner build. |
| `api-service/Dockerfile` | The `bender-api` image — rebuilt **inside** DinD by `harness/setup.sh` on each container start. |

This is why portal/API code changes need a rebuild (`docker compose up -d --build`)
while `api-service/templates/` is bind-mounted and live — see
[README.md](README.md#making-changes).

## Key concepts

- **Pipeline definition** — a reusable spec (`pipeline.yaml`: name, args, stages
  graph) plus its skills, versioned in the definitions repo. Args support
  `default` values and `options` (a taggable dropdown in the New Pipeline dialog).
- **Pipeline instance** — a definition materialized into `pipelines/<slug>/` and
  run in its own container. `.bender.json` records the template, definition id,
  display `label`, args, sidecars, and a `uid` that scopes its runs.
- **Run** — one execution of the stage graph; stages fork/join per the `next`
  edges, each running its skill via the Claude CLI with success criteria.
- **Sidecars** — extra containers (browser, Rancher) started alongside a
  pipeline. Image tags interpolate `{{args.NAME}}` / `{{settings.NAME}}` from the
  instance's `.bender.json`.

For the `pipeline.yaml` schema, the portal serves a reference at
`/pipeline-schema` (source: `portal/src/pages/PipelineSchemaDoc.vue`).
