// HTTP endpoints for syncing the shared definitions repo (pipelines + skills)
// with a git remote. Thin adapters over services/definitionsSync.
import { Express } from 'express';
import { asyncHandler } from '../utils/http';
import { syncStatus, setSyncRemote, syncPush, syncPull, syncResolve } from '../services/definitionsSync';

export function registerSyncRoutes(app: Express): void {
  // Current sync state (remote, branch, ahead/behind, conflicts). Fetches on call.
  app.get('/api/definitions/sync/status', asyncHandler((_req, res) =>
    res.json(syncStatus())));

  // Configure (or clear) the remote URL + branch.
  app.put('/api/definitions/sync/remote', asyncHandler((req, res) =>
    res.json(setSyncRemote(req.body?.url ?? '', req.body?.branch ?? ''))));

  app.post('/api/definitions/sync/push', asyncHandler((_req, res) =>
    res.json(syncPush())));

  app.post('/api/definitions/sync/pull', asyncHandler((_req, res) =>
    res.json(syncPull())));

  // Resolve a conflicted pull: strategy = theirs (favor remote) | ours (favor
  // local) | abort.
  app.post('/api/definitions/sync/resolve', asyncHandler((req, res) =>
    res.json(syncResolve(req.body?.strategy))));
}
