# Bender

Docker-based pipeline orchestration/visualization platform for running rancher/dashboard issue-fix pipelines.

## Development

### Architecture

One privileged Docker-in-Docker container does everything. The `bender`
docker-compose service (built from `harness/Dockerfile`, based on `docker:dind`)
runs an inner Docker daemon; `harness/setup.sh` then starts the inner
containers:

- **bender-nginx** — reverse proxy. Serves the portal and routes `/api/*` to the
  API and `/c/<pipeline>/*` to each pipeline's code-server/browser.
- **bender-api** — the Express/TypeScript API (built from `api-service/`).
- **bender-<pipeline>-1** — one container per pipeline instance.

`/data` inside the container is bind-mounted from `~/bender` on the host
(override with `BENDER_DIR`): `pipelines/` (per-pipeline workspaces),
`.credentials/` (Claude login, persisted), `.config/` (the definitions git repo),
`.cli/`, `.browser-profile/`.

### Prerequisites

- Docker + Docker Compose (the `bender` service runs privileged / DinD).
- A **GitHub classic PAT** with `public_repo` (git + `gh` inside pipelines —
  clone, push, open/comment on PRs; see `.env.example`).
- Host `~/.gitconfig` with `user.name` / `user.email` — bind-mounted and used as
  the commit identity inside pipelines.

### First-time setup

```bash
cp .env.example .env
# Edit .env:
#   PUID / PGID    -> `id -u` / `id -g`
#   GITHUB_TOKEN   -> your classic PAT (public_repo)
#   (AWS_* / DIGITALOCEAN_* are optional, left commented)

docker compose up -d --build
```

Then open the portal at **https://localhost:4444** (self-signed cert — accept the
warning). Plain HTTP is on **http://localhost:8009**.

The Claude CLI inside pipelines authenticates via **interactive login** on first
use; credentials persist in `~/bender/.credentials`.

### Two images

| File | Purpose |
|------|---------|
| `harness/Dockerfile` | Outer DinD image. Bakes the built portal (`portal/`) into `/app/html` and copies `api-service/` in. |
| `api-service/Dockerfile` | The `bender-api` image — rebuilt inside DinD by `setup.sh` on each start. |

### Making changes

- **Portal or API code** (`portal/`, `api-service/src/`): baked into the image —
  rebuild and restart with `docker compose up -d --build`.
- **Templates** (`api-service/templates/`): bind-mounted — edits are picked up
  when the affected pipeline's sidecars are recreated; no image rebuild needed.
- **Typecheck without a full rebuild:** `cd api-service && npm run build` (tsc)
  and `cd portal && npm run build` (vue-tsc + vite). Both target Node 22.

### Useful commands

```bash
docker logs -f bender-bender-1                          # outer container / setup.sh
docker exec bender-bender-1 docker logs -f bender-api   # API logs
docker exec -it bender-bender-1 sh                      # shell in the outer container
docker exec bender-bender-1 docker restart bender-api   # restart just the API
docker compose down                                     # stop everything
```

## Frontend conventions (portal/)

### Don't inline SVGs

Do **not** write inline `<svg>…</svg>` markup in `.vue` components. Each icon is a
single SVG definition that belongs in `portal/src/assets/icons/<name>.svg` and is
imported as a Vue component via vite-svg-loader:

```ts
import EditIcon from '@/assets/icons/edit.svg?component'
```
```html
<EditIcon width="15" height="15" />   <!-- or size via CSS: .icon-btn svg { width: … } -->
```

- The `.svg` file holds only the drawing: `viewBox` + paths/lines, with
  `stroke="currentColor"` / `fill="currentColor"` so the icon inherits theme color.
- Size at the call site (a `width`/`height` attr, or a parent CSS rule like
  `.bottom-icon-btn svg { width: 16px }`) — keep size out of the `.svg`.
- vite-svg-loader is configured with `svgo: false` in `vite.config.ts` so
  hand-authored icons are preserved verbatim; the `*.svg?component` module is
  declared in `src/vite-env.d.ts`.

The only allowed inline `<svg>` are **non-icon** SVGs with reactive bindings or
component-scoped animation that can't live in a static file (e.g. the
`PipelineGraph` edge canvas, the `running-ring` marquee). Reusable UI lives in
`portal/src/components/primitives/`.
