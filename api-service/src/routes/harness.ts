// HTTP endpoints for the self-hosted dev harness. Thin adapters over
// services/harness: status is plain JSON; start/rebuild/promote/abandon stream
// the service's progress as SSE, ending with a `done` (or `error`) event.
import { Express, Response } from 'express';
import { asyncHandler } from '../utils/http';
import { setupSSE } from '../utils/sse';
import {
  getHarnessStatus, startHarness, rebuildHarness, promoteHarness, abandonHarness,
} from '../services/harness';

type Send = (type: string, message?: string) => void;

// Run an SSE-streamed harness operation: stream its log events, then end with
// `done` on success or `error` on failure.
function stream(res: Response, op: (send: Send) => Promise<void>): void {
  const send = setupSSE(res);
  op(send)
    .then(() => send('done'))
    .catch((err) => send('error', String(err)))
    .finally(() => res.end());
}

export function registerHarnessRoutes(app: Express): void {
  app.get('/api/harness/status', asyncHandler((_req, res) => res.json(getHarnessStatus())));
  app.post('/api/harness/start', (_req, res) => stream(res, startHarness));
  app.post('/api/harness/rebuild', (_req, res) => stream(res, rebuildHarness));
  app.post('/api/harness/promote', (_req, res) => stream(res, promoteHarness));
  app.post('/api/harness/abandon', (_req, res) => stream(res, abandonHarness));
}
