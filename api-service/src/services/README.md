# services/

Domain logic and stateful subsystems. Services may hold module-level state (a DB
connection, a cache), call `docker`, touch the filesystem, and depend on `config/`
and `utils/` — but they don't know about Express (no `req`/`res`). Route handlers
call into them.

| File | Purpose |
|------|---------|
| `settings.ts` | Read/write the settings file (`portRange`, key overrides), env-sourced keys (`envKeys`), and the cached `getExternalIp`. |
| `credentials.ts` | Read the GitHub token and build the `-e KEY=value` docker args that forward credentials into pipeline containers. |
| `benderJson.ts` | Read a pipeline instance's `.bender.json` metadata; derive its UID and env args. |
| `definitions.ts` | The git-backed pipeline-definitions repo: list/get/write/delete, history/diff, validate, `materializeInto` a workspace, and `createDefinition`/`updateDefinition` orchestration. |
| `skillDefinitions.ts` | The git-backed global skill-definitions repo: list/get/write/delete, history/diff, and `createSkillDefinition`/`updateSkillDefinition` orchestration. |
| `templates.ts` | Pipeline templates: scaffold a workspace, read template metadata/vars/sidecars, Handlebars rendering. |
| `sidecars.ts` | Sidecar container lifecycle (browser/rancher/…): create with the right network/env/volumes, start, stop, remove. |
| `portForward.ts` | Public port forwarding — allocate a port from the configured range and run a `socat` container per forward. |
| `snapshots.ts` | Per-stage workspace snapshots (rsync, hardlink-deduped) so a stage can be re-run from its exact starting state. |
| `initScripts.ts` | Run a project's `init.sh` / `on-sidecars-up.sh` hook scripts inside its container. |
| `runExecutor.ts` | The run-execution engine: owns the runs SQLite DB and the fork/join executor that runs each stage's skill via the Claude CLI, streams logs, reads the success verdict, and collects artifacts. |
| `events.ts` | The websocket event bus — `broadcast(event, data)` pushes live updates (pipeline/run changes) to connected clients; `attachEventsServer` mounts the ws server. |
