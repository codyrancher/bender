import { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';

// Throw from a service/handler to return a specific HTTP status; the error
// middleware below maps it to the response. Anything else becomes a 500.
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

// Wrap an (async or sync) route handler so any thrown/rejected error is funneled
// to Express's error middleware via next() — no per-handler try/catch needed.
// fn is invoked inside the promise chain so synchronous throws are caught too.
export function asyncHandler(fn: (req: Request, res: Response) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve().then(() => fn(req, res)).catch(next);
  };
}

// General error handler (registered last, after all routes). Maps an HttpError to
// its status, anything else to a 500. Mounted via app.use(errorHandler).
export const errorHandler: ErrorRequestHandler = (err, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  else res.status(500).json({ error: String(err) });
};
