# utils/

Pure, stateless helpers — small functions that take inputs and return values (or
thin wrappers around a system call). No app state; safe to import anywhere.

| File | Purpose |
|------|---------|
| `container.ts` | `docker inspect` wrappers: `getContainerStatus`, `getContainerIp`, `waitForContainerIp`, plus `chownRecursive` for fixing scaffolded-file ownership. |
| `exec.ts` | `execSync(cmd, args)` — a `spawnSync` wrapper returning a normalized `{ status, stdout, stderr }` (used ~45× across handlers). |
| `sse.ts` | `setupSSE(res)` — sets Server-Sent-Events headers and returns a `send(type, message?)` writer. |
| `http.ts` | `HttpError` (throw to return a specific status) + `asyncHandler` (wraps a handler so it needs no try/catch — maps `HttpError`→status, anything else→500). This is what keeps the route files to ~1 line per endpoint. |
| `id.ts` | `hexId(len)` — short random hex id (pipeline UIDs, login session ids). |
| `pipelineFlags.ts` | Parse keyword flags (pr-#, issue-#, prime) out of a pipeline's name. |
| `pipelineParser.ts` | Parse a `pipeline.yaml` into a typed spec (stages + resolved successor graph, args) and validate it (`parsePipelineSpec`, `validatePipeline`, `resolveGraph`, `readPipelineStages`); plus `markdownToYaml` for the one-time legacy migration. |
