# routes/

HTTP (and CLI websocket) endpoints. Each module exports a `registerXRoutes(app)`
that wires its handlers; handlers parse the request, call into `services/`, and
shape the response. Registered from `app.ts`.

> The remaining pipeline/run/auth/settings/etc. handlers still live in the
> top-level `../routes.ts` (`registerRoutes`) pending a per-domain split into this
> directory; the modules below are the ones already extracted.

| File | Purpose |
|------|---------|
| `definitions.ts` | Pipeline-definition endpoints (CRUD + history/diff) — thin handlers over `services/definitions`. |
| `skill-definitions.ts` | Global skill-definition endpoints (CRUD + history/diff) — thin handlers over `services/skillDefinitions`. |
| `insights.ts` | The insights DB browser — list tables, run ad-hoc SQL, delete rows. |
| `pty.ts` | The global Claude CLI terminal: the `/api/cli/*` routes (uploads, CLAUDE.md) and the PTY websocket server. |
| `harness.ts` | Self-hosted dev harness — clone the source and run a dev VS Code + dev API + HMR portal, then promote/abandon. Actions stream SSE logs. |
