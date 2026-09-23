import request from 'supertest';
import { createApp } from '../src/app';
import { register } from '../src/metrics';

// Series lines look like:
//   http_request_duration_seconds_count{method="GET",route="...",status_code="404"} 1
async function durationCountSeries(): Promise<Array<{ route: string; status: string }>> {
  const text = await register.metrics();
  return text
    .split('\n')
    .filter((line) => line.startsWith('http_request_duration_seconds_count{'))
    .map((line) => ({
      route: /route="([^"]*)"/.exec(line)?.[1] ?? '',
      status: /status_code="([^"]*)"/.exec(line)?.[1] ?? '',
    }));
}

describe('http_request_duration_seconds route label (T-208)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    register.resetMetrics();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('1f: buckets unmatched paths into one constant route value', async () => {
    const app = createApp();
    await request(app).get('/bff/api/v1/does-not-exist').expect(404);
    await request(app).get('/bff/api/v1/also-missing').expect(404);

    const routes = new Set((await durationCountSeries()).map((s) => s.route));

    expect([...routes]).toEqual(['unmatched']);
  });

  it('1f: a malformed percent-encoding is bucketed as unmatched too', async () => {
    global.fetch = jest.fn() as unknown as typeof global.fetch;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp();
    await request(app).get('/bff/api/v1/people/%E0%A4%A');
    await request(app).get('/bff/api/v1/totally/bogus');

    const routes = new Set((await durationCountSeries()).map((s) => s.route));

    expect([...routes]).toEqual(['unmatched']);
    jest.restoreAllMocks();
  });

  // Matched routes report Express's req.route.path, which for a router mounted
  // under /bff/api/v1 is the ROUTER-RELATIVE template -- that is what master
  // emits and this task must not change it.
  it('1g: a matched route keeps its route template unchanged', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1,
        fullName: 'Jane Doe',
        headline: null,
        email: null,
        location: null,
        summary: null,
      }),
    }) as unknown as typeof global.fetch;

    await request(createApp()).get('/bff/api/v1/people/1').expect(200);

    expect(await durationCountSeries()).toEqual([{ route: '/people/:id', status: '200' }]);
  });
});
