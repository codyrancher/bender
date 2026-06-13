// HTTP endpoints for the global pipeline-definitions repo. Thin adapters over
// services/definitions — parse the request, call the service, shape the response;
// asyncHandler maps thrown HttpErrors to status codes.
import { Express } from 'express';
import { asyncHandler, HttpError } from '../utils/http';
import {
  listDefinitions, getDefinition, deleteDefinition, getHistory, getCommitDiff,
  createDefinition, updateDefinition,
} from '../services/definitions';

export function registerDefinitionRoutes(app: Express): void {
  app.get('/api/definitions', asyncHandler((_req, res) =>
    res.json({ definitions: listDefinitions() })));

  app.get('/api/definitions/:id', asyncHandler((req, res) => {
    const def = getDefinition(req.params.id);
    if (!def) throw new HttpError(404, 'Definition not found');
    res.json(def);
  }));

  app.post('/api/definitions', asyncHandler((req, res) =>
    res.json(createDefinition(req.body))));

  app.put('/api/definitions/:id', asyncHandler((req, res) =>
    res.json(updateDefinition(req.params.id, req.body))));

  app.delete('/api/definitions/:id', asyncHandler((req, res) => {
    deleteDefinition(req.params.id);
    res.json({ status: 'deleted' });
  }));

  app.get('/api/definitions/:id/history', asyncHandler((req, res) =>
    res.json({ commits: getHistory(req.params.id) })));

  app.get('/api/definitions/:id/commit/:sha', asyncHandler((req, res) =>
    res.type('text/plain').send(getCommitDiff(req.params.sha, req.params.id))));
}
