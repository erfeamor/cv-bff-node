import { Router, Request, Response, NextFunction } from 'express';
import { isValidPersonId } from '../middleware/validate-person-id';
import { logServiceTokenFailure, ServiceTokenProvider, upstreamAuthHeaders } from '../service-token';

const DOMAIN_SERVICE_URL = process.env.DOMAIN_SERVICE_URL || 'http://localhost:8080';

/** Shapes returned by cv-domain-service -- each includes internal fields we strip. */
interface DomainPerson {
  id: number;
  fullName: string;
  headline: string | null;
  email: string | null;
  location: string | null;
  summary: string | null;
}

interface DomainExperience {
  id: number;
  company: string;
  role: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

interface DomainEducation {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy: string | null;
  startDate: string;
  endDate: string | null;
}

/** Assignments GET returns `skillId`, NOT `id` -- see the contract's Skills table. */
interface DomainSkillAssignment {
  skillId: number;
  name: string;
  category: string | null;
  proficiency: string;
}

interface DomainProject {
  id: number;
  name: string;
  description: string | null;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Public-facing shapes: no `id`, `personId`, `skillId` or `email`. */
export interface PublicCv {
  name: string;
  headline: string | null;
  location: string | null;
  summary: string | null;
  experiences: PublicExperience[];
  education: PublicEducation[];
  skills: PublicSkill[];
  projects: PublicProject[];
}

/**
 * The person half of the aggregate -- `normalizePerson`'s return type, and the
 * reason it HAS one. Without an annotation its result is inferred and then
 * SPREAD into `body`, and spread-in properties from a non-fresh type get no
 * excess-property check: `email: person.email` typechecked clean and shipped on
 * the wire, the one field this repo ranks as a hard blocker (T-207 review 1).
 * Annotated, that same edit is TS2353 -- the four section normalizers were
 * already protected this way; this brings the fifth under the same guard.
 */
export type PublicPerson = Omit<PublicCv, 'experiences' | 'education' | 'skills' | 'projects'>;

// TRANSCRIBED FROM docs/api-contract.md (SS Experience, Education, Projects,
// Skills, and the Aggregate endpoint) -- NOT derived from the Domain* shapes
// above. They used to be `Omit<Domain*, 'id'>`, which made tsc check the public
// payload against the very upstream shape this route exists to distrust (T-207).
//
// Every contract-OPTIONAL field is a REQUIRED KEY with a nullable VALUE
// (`location: string | null`), deliberately NOT `location?: string`. An object
// literal may omit a `?:` key for free, so `?:` would leave a newly contracted
// field silently absent from the payload; with a required key, omitting it from
// a strip* rebuild is TS2741. `endDate` is the same shape for a different
// reason -- rule 3 gives its `null` the meaning "current", which contract rule 7
// explicitly does NOT govern (settled in T-205, restated in T-209).
//
// WHY `| null` AND NO `| undefined`. Contract rule 7 (amended 2026-08-28,
// T-209) ratifies that an optional field is always a PRESENT key whose empty
// value is `null` -- never a missing key. cv-domain-service has always behaved
// this way (no @JsonInclude, no spring.jackson.default-property-inclusion, so
// Jackson's ALWAYS applies; asserted in EducationControllerTest and
// ProjectControllerTest, confirmed against live MySQL), but until T-209 the
// contract was SILENT and this file said so in a comment. It is no longer
// silent, so these types are now spelled to a RATIFIED RULE rather than to
// observed upstream behaviour -- which is what makes dropping `| undefined`
// legitimate rather than merely convenient (T-210).
//
// The `| undefined` half was never a description of the upstream. It was
// inherited: the Domain* interfaces above used to spell these `?: string`, so a
// rebuild copying `e.location` yielded `string | undefined` and the public type
// had to admit it. T-210 corrected Domain* first; the public side then tightens
// for free, and T-207's guard proves nothing else moved.
//
// The wire payload is unchanged by any of this because the normalizers copy
// these values VERBATIM -- a `null` upstream stays `null` on the wire, key
// present. Note what is deliberately NOT done: there is no `?? null`. If the
// upstream ever violated rule 7 and omitted a key, the value would be
// `undefined` at runtime whatever the type says, JSON.stringify would drop it,
// and the payload would degrade to an absent key rather than gaining a
// fabricated `null`. Rule 7 is a guarantee INHERITED from the producer, not one
// this file enforces -- exactly as the contract now states.
// See test/public-types.test.ts for the guard on both directions.
export interface PublicExperience {
  company: string;
  role: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

export interface PublicEducation {
  institution: string;
  degree: string;
  fieldOfStudy: string | null;
  startDate: string;
  endDate: string | null;
}

export interface PublicSkill {
  name: string;
  category: string | null;
  proficiency: string;
}

export interface PublicProject {
  name: string;
  description: string | null;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
}

function normalizePerson(person: DomainPerson): PublicPerson {
  return {
    name: person.fullName,
    headline: person.headline,
    location: person.location,
    summary: person.summary,
  };
}

// ALLOWLISTS, not denylists (T-205). Each normalizer names every field the
// contract declares for its section and copies exactly those; anything else the
// upstream sends is dropped because it was never asked for.
//
// What this defends against: cv-domain-service binds JPA entities directly with
// no DTO layer, so its response shape is whatever the entities happen to carry
// today. These interfaces are erased at runtime -- spreading the upstream
// object would forward a newly added column, or a relation that lost its
// @JsonIgnore, onto this route, ANONYMOUS by contract (T-013). Naming the
// fields makes a new upstream field a no-op here instead of a disclosure, and
// the cost is that a new CONTRACT field needs an edit in this file -- which is
// the correct place to review a change to the public payload.
//
// That cost is now actually ENFORCED, which it was not when T-205 wrote this
// claim: the Public* types below are transcribed from the contract instead of
// `Omit<Domain*, 'id'>` (T-207), so the compiler checks these rebuilds in both
// directions --
//   * NEW UPSTREAM FIELD (leak): adding a field to a Domain* interface produces
//     no error here at all. It is simply not copied, so it cannot reach the
//     anonymous payload under compiler pressure to "fix the build".
//   * NEW CONTRACT FIELD (drop): adding a field to a Public* interface IS a
//     TS2741 in the matching normalizer until it is copied -- including
//     contract-optional fields, which is why those are declared `T | null`
//     rather than `?:`. Spell a new optional `T | null`, never `T | undefined`
//     and never `?:` -- contract rule 7 says the key is always present with a
//     `null` empty value, and test/public-types.test.ts fails the build on
//     either wrong spelling (T-210).
// What the compiler still cannot check is whether a Public* interface matches
// docs/api-contract.md; that transcription is reviewed by hand.
//
// Field lists come from docs/api-contract.md (sections Experience, Education,
// Projects, Skills, and the Aggregate endpoint), never from the interfaces
// above. `endDate` is required-but-nullable: assign it directly, never
// `|| null`, which would collapse a legitimate empty string to null.
const stripExperience = (e: DomainExperience): PublicExperience => ({
  company: e.company,
  role: e.role,
  location: e.location,
  startDate: e.startDate,
  endDate: e.endDate,
  description: e.description,
});

const stripEducation = (e: DomainEducation): PublicEducation => ({
  institution: e.institution,
  degree: e.degree,
  fieldOfStudy: e.fieldOfStudy,
  startDate: e.startDate,
  endDate: e.endDate,
});

const stripSkill = (s: DomainSkillAssignment): PublicSkill => ({
  name: s.name,
  category: s.category,
  proficiency: s.proficiency,
});

const stripProject = (p: DomainProject): PublicProject => ({
  name: p.name,
  description: p.description,
  repoUrl: p.repoUrl,
  startDate: p.startDate,
  endDate: p.endDate,
});

/**
 * Thrown when an upstream fetch fails. `status` is the HTTP status this route
 * should answer with -- already mapped, so the handler never re-derives it.
 */
class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`upstream returned ${status}`);
  }
}

/**
 * Returns a settled result's value, rethrowing its reason if it rejected.
 *
 * A loop over the results would not type-narrow -- TypeScript cannot carry a
 * `status === 'rejected'` check made inside a loop back out to the individual
 * variables -- and, more importantly, a loop would obscure that the ORDER of
 * these calls is what encodes the contract's error precedence.
 */
function unwrap<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') {
    throw result.reason;
  }
  return result.value;
}

export function createCvRouter(serviceToken: ServiceTokenProvider): Router {
  const router = Router();

  router.get('/people/:id/cv', async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;

    // BEFORE any upstream call -- five URLs are built from this value, on a route
    // that is anonymous by contract (T-013). See validate-person-id.ts and T-204.
    if (!isValidPersonId(id)) {
      return res.status(400).json({ error: 'invalid person id' });
    }

    // Encoded even though the guard above already ran, and NOT because that guard
    // is in doubt: on today's `/^[0-9]+$/` this call is a provable no-op. It is
    // here so the safety of these five URLs stops depending on a pattern that
    // lives in ANOTHER module -- widen that pattern and this line is what keeps
    // the widening from becoming an injection point. Defence in depth against a
    // future edit, not redundancy against the current one (T-204 review round 1).
    const base = `${DOMAIN_SERVICE_URL}/api/v1/people/${encodeURIComponent(id)}`;

    // ONE token for all five calls, obtained BEFORE any of them starts: when a
    // service token is configured and cannot be obtained, no domain call is made
    // and the route answers 502 (T-211, fail closed). Never logged beyond the
    // error's fixed message.
    let headers: Record<string, string>;
    try {
      headers = await upstreamAuthHeaders(serviceToken);
    } catch (err) {
      logServiceTokenFailure(err);
      return res.status(502).json({ error: 'upstream error' });
    }

    // NOTE the singular/plural split, which is the contract's and not a typo:
    // the aggregate key is `education`, the upstream path is `/educations`.
    const get = async <T>(url: string, notFoundStatus: number): Promise<T> => {
      const response = await fetch(url, { headers });
      // Any non-404 failure -- including a 401/403, which with a service token
      // means OUR credential failed, not the visitor's (T-211) -- is a 502.
      if (!response.ok) {
        throw new UpstreamError(response.status === 404 ? notFoundStatus : 502);
      }
      return (await response.json()) as T;
    };

    try {
      // allSettled, NOT Promise.all -- and the difference is a contract bug, not a
      // style choice. An unknown person makes ALL FIVE upstreams 404, because
      // every section controller calls requirePerson(personId) as the first line
      // of findAll (ExperienceController:47 and its three siblings). Promise.all
      // rejects with whichever rejection lands FIRST, so a section's 404 could
      // beat the person's over a real network and the route would answer 502
      // where the contract mandates 404. allSettled removes the race entirely by
      // waiting for all five, then applying precedence explicitly below.
      //
      // The requests still overlap -- allSettled starts them all at once exactly
      // as Promise.all does, so the parallelism the contract asks for is intact
      // and its test still passes.
      const [personR, experiencesR, educationR, skillsR, projectsR] = await Promise.allSettled([
        get<DomainPerson>(base, 404),
        get<DomainExperience[]>(`${base}/experiences`, 502),
        get<DomainEducation[]>(`${base}/educations`, 502),
        get<DomainSkillAssignment[]>(`${base}/skills`, 502),
        get<DomainProject[]>(`${base}/projects`, 502),
      ]);

      // PRECEDENCE, in contract order, and it is the ORDER of these calls that
      // enforces it: `unwrap` rethrows the stored reason, so whichever is
      // unwrapped first decides the response. The person goes first because its
      // 404 means "no such CV" and must win over the section 404s that always
      // accompany it. Any other person failure, and any section failure, is 502 --
      // "the public site treats the CV as one unit" (T-201 ruling 4).
      const person = unwrap(personR);
      const experiences = unwrap(experiencesR);
      const education = unwrap(educationR);
      const skills = unwrap(skillsR);
      const projects = unwrap(projectsR);

      // Order is passed through untouched -- no .sort(), .reverse() or re-keying.
      // Ordering is settled in the contract's Ordering section and owned by the
      // domain service; sorting here would be a second source of truth.
      const body: PublicCv = {
        ...normalizePerson(person),
        experiences: experiences.map(stripExperience),
        education: education.map(stripEducation),
        skills: skills.map(stripSkill),
        projects: projects.map(stripProject),
      };

      res.json(body);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return res.status(err.status).json({ error: 'upstream error' });
      }
      next(err);
    }
  });

  return router;
}
