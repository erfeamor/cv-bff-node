import request from 'supertest';
import { createApp } from '../src/app';

/**
 * Upstream call order is fixed by the route's Promise.all array:
 *   0 person   1 experiences   2 educations   3 skills   4 projects
 */
const PERSON = {
  id: 1,
  fullName: 'Jane Doe',
  headline: 'Engineer',
  email: 'jane@example.com',
  location: 'Remote',
  summary: 'Bio',
};
const EXPERIENCES = [
  {
    id: 7,
    company: 'ACME',
    role: 'Backend Engineer',
    location: 'Remote',
    startDate: '2022-01-01',
    endDate: null,
    description: 'Built things',
  },
];
const EDUCATIONS = [
  {
    id: 3,
    institution: 'UNED',
    degree: 'BSc',
    fieldOfStudy: 'Computer Science',
    startDate: '2015-09-01',
    endDate: '2019-06-30',
  },
];
const SKILLS = [{ skillId: 42, name: 'Java', category: 'Backend', proficiency: 'ADVANCED' }];
const PROJECTS = [
  {
    id: 9,
    name: 'cv-project',
    description: 'This',
    repoUrl: 'https://github.com/erfeamor/curriculum',
    startDate: '2026-07-01',
    endDate: null,
  },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Resolves every upstream immediately, in the route's fixed order. */
function mockHappyPath() {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(ok(PERSON))
    .mockResolvedValueOnce(ok(EXPERIENCES))
    .mockResolvedValueOnce(ok(EDUCATIONS))
    .mockResolvedValueOnce(ok(SKILLS))
    .mockResolvedValueOnce(ok(PROJECTS));
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

describe('GET /bff/api/v1/people/:id/cv', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('matches the contract example field-for-field', async () => {
    mockHappyPath();

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Jane Doe',
      headline: 'Engineer',
      location: 'Remote',
      summary: 'Bio',
      experiences: [
        {
          company: 'ACME',
          role: 'Backend Engineer',
          location: 'Remote',
          startDate: '2022-01-01',
          endDate: null,
          description: 'Built things',
        },
      ],
      education: [
        {
          institution: 'UNED',
          degree: 'BSc',
          fieldOfStudy: 'Computer Science',
          startDate: '2015-09-01',
          endDate: '2019-06-30',
        },
      ],
      skills: [{ name: 'Java', category: 'Backend', proficiency: 'ADVANCED' }],
      projects: [
        {
          name: 'cv-project',
          description: 'This',
          repoUrl: 'https://github.com/erfeamor/curriculum',
          startDate: '2026-07-01',
          endDate: null,
        },
      ],
    });
  });

  it('leaks no internal id, personId, skillId or email anywhere in the payload', async () => {
    mockHappyPath();

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    // Asserted over the SERIALIZED body, not per-field: a leak in a section the
    // shape test happens not to cover still fails this. The values are checked
    // as well as the keys -- `42` and the email string are in the mocked
    // upstreams and must not survive.
    const serialized = JSON.stringify(res.body);
    for (const key of ['"id"', '"personId"', '"skillId"', '"email"']) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('42');
  });

  it('hits the four section paths the contract names, including the education/educations split', async () => {
    const fetchMock = mockHappyPath();

    await request(createApp()).get('/bff/api/v1/people/1/cv');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      'http://localhost:8080/api/v1/people/1',
      'http://localhost:8080/api/v1/people/1/experiences',
      'http://localhost:8080/api/v1/people/1/educations',
      'http://localhost:8080/api/v1/people/1/skills',
      'http://localhost:8080/api/v1/people/1/projects',
    ]);
  });

  it('issues all five upstream requests before any of them resolves', async () => {
    // THE PARALLELISM PROOF. Asserting fetch call COUNT cannot fail -- it is 5
    // under Promise.all and under five sequential awaits alike, which is why
    // that criterion was struck from the task. A duration assertion is also
    // rejected: flaky under CI load, and green for the wrong reason on a fast
    // machine. This holds every upstream unresolved and checks that all five
    // were nevertheless initiated; sequential code stalls at the second.
    const resolvers: Array<() => void> = [];
    const payloads = [PERSON, EXPERIENCES, EDUCATIONS, SKILLS, PROJECTS];
    let calls = 0;

    global.fetch = jest.fn().mockImplementation(() => {
      const payload = payloads[calls];
      calls += 1;
      return new Promise((resolve) => {
        resolvers.push(() => resolve(ok(payload)));
      });
    }) as unknown as typeof global.fetch;

    // `.then()` is what DISPATCHES a supertest request -- the Test object is
    // lazy, so `request(app).get(url)` alone never reaches the route and this
    // test would fail with 0 resolvers for a reason unrelated to parallelism.
    const pending = request(createApp())
      .get('/bff/api/v1/people/1/cv')
      .then((r) => r);

    // Yield repeatedly so the route can reach every fetch, WITHOUT resolving any
    // of them. Under Promise.all all five land here; under sequential awaits
    // only the first ever does, because nothing has resolved to unblock it.
    for (let i = 0; i < 20 && resolvers.length < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(resolvers).toHaveLength(5);

    resolvers.forEach((resolve) => resolve());
    const res = await pending;
    expect(res.status).toBe(200);
  });

  it('passes section order through untouched, even when it is not the natural order', async () => {
    // Deliberately NOT in any order a sort would produce -- not by date, not by
    // name, not by id. Ordering is settled upstream (contract, Ordering); a
    // .sort() in this layer would be a second source of truth.
    const scrambledExperiences = [
      { ...EXPERIENCES[0], id: 3, company: 'Zulu', startDate: '2019-01-01' },
      { ...EXPERIENCES[0], id: 1, company: 'Alpha', startDate: '2024-01-01' },
      { ...EXPERIENCES[0], id: 2, company: 'Mike', startDate: '2021-01-01' },
    ];
    const scrambledSkills = [
      { skillId: 9, name: 'Zsh', category: 'Tooling', proficiency: 'EXPERT' },
      { skillId: 1, name: 'Ada', category: 'Backend', proficiency: 'BEGINNER' },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(ok(PERSON))
      .mockResolvedValueOnce(ok(scrambledExperiences))
      .mockResolvedValueOnce(ok(EDUCATIONS))
      .mockResolvedValueOnce(ok(scrambledSkills))
      .mockResolvedValueOnce(ok(PROJECTS)) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    expect(res.body.experiences.map((e: { company: string }) => e.company)).toEqual([
      'Zulu',
      'Alpha',
      'Mike',
    ]);
    expect(res.body.skills.map((s: { name: string }) => s.name)).toEqual(['Zsh', 'Ada']);
  });

  it('returns 404 for an unknown person even when a SECTION 404 lands first', async () => {
    // REGRESSION TEST for the Promise.all race found in T-201's review round 1.
    // An unknown person makes ALL FIVE upstreams 404 -- every section controller
    // calls requirePerson() as the first line of findAll. Under Promise.all the
    // route answered with whichever rejection settled FIRST, so a section could
    // win over a real network and return 502 where the contract mandates 404.
    //
    // The sibling test below cannot catch this: its mocks resolve synchronously
    // in array order, so the person's rejection always lands first and the bug
    // is invisible. This one forces the opposite order explicitly.
    const deferred = new Map<string, (v: unknown) => void>();
    global.fetch = jest.fn().mockImplementation((url: string) => {
      return new Promise((resolve) => {
        deferred.set(String(url), resolve as (v: unknown) => void);
      });
    }) as unknown as typeof global.fetch;

    const pending = request(createApp())
      .get('/bff/api/v1/people/999/cv')
      .then((r) => r);

    for (let i = 0; i < 20 && deferred.size < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(deferred.size).toBe(5);

    const notFound = { ok: false, status: 404 };
    // Sections first, person LAST -- the ordering the old implementation lost to.
    for (const [url, resolve] of deferred) {
      if (!url.endsWith('/people/999')) resolve(notFound);
    }
    await new Promise((resolve) => setImmediate(resolve));
    deferred.get('http://localhost:8080/api/v1/people/999')!(notFound);

    const res = await pending;
    expect(res.status).toBe(404);
  });

  it('returns 404 when the person is not found upstream', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/99/cv');

    expect(res.status).toBe(404);
  });

  it('returns 502 when a section fetch fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(ok(PERSON))
      .mockResolvedValueOnce(ok(EXPERIENCES))
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(ok(SKILLS))
      .mockResolvedValueOnce(ok(PROJECTS)) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    expect(res.status).toBe(502);
  });

  it('returns 502, not 404, when a section 404s — only the person 404 means "no CV"', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(ok(PERSON))
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(ok(EDUCATIONS))
      .mockResolvedValueOnce(ok(SKILLS))
      .mockResolvedValueOnce(ok(PROJECTS)) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    expect(res.status).toBe(502);
  });

  it('returns 502, not the upstream status, when the PERSON fetch fails with 500', async () => {
    // T-201 ruling 4: the contract is silent on a non-404 person failure. The
    // existing /people/:id route passes the upstream status straight through,
    // which would leak a 500 to the public site. Ruled 502 to match sections.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1/cv');

    expect(res.status).toBe(502);
  });

  it('rejects a non-numeric id with 400 and makes NO upstream call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/1;DROP/cv');

    expect(res.status).toBe(400);
    // The point of the guard is that the fan-out never happens.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal id before it reaches an upstream URL', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const res = await request(createApp()).get('/bff/api/v1/people/..%2F..%2Fadmin/cv');

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
