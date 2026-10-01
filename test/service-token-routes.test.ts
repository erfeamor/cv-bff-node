import request from 'supertest';
import { createApp } from '../src/app';
import { ServiceTokenError } from '../src/service-token';

/**
 * T-211: every upstream call to the domain service carries the BFF's service
 * token when one is configured; a token failure is a 502 with no domain call;
 * an upstream 401/403 (OUR credential failing, not the visitor's) is a 502.
 */

const PERSON = {
  id: 1,
  fullName: 'Jane Doe',
  headline: 'Engineer',
  email: 'jane@example.com',
  location: 'Remote',
  summary: 'Bio',
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Answers the person URL with PERSON and every section URL with []. */
function domainMock() {
  return jest.fn().mockImplementation(async (url: string) => (/\/people\/\d+$/.test(url) ? ok(PERSON) : ok([])));
}

const authHeaderOf = (call: unknown[]) =>
  (call[1] as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;

describe('service token on upstream calls', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('when a token is available', () => {
    const serviceToken = jest.fn(async () => 'svc-token-abc');

    it('sends Authorization: Bearer on the person call', async () => {
      const fetchMock = domainMock();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const res = await request(createApp({ serviceToken })).get('/bff/api/v1/people/1');

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(authHeaderOf(fetchMock.mock.calls[0])).toBe('Bearer svc-token-abc');
    });

    it('sends Authorization: Bearer on all five aggregate calls', async () => {
      const fetchMock = domainMock();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const res = await request(createApp({ serviceToken })).get('/bff/api/v1/people/1/cv');

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      for (const call of fetchMock.mock.calls) {
        expect(authHeaderOf(call)).toBe('Bearer svc-token-abc');
      }
    });

    it.each([401, 403])('maps an upstream %i on the person route to 502', async (status) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status }) as unknown as typeof global.fetch;

      const res = await request(createApp({ serviceToken })).get('/bff/api/v1/people/1');

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: 'upstream error' });
    });

    it.each([401, 403])('maps an upstream %i on the aggregate (person and sections) to 502', async (status) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status }) as unknown as typeof global.fetch;

      const res = await request(createApp({ serviceToken })).get('/bff/api/v1/people/1/cv');

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: 'upstream error' });
    });
  });

  describe('when the token provider rejects', () => {
    const serviceToken = jest.fn(async (): Promise<string | undefined> => {
      throw new ServiceTokenError('service token request failed (status 500)');
    });

    it.each(['/bff/api/v1/people/1', '/bff/api/v1/people/1/cv'])(
      '%s answers 502 and makes NO domain call',
      async (path) => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof global.fetch;

        const res = await request(createApp({ serviceToken })).get(path);

        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error: 'upstream error' });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('when not configured', () => {
    it.each(['/bff/api/v1/people/1', '/bff/api/v1/people/1/cv'])('%s sends no Authorization header', async (path) => {
      const fetchMock = domainMock();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const res = await request(createApp({ serviceToken: async () => undefined })).get(path);

      expect(res.status).toBe(200);
      for (const call of fetchMock.mock.calls) {
        expect(authHeaderOf(call)).toBeUndefined();
      }
    });
  });

  describe('wired from the environment (default provider)', () => {
    const SECRET = 'env-secret-DO-NOT-LEAK-7f3a';
    const TOKEN = 'env-token-DO-NOT-LEAK-9c1b';
    const TOKEN_URL = 'https://cv-test.auth.eu-west-3.amazoncognito.com/oauth2/token';
    const saved = { ...process.env };

    beforeEach(() => {
      process.env.COGNITO_TOKEN_URL = TOKEN_URL;
      process.env.SERVICE_CLIENT_ID = 'env-client-id';
      process.env.SERVICE_CLIENT_SECRET = SECRET;
      process.env.SERVICE_TOKEN_SCOPE = 'cv-api/read';
    });
    afterEach(() => {
      process.env = { ...saved };
    });

    it('fetches the token from the configured endpoint and sends it upstream', async () => {
      const domain = domainMock();
      const fetchMock = jest.fn().mockImplementation(async (url: string, init?: RequestInit) =>
        url === TOKEN_URL ? ok({ access_token: TOKEN, expires_in: 86400 }) : domain(url, init),
      );
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const res = await request(createApp()).get('/bff/api/v1/people/1');

      expect(res.status).toBe(200);
      expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL);
      expect(authHeaderOf(domain.mock.calls[0])).toBe(`Bearer ${TOKEN}`);
    });

    it.each([
      ['token endpoint 500', { ok: false, status: 500, json: async () => ({ error: SECRET }) }],
      ['token endpoint returns a token but the domain 401s', ok({ access_token: TOKEN, expires_in: 86400 })],
    ])('failure path (%s): neither the secret nor the token reaches the body or the logs', async (_label, tokenAnswer) => {
      const logged: string[] = [];
      const capture = (...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(' '));
      };
      for (const level of ['error', 'warn', 'log', 'info', 'debug'] as const) {
        jest.spyOn(console, level).mockImplementation(capture);
      }
      global.fetch = jest.fn().mockImplementation(async (url: string) =>
        url === TOKEN_URL ? tokenAnswer : { ok: false, status: 401, json: async () => ({}) },
      ) as unknown as typeof global.fetch;

      const app = createApp();
      for (const path of ['/bff/api/v1/people/1', '/bff/api/v1/people/1/cv']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(502);
        expect(res.text).not.toContain(SECRET);
        expect(res.text).not.toContain(TOKEN);
        expect(JSON.stringify(res.headers)).not.toContain(SECRET);
        expect(JSON.stringify(res.headers)).not.toContain(TOKEN);
      }
      const metrics = await request(app).get('/metrics');
      expect(metrics.text).not.toContain(SECRET);
      expect(metrics.text).not.toContain(TOKEN);

      const allLogs = logged.join('\n');
      expect(allLogs).not.toContain(SECRET);
      expect(allLogs).not.toContain(TOKEN);
      expect(allLogs).not.toContain(Buffer.from(`env-client-id:${SECRET}`).toString('base64'));
    });
  });
});
