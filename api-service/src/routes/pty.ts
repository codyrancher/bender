// HTTP endpoints for the global Claude CLI terminal (uploads + CLAUDE.md). Thin
// adapters over services/cli; the terminal websocket itself is attached in
// server.ts via services/cli's attachCliServer.
import { Express, Request, Response } from 'express';
import { asyncHandler, HttpError } from '../utils/http';
import { MAX_UPLOAD_SIZE } from '../config/cli';
import {
  saveUpload, resolveUploadPath, readClaudeMd, writeClaudeMd, resetClaudeMd,
} from '../services/cli';

export function registerCliRoutes(app: Express): void {
  // Streamed upload — buffer the body (enforcing the size cap) then hand off.
  app.post('/api/cli/upload', (req: Request, res: Response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_SIZE) {
        res.status(413).json({ error: 'File too large (max 50MB)' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    });
    req.on('end', () => {
      if (res.headersSent) return;
      try {
        res.json(saveUpload(Buffer.concat(chunks), (req.headers['x-filename'] as string) || 'file'));
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  });

  app.get('/api/cli/uploads/:filename', asyncHandler((req, res) => {
    const filePath = resolveUploadPath(req.params.filename);
    if (!filePath) throw new HttpError(404, 'Not found');
    res.sendFile(filePath);
  }));

  app.get('/api/cli/md', asyncHandler((_req, res) =>
    res.json({ content: readClaudeMd() })));

  app.put('/api/cli/md', asyncHandler((req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (content === null) throw new HttpError(400, 'content must be a string');
    writeClaudeMd(content);
    res.json({ ok: true });
  }));

  app.post('/api/cli/md/reset', asyncHandler((_req, res) =>
    res.json({ ok: true, content: resetClaudeMd() })));
}
