// HTTP endpoints for the insights DB browser. Thin adapters over services/insights.
import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import {
  listTables, getTableSchema, getTableRows, runQuery, deleteRows, recordMissingTool,
} from '../services/insights';

export function registerInsightsRoutes(router: Router): void {
  router.get('/api/insights/tables', asyncHandler((_req, res) =>
    res.json({ tables: listTables() })));

  router.get('/api/insights/tables/:table/schema', asyncHandler((req, res) =>
    res.json({ columns: getTableSchema(req.params.table) })));

  router.get('/api/insights/tables/:table/rows', asyncHandler((req, res) =>
    res.json(getTableRows(
      req.params.table,
      parseInt(req.query.limit as string) || 100,
      parseInt(req.query.offset as string) || 0,
    ))));

  router.post('/api/insights/query', asyncHandler((req, res) =>
    res.json(runQuery(req.body.sql))));

  router.post('/api/insights/tables/:table/delete-rows', asyncHandler((req, res) =>
    res.json(deleteRows(req.params.table, req.body.rowids))));

  router.post('/api/insights/missing-tool', asyncHandler((req, res) =>
    res.json(recordMissingTool(req.body))));
}
