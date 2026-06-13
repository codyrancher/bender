import { Response } from 'express';

// Set up a Server-Sent Events stream and return a `send(type, message?)` helper
// that writes one `data: {...}` event per call.
export function setupSSE(res: Response): (type: string, message?: string) => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  return (type: string, message?: string) => {
    const data = message !== undefined ? { type, message } : { type };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}
