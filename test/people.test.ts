import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /bff/api/v1/people/:id', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes the domain service response', async () => {
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

    const res = await request(createApp()).get('/bff/api/v1/people/1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Jane Doe',
      headline: 'Engineer',
      location: 'Remote',
      summary: 'Bio',
    });
  });

  it('propagates upstream errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/99');

    expect(res.status).toBe(404);
  });
});
