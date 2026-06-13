// Entry point: ensure data dirs, attach the websocket servers, and listen.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { app } from './app';
import { DATA_DIR, PIPELINES_DIR } from './config/constants';
import { initPortForwards } from './services/portForward';
import { attachCliServer } from './routes/pty';
import { attachEventsServer } from './services/events';

const PORT = 8080;

// Ensure data directories exist
fs.mkdirSync(PIPELINES_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'credentials'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'config'), { recursive: true });

const server = http.createServer(app);
attachCliServer(server);
attachEventsServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on port ${PORT}`);
  initPortForwards();
});
