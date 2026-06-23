// HTTP endpoints for syncing the shared definitions repo (pipelines + skills)
// with a git remote. Thin adapters over services/definitionsSync.
import { Express } from 'express';
import { asyncHandler } from '../utils/http';
import { syncStatus, setSyncRemote, pushItems, pullItems } from '../services/definitionsSync';

export function registerSyncRoutes(app: Express): void {
  // Current sync state: remote/branch + per-item (pipeline/skill dir) status.
  app.get('/api/definitions/sync/status', asyncHandler((_req, res) =>
    res.json(syncStatus())));

  // Configure (or clear) the remote URL + branch.
  app.put('/api/definitions/sync/remote', asyncHandler((req, res) =>
    res.json(setSyncRemote(req.body?.url ?? '', req.body?.branch ?? ''))));

  // Push selected dirs (local → remote). body: { paths: string[], force?: boolean }.
  app.post('/api/definitions/sync/push', asyncHandler((req, res) =>
    res.json(pushItems(Array.isArray(req.body?.paths) ? req.body.paths : [], !!req.body?.force))));

  // Pull selected dirs (remote → local). body: { paths: string[], force?: boolean }.
  app.post('/api/definitions/sync/pull', asyncHandler((req, res) =>
    res.json(pullItems(Array.isArray(req.body?.paths) ? req.body.paths : [], !!req.body?.force))));
}
