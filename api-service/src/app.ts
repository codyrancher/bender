// Express application assembly: middleware + route registration. Kept separate
// from server.ts so the app can be created/tested without binding a port.
import express from 'express';
import cors from 'cors';
import { registerRoutes } from './routes';
import { registerInsightsRoutes } from './routes/insights';
import { registerDefinitionRoutes } from './routes/definitions';
import { registerSkillDefinitionRoutes } from './routes/skill-definitions';
import { registerCliRoutes } from './routes/pty';
import { registerHarnessRoutes } from './routes/harness';
import { errorHandler } from './utils/http';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

registerRoutes(app);
registerInsightsRoutes(app);
registerDefinitionRoutes(app);
registerSkillDefinitionRoutes(app);
registerCliRoutes(app);
registerHarnessRoutes(app);

// Maps thrown HttpErrors → status codes (and anything else → 500). Must be last.
app.use(errorHandler);
