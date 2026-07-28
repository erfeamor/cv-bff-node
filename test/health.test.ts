import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /metrics', () => {
  it('exposes Prometheus metrics', async () => {
    const res = await request(createApp()).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
  });
});
