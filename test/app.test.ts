import request from 'supertest';
import { createApp } from '../src/app';

describe('CORS', () => {
  it('allows the configured origin', async () => {
    const res = await request(createApp())
      .get('/health')
      .set('Origin', 'http://localhost:4173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4173');
  });
});

describe('auth toggle', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // The old `/api/v1` base is gone (it 404s now, see test/auth-matrix.test.ts),
  // so the toggle is asserted on a non-public route under the new base path.
  // The full public/gated matrix lives in test/auth-matrix.test.ts.
  it('rejects unauthenticated non-public API requests when AUTH_ENABLED=true', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.COGNITO_ISSUER_URI = 'https://cognito-idp.us-east-1.amazonaws.com/test-pool';

    const res = await request(createApp()).post('/bff/api/v1/people/1').send({});

    expect(res.status).toBe(401);
  });

  it('keeps /health open when AUTH_ENABLED=true', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.COGNITO_ISSUER_URI = 'https://cognito-idp.us-east-1.amazonaws.com/test-pool';

    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(200);
  });
});
