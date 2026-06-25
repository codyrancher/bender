# Bender

Docker-based pipeline orchestration/visualization platform for running
rancher/dashboard issue-fix pipelines.

A pipeline is a graph of stages; each stage runs a skill via the Claude CLI
inside a per-pipeline container, with a browser sidecar and an optional Rancher
sidecar. The Vue 3 portal drives creation, runs, and review.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together.

## Prerequisites

- **Docker + Docker Compose** — the `bender` service runs privileged
  (Docker-in-Docker).
- A **GitHub classic PAT** with `public_repo` scope — used by git + `gh` inside
  pipelines (clone, push, open/comment on PRs). See [.env.example](.env.example).
- **`GIT_USER_NAME` / `GIT_USER_EMAIL`** in `.env` — the commit identity used
  inside pipelines (the PAT is auth only).

## First-time setup

```bash
cp .env.example .env
# Edit .env:
#   PUID / PGID                  -> `id -u` / `id -g`
#   GITHUB_TOKEN                 -> your classic PAT (public_repo)
#   GIT_USER_NAME / _EMAIL       -> commit identity for pipelines
#   (AWS_* / DIGITALOCEAN_* are optional, left commented)

docker compose up -d --build
```

Then open the portal at **https://localhost:4444** (self-signed cert — accept the
warning). Plain HTTP is on **http://localhost:8009**.

The Claude CLI inside pipelines authenticates via **interactive login** on first
use; credentials persist in `~/bender/.credentials`.

## Making changes

- **Portal or API code** (`portal/`, `api-service/src/`): baked into the image —
  rebuild and restart with `docker compose up -d --build`.
- **Templates** (`api-service/templates/`): bind-mounted — edits are picked up
  when the affected pipeline's sidecars are recreated; no image rebuild needed.
- **Typecheck without a full rebuild:** `cd api-service && npm run build` (tsc)
  and `cd portal && npm run build` (vue-tsc + vite). Both target Node 22.

## Useful commands

```bash
docker logs -f bender-bender-1                          # outer container / setup.sh
docker exec bender-bender-1 docker logs -f bender-api   # API logs
docker exec -it bender-bender-1 sh                      # shell in the outer container
docker exec bender-bender-1 docker restart bender-api   # restart just the API
docker compose down                                     # stop everything
```

## Data

Host `~/bender` (override with `BENDER_DIR`) is bind-mounted to `/data`:

- `pipelines/` — per-pipeline workspaces
- `.credentials/` — Claude login (persisted)
- `.config/` — the definitions git repo + config
- `.cli/`, `.browser-profile/`
