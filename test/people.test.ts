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

  // T-204. The guard is `isValidPersonId` from src/middleware/validate-person-id.ts
  // -- the SAME module the aggregate route adopted in T-201, not a second copy of
  // the rule. Every case below asserts BOTH the 400 and that `fetch` was never
  // called: a status-only assertion would pass against an implementation that
  // still builds the upstream URL and merely relabels the response (AC1).
  it('rejects a non-numeric id with 400 and makes NO upstream call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/abc');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });

  it('rejects a path-traversal id (..) before it reaches an upstream URL', async () => {
    // The dot segments are LITERAL and the separators are encoded, matching
    // cv.test.ts's traversal case. That spelling is deliberate: a request whose
    // final segment is a bare `..` (encoded or not: `/people/..`, `/people/%2E%2E`)
    // never reaches this route at all -- the client resolves the segment away and
    // the server sees `/`, a 404 from the app's fallthrough with no route hit and
    // no `req.params.id`. Encoding the SEPARATORS instead keeps the segment intact
    // through routing, so Express hands `../../admin` to the handler -- which is
    // the value the old code interpolated straight into the upstream URL.
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/..%2F..%2Fadmin');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });

  it('rejects an encoded separator (1%2Fadmin) before it reaches an upstream URL', async () => {
    // Express percent-decodes params, so this lands as `1/admin` and would have
    // steered the BFF at a different upstream PATH, not a different id.
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1%2Fadmin');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });

  it('rejects a negative id with 400 and makes NO upstream call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });

  it('inherits T-206 bounds: an id past Long.MAX_VALUE is 400 with NO upstream call', async () => {
    // This route never asked for a magnitude bound and does not implement one --
    // it gets it because T-206 bounded the SHARED guard before this task adopted
    // it (H1 ruling 3). Twenty nines is a well-formed digit run that no `Long`
    // can bind, so shape alone would have let it through to the domain service.
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get(`/bff/api/v1/people/${'9'.repeat(20)}`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });

  it('inherits T-206 bounds: an absurdly long zero-padded id is 400 with NO upstream call', async () => {
    // BigInt('0'.repeat(9000) + '1') is 1n -- in range by value, so only the
    // length cap stops this. Inherited too; see the guard module's "WHY 64".
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get(`/bff/api/v1/people/${'0'.repeat(9000)}1`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid person id' });
  });
});
