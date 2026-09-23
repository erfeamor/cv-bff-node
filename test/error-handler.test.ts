import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app';

// The terminal error handler lives inside createApp(), so to drive it with
// arbitrary error objects (1e) we replace the first router createApp() mounts
// with one that also carries error-injection routes. Everything else in the app
// -- middleware order, API routers, the handler under test -- is the real thing.
jest.mock('../src/routes/health', () => {
  const { Router } = jest.requireActual<typeof express>('express');
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/test-error/status/:code', (req, _res, next) => {
    next(Object.assign(new Error('secret detail'), { status: Number(req.params.code) }));
  });
  router.get('/test-error/statusCode/:code', (req, _res, next) => {
    next(Object.assign(new Error('secret detail'), { statusCode: Number(req.params.code) }));
  });
  return { __esModule: true, default: router };
});

const INTERNAL = { error: 'internal server error' };
const BAD_REQUEST = { error: 'bad request' };

describe('terminal error handler (T-208)', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let consoleError: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    consoleError.mockRestore();
  });

  // 1a + 1d: Express throws a URIError with status 400 while decoding params,
  // before any handler runs.
  it('1a: answers a malformed percent-encoding with 400, no upstream call, no error log', async () => {
    const res = await request(createApp()).get('/bff/api/v1/people/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(res.body).toEqual(BAD_REQUEST);
    expect(res.text).not.toMatch(/URIError|Failed to decode|stack/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('1b: keeps UnauthorizedError -> 401 with its constant body', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.COGNITO_ISSUER_URI = 'https://cognito-idp.us-east-1.amazonaws.com/test-pool';

    const res = await request(createApp()).get('/bff/api/v1/not-public');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid or missing token' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  // 1c + 1d
  it('1c: maps a genuine unexpected error to 500 with the constant body, and logs it once', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED secret-host:8080'));

    const res = await request(createApp()).get('/bff/api/v1/people/1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL);
    expect(res.text).not.toMatch(/ECONNREFUSED|secret-host|stack/);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  // 1d: a 4xx carried by a middleware error never leaks its message either.
  it('1d: honours a middleware 4xx without echoing the error message', async () => {
    const res = await request(createApp()).get('/test-error/status/404');

    expect(res.status).toBe(404);
    expect(res.body).toEqual(BAD_REQUEST);
    expect(res.text).not.toContain('secret detail');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('1d: honours statusCode as well as status', async () => {
    const res = await request(createApp()).get('/test-error/statusCode/413');

    expect(res.status).toBe(413);
    expect(res.body).toEqual(BAD_REQUEST);
    expect(consoleError).not.toHaveBeenCalled();
  });

  // 1e: only 400-499 is honoured; anything else is a server fault.
  it.each([
    ['status', 302],
    ['status', 399],
    ['status', 503],
    ['status', 600],
    ['statusCode', 600],
    ['statusCode', 301],
  ])('1e: clamps %s=%i to 500, never echoed, no redirect', async (key, code) => {
    const res = await request(createApp()).get(`/test-error/${key}/${code}`);

    expect(res.status).toBe(500);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toEqual(INTERNAL);
    expect(res.text).not.toContain('secret detail');
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
