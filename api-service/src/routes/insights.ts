import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, 'config', 'insights.db');

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS missing_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        tool TEXT NOT NULL,
        command TEXT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT
      );
    `);
  }
  return db;
}

export function registerInsightsRoutes(router: Router): void {
  // List all tables in the database
  router.get('/api/insights/tables', (_req: Request, res: Response) => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'insights_%' ORDER BY name"
    ).all() as { name: string }[];
    res.json({ tables: tables.map(t => t.name) });
  });

  // Get table schema
  router.get('/api/insights/tables/:table/schema', (req: Request, res: Response) => {
    const db = getDb();
    const { table } = req.params;
    try {
      const columns = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all();
      res.json({ columns });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Query table rows (with optional filters)
  router.get('/api/insights/tables/:table/rows', (req: Request, res: Response) => {
    const db = getDb();
    const { table } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const safeName = table.replace(/"/g, '');
    try {
      const rows = db.prepare(`SELECT rowid as __rowid, * FROM "${safeName}" ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
      const count = db.prepare(`SELECT COUNT(*) as total FROM "${safeName}"`).get() as { total: number };
      res.json({ rows, total: count.total });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Execute arbitrary read-only SQL query
  router.post('/api/insights/query', (req: Request, res: Response) => {
    const db = getDb();
    const { sql } = req.body;
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'Missing sql parameter' });
    }
    try {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all();
        res.json({ rows, columns: stmt.columns().map(c => c.name) });
      } else {
        const result = stmt.run();
        res.json({ changes: result.changes, lastInsertRowid: result.lastInsertRowid });
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete rows by rowid from a table
  router.post('/api/insights/tables/:table/delete-rows', (req: Request, res: Response) => {
    const db = getDb();
    const safeName = req.params.table.replace(/"/g, '');
    const { rowids } = req.body;
    if (!Array.isArray(rowids) || !rowids.length) {
      return res.status(400).json({ error: 'rowids array is required' });
    }
    try {
      const placeholders = rowids.map(() => '?').join(',');
      const stmt = db.prepare(`DELETE FROM "${safeName}" WHERE rowid IN (${placeholders})`);
      const result = stmt.run(...rowids);
      res.json({ deleted: result.changes });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Record a missing tool
  router.post('/api/insights/missing-tool', (req: Request, res: Response) => {
    const db = getDb();
    const { project, tool, command, notes } = req.body;
    if (!project || !tool) {
      return res.status(400).json({ error: 'project and tool are required' });
    }
    const stmt = db.prepare(
      'INSERT INTO missing_tools (project, tool, command, notes) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(project, tool, command || null, notes || null);
    res.json({ id: result.lastInsertRowid });
  });
}
