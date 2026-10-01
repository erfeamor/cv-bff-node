import {
  createServiceTokenProvider,
  serviceTokenConfigFromEnv,
  ServiceTokenConfig,
} from '../src/service-token';

const CONFIG: ServiceTokenConfig = {
  tokenUrl: 'https://cv-test.auth.eu-west-3.amazoncognito.com/oauth2/token',
  clientId: 'client-id-123',
  clientSecret: 'super-secret-value-xyz',
  scope: 'cv-api/read',
};

const tokenResponse = (accessToken: string, expiresIn: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' }),
});

/** A controllable clock, in milliseconds. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('service token provider', () => {
  it('first call POSTs client_credentials with Basic auth, form body and scope', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse('tok-1', 86400));
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock });

    await expect(getToken()).resolves.toBe('tok-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.tokenUrl);
    expect(init.method).toBe('POST');
    const expectedBasic = Buffer.from('client-id-123:super-secret-value-xyz').toString('base64');
    expect(init.headers.Authorization).toBe(`Basic ${expectedBasic}`);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('cv-api/read');
    // The secret travels only in the Basic header, never in the body.
    expect(String(init.body)).not.toContain(CONFIG.clientSecret);
  });

  it('a second call within validity reuses the cache (one fetch total)', async () => {
    const c = clock();
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse('tok-1', 86400));
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock, now: c.now });

    await getToken();
    c.advance(60 * 60 * 1000); // 1 h into a 24 h token
    await expect(getToken()).resolves.toBe('tok-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once expiry minus the safety margin is reached (24 h token, 5 min margin)', async () => {
    const c = clock();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-1', 86400))
      .mockResolvedValueOnce(tokenResponse('tok-2', 86400));
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock, now: c.now });

    await getToken();
    c.advance((86400 - 300) * 1000 - 1); // one ms before the refresh point
    await expect(getToken()).resolves.toBe('tok-1');
    c.advance(1); // at the refresh point
    await expect(getToken()).resolves.toBe('tok-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a 10% margin for short tokens (60 s token refreshes at 54 s)', async () => {
    const c = clock();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-1', 60))
      .mockResolvedValueOnce(tokenResponse('tok-2', 60));
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock, now: c.now });

    await getToken();
    c.advance(53_999);
    await expect(getToken()).resolves.toBe('tok-1');
    c.advance(1);
    await expect(getToken()).resolves.toBe('tok-2');
  });

  it('concurrent first calls share ONE in-flight request', async () => {
    let resolveFetch: (v: unknown) => void = () => undefined;
    const fetchMock = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock });

    const calls = [getToken(), getToken(), getToken()];
    resolveFetch(tokenResponse('tok-1', 86400));

    await expect(Promise.all(calls)).resolves.toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 500 from the token endpoint', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ['a network error', () => Promise.reject(new Error('ECONNREFUSED'))],
    [
      'malformed JSON',
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }),
    ],
    ['a body without access_token', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ expires_in: 3600 }) })],
    [
      'a body without a usable expires_in',
      () => Promise.resolve({ ok: true, status: 200, json: async () => ({ access_token: 'x', expires_in: 'soon' }) }),
    ],
  ])('rejects on %s, does not cache the failure, and the next call retries', async (_label, failure) => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(failure)
      .mockResolvedValueOnce(tokenResponse('tok-after-retry', 86400));
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock });

    await expect(getToken()).rejects.toThrow(/service token request failed/);
    await expect(getToken()).resolves.toBe('tok-after-retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a non-2xx error names the status and never the secret', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const getToken = createServiceTokenProvider(CONFIG, { fetch: fetchMock });

    const err = await getToken().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('service token request failed (status 400)');
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(CONFIG.clientSecret);
  });

  it('partially configured: rejects naming the missing variables, never a value, and makes no fetch', async () => {
    const fetchMock = jest.fn();
    const getToken = createServiceTokenProvider(
      { tokenUrl: CONFIG.tokenUrl, clientId: undefined, clientSecret: CONFIG.clientSecret, scope: undefined },
      { fetch: fetchMock },
    );

    const err = await getToken().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('SERVICE_CLIENT_ID');
    expect(message).toContain('SERVICE_TOKEN_SCOPE');
    expect(message).not.toContain('COGNITO_TOKEN_URL');
    expect(message).not.toContain(CONFIG.clientSecret);
    expect(message).not.toContain(CONFIG.tokenUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('not configured: resolves undefined and makes NO fetch', async () => {
    const fetchMock = jest.fn();
    const getToken = createServiceTokenProvider({}, { fetch: fetchMock });

    await expect(getToken()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the four env variables, treating empty strings as unset', () => {
    expect(
      serviceTokenConfigFromEnv({
        COGNITO_TOKEN_URL: 'u',
        SERVICE_CLIENT_ID: 'i',
        SERVICE_CLIENT_SECRET: 's',
        SERVICE_TOKEN_SCOPE: '',
      }),
    ).toEqual({ tokenUrl: 'u', clientId: 'i', clientSecret: 's', scope: undefined });
  });
});
