# Bender

Docker-based pipeline orchestration/visualization platform for running
rancher/dashboard issue-fix pipelines.

A pipeline is a graph of stages; each stage runs a skill via the Claude CLI
inside a per-pipeline container, with a browser sidecar and an optional Rancher
sidecar. The Vue 3 portal drives creation, runs, and review.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together.

## Run from the published image

The quickest way to run bender — no clone or build. You need Docker and a GitHub
classic PAT with `public_repo` scope (used by git + `gh` inside pipelines).

The image lives on GHCR (`ghcr.io/codyrancher/bender`). It's private, so
authenticate first (skip this if it's been made public) with a PAT that has
`read:packages`:

```bash
echo "<PAT with read:packages>" | docker login ghcr.io -u <github-user> --password-stdin
```

Then run it — privileged Docker-in-Docker, with all state persisted in `~/bender`:

```bash
docker run -d \
  --name bender \
  --privileged \
  --restart unless-stopped \
  -p 8009:80 -p 4444:443 \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  -e GITHUB_TOKEN='<classic PAT, public_repo>' \
  -e GIT_USER_NAME='Your Name' \
  -e GIT_USER_EMAIL='you@example.com' \
  -v ~/bender:/data \
  -v bender-dind:/var/lib/docker \
  ghcr.io/codyrancher/bender:latest
```

Open the portal at **https://localhost:4444** (accept the self-signed cert; plain
HTTP is on **http://localhost:8009**). First boot takes a minute — it starts an
inner dockerd and builds its API image. The Claude CLI inside pipelines
authenticates via interactive login on first use.

- The templates pipelines use are baked into the image (no `./api-service/templates`
  bind-mount needed; that's a dev-only overlay).
- **Upgrade:** `docker pull ghcr.io/codyrancher/bender:latest`, then
  `docker rm -f bender` and re-run the command above. `~/bender` and the
  `bender-dind` volume keep your pipelines/credentials/state.

## Development setup

To build and run from source (for working on bender itself).

**Prerequisites:**
- **Docker + Docker Compose** — the `bender` service runs privileged
  (Docker-in-Docker).
- A **GitHub classic PAT** with `public_repo` scope. See [.env.example](.env.example).
- **`GIT_USER_NAME` / `GIT_USER_EMAIL`** — the commit identity used inside
  pipelines (the PAT is auth only).

```bash
cp .env.example .env
# Edit .env:
#   PUID / PGID                  -> `id -u` / `id -g`
#   GITHUB_TOKEN                 -> your classic PAT (public_repo)
#   GIT_USER_NAME / _EMAIL       -> commit identity for pipelines
#   (AWS_* / DIGITALOCEAN_* are optional, left commented)

docker compose up -d --build
```

Then open the portal at **https://localhost:4444**.

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
