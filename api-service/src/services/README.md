# services/

Domain logic and stateful subsystems. Services may hold module-level state (a DB
connection, a cache), call `docker`, touch the filesystem, and depend on `config/`
and `utils/` — but they don't know about Express (no `req`/`res`). Route handlers
call into them.

| File | Purpose |
|------|---------|
| `settings.ts` | Read/write the settings file (key overrides + the definitions remote) and env-sourced keys (`envKeys`). |
| `credentials.ts` | Read the GitHub token and build the `-e KEY=value` docker args that forward credentials into pipeline containers. |
| `benderJson.ts` | Read a pipeline instance's `.bender.json` metadata; derive its UID and env args. |
| `definitions.ts` | The git-backed pipeline-definitions repo (each is a `pipeline.yaml` + bundled skills): list/get/write/delete, history/diff, validate, `materializeInto` a workspace, and `createDefinition`/`updateDefinition` orchestration. |
| `migrate.ts` | Idempotent startup migrations — currently converting any legacy `pipeline.md` definitions/instances to `pipeline.yaml`. |
| `skillDefinitions.ts` | The git-backed global skill-definitions repo: list/get/write/delete, history/diff, and `createSkillDefinition`/`updateSkillDefinition` orchestration. |
| `templates.ts` | Pipeline templates: scaffold a workspace, read template metadata/vars/sidecars, Handlebars rendering. |
| `sidecars.ts` | Sidecar container lifecycle (browser/rancher/…): create with the right network/env/volumes, start, stop, remove. |
| `snapshots.ts` | Per-stage workspace snapshots (rsync, hardlink-deduped) so a stage can be re-run from its exact starting state. |
| `initScripts.ts` | Run a project's `init.sh` / `on-sidecars-up.sh` hook scripts inside its container. |
| `runExecutor.ts` | The run-execution engine: owns the runs SQLite DB and the fork/join executor that runs each stage's skill via the Claude CLI, streams logs, reads the success verdict, and collects artifacts. |
| `insights.ts` | The insights SQLite DB + its read/query/delete operations (the DB browser). |
| `cli.ts` | The global Claude CLI terminal: workspace/credential setup, CLAUDE.md + upload file ops, and the persistent tmux+claude PTY websocket (`attachCliServer`). |
| `events.ts` | The websocket event bus — `broadcast(event, data)` pushes live updates (pipeline/run changes) to connected clients; `attachEventsServer` mounts the ws server. |
