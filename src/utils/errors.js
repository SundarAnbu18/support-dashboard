export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const badRequest = (message, details) => new HttpError(400, message, details);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);

// Wraps async route handlers so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, _req, res, _next) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists', details: err.detail });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist', details: err.detail });
  }
  if (err.code === '23514' || err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid value supplied', details: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
