// Entry point: ensure data dirs, attach the websocket servers, and listen.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { app } from './app';
import { DATA_DIR, PIPELINES_DIR } from './config/constants';
import { attachCliServer } from './services/cli';
import { attachEventsServer } from './services/events';
import { migratePipelineMdToYaml } from './services/migrate';

const PORT = 8080;

// Ensure data directories exist
fs.mkdirSync(PIPELINES_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'credentials'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'config'), { recursive: true });

// One-time: convert legacy pipeline.md definitions/instances to pipeline.yaml.
migratePipelineMdToYaml();

const server = http.createServer(app);
attachCliServer(server);
attachEventsServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on port ${PORT}`);
});
