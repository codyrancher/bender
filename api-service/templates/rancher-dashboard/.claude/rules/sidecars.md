# Sidecars (Rancher, Browser, Figma)

Your project's sidecar containers may not be running yet — the harness can create projects without them to keep batch creation cheap. When you need one (to reproduce an issue, test a fix, drive the browser), start them and wait until they're actually reachable:

```bash
# Idempotent: starts sidecars if needed, then blocks until endpoints answer.
# Without args, waits for both browser (CDP) and rancher.
wait-for-sidecars

# Or wait for just one:
wait-for-sidecars browser
wait-for-sidecars rancher
```

`wait-for-sidecars` is the right tool any time you're about to drive the browser (`browser.mjs` / playwright), hit the Rancher API, or visit `https://localhost:8443`. **Always call it before attempting to capture screenshots or videos** — the browser takes several seconds to boot after the sidecar container starts, and CDP will refuse connections until it's fully up.

Stop sidecars when you're done (main workspace container stays running):

```bash
curl -s -X POST "$HARNESS_API/sidecars/stop/$HARNESS_PROJECT"
```

Under the hood `wait-for-sidecars` calls `POST $HARNESS_API/sidecars/start/$HARNESS_PROJECT` which also runs `on-sidecars-up.sh` (socat forward + Rancher bootstrap — users, cloud creds).
