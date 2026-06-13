// HTTP endpoints for the global skill-definitions repo. Thin adapters over
// services/skillDefinitions — parse the request, call the service, shape the
// response; asyncHandler maps thrown HttpErrors to status codes.
import { Express } from 'express';
import { asyncHandler, HttpError } from '../utils/http';
import {
  listSkillDefinitions, getSkillDefinition, deleteSkillDefinition,
  getSkillHistory, getSkillCommitDiff, createSkillDefinition, updateSkillDefinition,
} from '../services/skillDefinitions';

export function registerSkillDefinitionRoutes(app: Express): void {
  app.get('/api/skill-definitions', asyncHandler((_req, res) =>
    res.json({ skills: listSkillDefinitions() })));

  app.get('/api/skill-definitions/:id', asyncHandler((req, res) => {
    const skill = getSkillDefinition(req.params.id);
    if (!skill) throw new HttpError(404, 'Skill not found');
    res.json(skill);
  }));

  app.post('/api/skill-definitions', asyncHandler((req, res) =>
    res.json(createSkillDefinition(req.body))));

  app.put('/api/skill-definitions/:id', asyncHandler((req, res) =>
    res.json(updateSkillDefinition(req.params.id, req.body))));

  app.delete('/api/skill-definitions/:id', asyncHandler((req, res) => {
    deleteSkillDefinition(req.params.id);
    res.json({ status: 'deleted' });
  }));

  app.get('/api/skill-definitions/:id/history', asyncHandler((req, res) =>
    res.json({ commits: getSkillHistory(req.params.id) })));

  app.get('/api/skill-definitions/:id/commit/:sha', asyncHandler((req, res) =>
    res.type('text/plain').send(getSkillCommitDiff(req.params.sha, req.params.id))));
}
