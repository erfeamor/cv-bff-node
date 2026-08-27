import request from 'supertest';
import { createApp } from '../src/app';

/**
 * The auth matrix for the public edge path (docs/api-contract.md § BFF).
 *
 * Exactly two routes are anonymous even with AUTH_ENABLED=true:
 *   GET /bff/api/v1/people/:id  and  GET /bff/api/v1/people/:id/cv
 * Everything else under /bff/api/v1 stays behind requireAuth().
 *
 * Both directions are asserted on purpose: an anonymous-200 test without the
 * gated-401 test is how a "public read" change silently opens the surface.
 */
describe('auth matrix on /bff/api/v1', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function enableAuth() {
    process.env.AUTH_ENABLED = 'true';
    process.env.COGNITO_ISSUER_URI = 'https://cognito-idp.us-east-1.amazonaws.com/test-pool';
  }

  function mockPersonUpstream() {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1,
        fullName: 'Jane Doe',
        headline: 'Engineer',
        email: 'jane@example.com',
        location: 'Remote',
        summary: 'Bio',
      }),
    }) as unknown as typeof global.fetch;
  }

  /**
   * The aggregate fans out to five upstreams: person, then the four sections.
   * Sections return empty arrays -- this file asserts AUTH, not payload shape,
   * which is test/cv.test.ts's job.
   */
  function mockCvUpstreams() {
    const person = {
      ok: true,
      status: 200,
      json: async () => ({ id: 1, fullName: 'Jane Doe', email: 'jane@example.com' }),
    };
    const emptySection = { ok: true, status: 200, json: async () => [] };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(person)
      .mockResolvedValue(emptySection) as unknown as typeof global.fetch;
  }

  describe('with AUTH_ENABLED=true and no token', () => {
    it('serves GET /bff/api/v1/people/:id anonymously', async () => {
      enableAuth();
      mockPersonUpstream();

      const res = await request(createApp()).get('/bff/api/v1/people/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'Jane Doe',
        headline: 'Engineer',
        location: 'Remote',
        summary: 'Bio',
      });
    });

    // Express auto-generates a HEAD handler for every GET route, so a probe or
    // CDN doing HEAD against a public endpoint must not be gated.
    it('serves HEAD on the public route anonymously', async () => {
      enableAuth();
      mockPersonUpstream();

      const res = await request(createApp()).head('/bff/api/v1/people/1');

      expect(res.status).toBe(200);
    });

    // Express routing is case-insensitive by default, so a mixed-case URL
    // reaches the same public handler; the allowlist must agree or it 401s a
    // route the router already treats as public.
    it('serves a mixed-case public path anonymously', async () => {
      enableAuth();
      mockPersonUpstream();

      const res = await request(createApp()).get('/BFF/API/V1/People/1');

      expect(res.status).toBe(200);
    });

    // The allowlist matches the path, not the raw URL: a query string must not
    // turn a public route back into a 401.
    it('serves the public route anonymously with a query string attached', async () => {
      enableAuth();
      mockPersonUpstream();

      const res = await request(createApp()).get('/bff/api/v1/people/1?utm_source=x');

      expect(res.status).toBe(200);
    });

    // UPDATED BY T-201, which built this route. This test previously asserted
    // 404 with the comment "the /cv route does not exist yet ... 404 proves the
    // request reached the router". That proxy was correct while the route was
    // absent and became wrong the moment it landed -- the endpoint now answers
    // for real, so the assertion is the real one: an anonymous GET reaches the
    // aggregate and returns 200 with AUTH_ENABLED=true.
    it('serves GET /bff/api/v1/people/:id/cv anonymously', async () => {
      enableAuth();
      mockCvUpstreams();

      const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

      expect(res.status).toBe(200);
    });

    it('rejects a non-GET under the public route path with 401', async () => {
      enableAuth();

      const res = await request(createApp()).post('/bff/api/v1/people/1').send({});

      expect(res.status).toBe(401);
    });

    it('rejects an unmapped route under the base path with 401', async () => {
      enableAuth();

      const res = await request(createApp()).get('/bff/api/v1/people/1/skills');

      expect(res.status).toBe(401);
    });

    it('404s the removed /api/v1 path instead of serving or gating it', async () => {
      enableAuth();

      const res = await request(createApp()).get('/api/v1/people/1');

      expect(res.status).toBe(404);
    });

    it('keeps /health open', async () => {
      enableAuth();

      const res = await request(createApp()).get('/health');

      expect(res.status).toBe(200);
    });

    it('keeps /metrics open', async () => {
      enableAuth();

      const res = await request(createApp()).get('/metrics');

      expect(res.status).toBe(200);
    });
  });

  describe('with AUTH_ENABLED=false', () => {
    it('still serves GET /bff/api/v1/people/:id', async () => {
      process.env.AUTH_ENABLED = 'false';
      mockPersonUpstream();

      const res = await request(createApp()).get('/bff/api/v1/people/1');

      expect(res.status).toBe(200);
    });

    it('still 404s the removed /api/v1 path', async () => {
      process.env.AUTH_ENABLED = 'false';

      const res = await request(createApp()).get('/api/v1/people/1');

      expect(res.status).toBe(404);
    });
  });
});
