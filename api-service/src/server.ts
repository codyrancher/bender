import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { registerRoutes, initPortForwards } from './routes';
import { registerInsightsRoutes } from './insights';
import { registerDefinitionRoutes } from './definitions';
import { registerSkillDefinitionRoutes } from './skill-definitions';
import { attachCliServer, registerCliRoutes } from './pty';
import { attachEventsServer } from './events';

const PORT = 8080;
const DATA_DIR = '/data';
const PIPELINES_DIR = path.join(DATA_DIR, 'pipelines');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

registerRoutes(app);
registerInsightsRoutes(app);
registerDefinitionRoutes(app);
registerSkillDefinitionRoutes(app);
registerCliRoutes(app);

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
