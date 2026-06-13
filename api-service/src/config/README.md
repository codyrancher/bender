# config/

Static configuration: shared constants with no logic. Imported widely; depends on
nothing else in the app.

| File | Purpose |
|------|---------|
| `constants.ts` | Filesystem paths (`DATA_DIR`, `PIPELINES_DIR`, `SETTINGS_PATH`), container naming (`COMPOSE_PROJECT`, `BENDER_IMAGE`, `NETWORK_NAME`), the Claude credential dir + stage timeout, the env-var ↔ settings-key maps (`ENV_KEY_MAP`, `KEY_DEFAULTS`, `CONTAINER_CRED_ENV`), external-port targets, and the `BROWSER_RECORDER_JS` script injected into pipeline containers. |
