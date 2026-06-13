import { Request, Response, RequestHandler } from 'express';

// Throw from a service/handler to return a specific HTTP status; asyncHandler
// maps it to the response. Anything else becomes a 500.
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

// Wrap an async route handler so it doesn't need its own try/catch: a thrown
// HttpError maps to its status, any other error to a 500. This is what keeps the
// route files to one line per endpoint.
export function asyncHandler(fn: (req: Request, res: Response) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      if (res.headersSent) return next(err);
      if (err instanceof HttpError) res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      else res.status(500).json({ error: String(err) });
    });
  };
}
