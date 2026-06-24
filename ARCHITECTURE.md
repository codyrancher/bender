# Architecture

One privileged Docker-in-Docker container does everything. The `bender`
docker-compose service (built from `harness/Dockerfile`, based on `docker:dind`)
runs an inner Docker daemon; `harness/setup.sh` then starts the inner containers:

- **bender-nginx** — reverse proxy. Serves the portal and routes `/api/*` to the
  API and `/c/<pipeline>/*` to each pipeline's code-server / browser.
- **bender-api** — the Express/TypeScript API (built from `api-service/`). The
  control plane behind the portal: it manages pipeline lifecycle and runs the
  stage graph via the Claude CLI, handles definitions/skills (git history + sync),
  sidecars, the global Claude terminal, and live updates over a websocket.
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

## Repository layout

```
bender/
├── harness/              Outer DinD container: boots dockerd + the inner containers
├── api-service/          The bender-api control plane (Express/TypeScript)
├── portal/               The Vue 3 web UI
├── docker-compose.yml    Local dev: the privileged `bender` service
└── entrypoint.sh         User (PUID/PGID) + Claude credential setup for containers
```

**`harness/`** — everything that builds and boots the outer container.
- `Dockerfile` — the DinD image (bakes the portal, copies `api-service/` in).
- `setup.sh` — runs at startup: builds the `bender-api` image, starts nginx + API,
  wires sidecars/devices.
- `start-dockerd.sh`, `init-cgroup.sh`, `supervisord.conf` — bring up the inner
  Docker daemon. `nginx.conf` — the reverse-proxy routing.

**`api-service/`** — the API container.
- `src/routes/` — HTTP/WS endpoint handlers (thin) → `src/services/`.
- `src/services/` — the real logic: pipelines, run engine, definitions, sync,
  sidecars, snapshots, insights, CLI, events.
- `src/utils/` — shared helpers (the `pipeline.yaml` parser, http, exec, …).
- `src/config/` — constants/config. `templates/` — workspace scaffolds (e.g.
  `rancher-dashboard`) copied into each new pipeline. `pipeline-definitions/`,
  `skill-definitions/` — seed definitions/skills bundled into the image.

**`portal/`** — the Vue 3 SPA.
- `src/components/` (+ `primitives/`) — UI; `src/pages/` — routed views;
  `src/router/` — routes. `src/stores/` — Pinia state; `src/services/` — the API
  client; `src/composables/`, `src/utils/`, `src/types/`, `src/assets/`.

## Volumes

Configured on the `bender` service in [docker-compose.yml](docker-compose.yml).
State lives under `~/bender` on the host (override the base dir with the
`BENDER_DIR` env var); the inner containers receive the relevant `/data/*`
subpaths from `setup.sh`.

| Host | Container | Purpose |
|------|-----------|---------|
| `bender-dind` (named volume) | `/var/lib/docker` | The inner Docker daemon's storage (images/layers/containers), persisted across restarts. |
| `${BENDER_DIR:-~/bender}/pipelines` | `/data/pipelines` | Per-pipeline workspaces (each holds `.bender.json`, `pipeline.yaml`, skills). |
| `${BENDER_DIR:-~/bender}/.credentials` | `/data/credentials` | Claude login, persisted across restarts. |
| `${BENDER_DIR:-~/bender}/.config` | `/data/config` | The consolidated **definitions** git repo (`pipelines/<id>/`, `skills/<id>/`). |
| `${BENDER_DIR:-~/bender}/.cli` | `/data/cli` | Global Claude CLI workspace/state. |
| `${BENDER_DIR:-~/bender}/.browser-profile` | `/data/browser-profile` | Persistent browser profile. |
| `~/.gitconfig` (read-only) | `/data/gitconfig` | Commit identity (name/email) for pipelines. |
| `./api-service/templates` | `/data/templates` | Workspace templates — bind-mounted, so edits are live without an image rebuild. |
| `/dev/snd` | `/dev/snd` | Host audio device (also exposed via `devices:`). |

The named `bender-dind` volume is declared in the top-level `volumes:` block;
everything else is a host bind-mount.

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
