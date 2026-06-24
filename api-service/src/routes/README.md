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
| `insights.ts` | Insights DB browser endpoints — thin handlers over `services/insights`. |
| `pty.ts` | The `/api/cli/*` endpoints (uploads, CLAUDE.md) — thin handlers over `services/cli`. (The PTY websocket itself is attached from `server.ts` via `services/cli`.) |
