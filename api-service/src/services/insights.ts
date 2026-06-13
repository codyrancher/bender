// The insights SQLite database (pipelines report findings here, e.g. missing
// tools) and the read/query/delete operations the UI's DB browser exposes.
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants';
import { HttpError } from '../utils/http';

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

// Run a sqlite operation, mapping any sqlite error to a 400 (these are
// user-driven: bad table name, malformed SQL, …).
function asBadRequest<T>(fn: () => T): T {
  try { return fn(); }
  catch (err: any) { throw new HttpError(400, err.message); }
}

export function listTables(): string[] {
  const rows = getDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'insights_%' ORDER BY name"
  ).all() as { name: string }[];
  return rows.map(t => t.name);
}

export function getTableSchema(table: string): unknown {
  const safeName = table.replace(/"/g, '');
  return asBadRequest(() => getDb().prepare(`PRAGMA table_info("${safeName}")`).all());
}

export function getTableRows(table: string, limit: number, offset: number): { rows: unknown[]; total: number } {
  const safeName = table.replace(/"/g, '');
  return asBadRequest(() => {
    const db = getDb();
    const rows = db.prepare(`SELECT rowid as __rowid, * FROM "${safeName}" ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
    const count = db.prepare(`SELECT COUNT(*) as total FROM "${safeName}"`).get() as { total: number };
    return { rows, total: count.total };
  });
}

// Execute arbitrary SQL — returns rows+columns for a reader, else change counts.
export function runQuery(sql: unknown): Record<string, unknown> {
  if (!sql || typeof sql !== 'string') throw new HttpError(400, 'Missing sql parameter');
  return asBadRequest(() => {
    const stmt = getDb().prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(), columns: stmt.columns().map(c => c.name) };
    }
    const result = stmt.run();
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  });
}

export function deleteRows(table: string, rowids: unknown): { deleted: number } {
  if (!Array.isArray(rowids) || !rowids.length) throw new HttpError(400, 'rowids array is required');
  const safeName = table.replace(/"/g, '');
  return asBadRequest(() => {
    const placeholders = rowids.map(() => '?').join(',');
    const result = getDb().prepare(`DELETE FROM "${safeName}" WHERE rowid IN (${placeholders})`).run(...rowids);
    return { deleted: result.changes };
  });
}

export function recordMissingTool(body: any): { id: number | bigint } {
  const { project, tool, command, notes } = body || {};
  if (!project || !tool) throw new HttpError(400, 'project and tool are required');
  const result = getDb()
    .prepare('INSERT INTO missing_tools (project, tool, command, notes) VALUES (?, ?, ?, ?)')
    .run(project, tool, command || null, notes || null);
  return { id: result.lastInsertRowid };
}
