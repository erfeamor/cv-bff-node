import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { register, metricsMiddleware } from './metrics';
import { API_BASE_PATH, PUBLIC_ROUTES, requireAuth } from './middleware/auth';
import healthRouter from './routes/health';
import peopleRouter from './routes/people';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(metricsMiddleware);

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim());
  app.use(cors({ origin: allowedOrigins }));

  app.use(healthRouter);

  // JWT validation is opt-in so local dev works without a Cognito user pool;
  // production deployments must set AUTH_ENABLED=true and COGNITO_ISSUER_URI.
  // The guard covers the whole API base path except the contract's public
  // read routes, which serve anonymous traffic from the public sites.
  // `useOriginalUrl` is explicit: the allowlist is written against the full
  // request path, not the path Express leaves after stripping this mount.
  if (process.env.AUTH_ENABLED === 'true') {
    app.use(API_BASE_PATH, requireAuth().unless({ path: PUBLIC_ROUTES, useOriginalUrl: true }));
  }
  app.use(API_BASE_PATH, peopleRouter);

  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.name === 'UnauthorizedError') {
      return res.status(401).json({ error: 'invalid or missing token' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
