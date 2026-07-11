const express = require('express');
const cors = require('cors');
const { register, metricsMiddleware } = require('./metrics');
const { requireAuth } = require('./middleware/auth');
const healthRouter = require('./routes/health');
const peopleRouter = require('./routes/people');

function createApp() {
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
  if (process.env.AUTH_ENABLED === 'true') {
    app.use('/api/v1', requireAuth());
  }
  app.use('/api/v1', peopleRouter);

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
      return res.status(401).json({ error: 'invalid or missing token' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
