const express = require('express');
const { register, metricsMiddleware } = require('./metrics');
const healthRouter = require('./routes/health');
const peopleRouter = require('./routes/people');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(metricsMiddleware);

  app.use(healthRouter);
  app.use('/api/v1', peopleRouter);

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
