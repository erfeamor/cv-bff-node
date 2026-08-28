import { Router, Request, Response, NextFunction } from 'express';
import { isValidPersonId } from '../middleware/validate-person-id';

const router = Router();

const DOMAIN_SERVICE_URL = process.env.DOMAIN_SERVICE_URL || 'http://localhost:8080';

/** Shapes returned by cv-domain-service -- each includes internal fields we strip. */
interface DomainPerson {
  id: number;
  fullName: string;
  headline?: string;
  email?: string;
  location?: string;
  summary?: string;
}

interface DomainExperience {
  id: number;
  company: string;
  role: string;
  location?: string;
  startDate: string;
  endDate: string | null;
  description?: string;
}

interface DomainEducation {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startDate: string;
  endDate: string | null;
}

/** Assignments GET returns `skillId`, NOT `id` -- see the contract's Skills table. */
interface DomainSkillAssignment {
  skillId: number;
  name: string;
  category?: string;
  proficiency: string;
}

interface DomainProject {
  id: number;
  name: string;
  description?: string;
  repoUrl?: string;
  startDate?: string;
  endDate: string | null;
}

/** Public-facing shapes: no `id`, `personId`, `skillId` or `email`. */
export interface PublicCv {
  name: string;
  headline: string | null | undefined;
  location: string | null | undefined;
  summary: string | null | undefined;
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
// Every contract-OPTIONAL field is a REQUIRED KEY with a nullable, omissible
// VALUE (`location: string | null | undefined`), deliberately NOT `location?:
// string`. An object literal may omit a `?:` key for free, so `?:` would leave
// a newly contracted field silently absent from the payload; with a required
// key, omitting it from a strip* rebuild is TS2741. `endDate` is the same shape
// for a different reason -- required-but-nullable in the contract, which is not
// the same thing as optional (settled in T-205).
//
// WHY `| null`, and why `| undefined` as well. cv-domain-service binds JPA
// entities directly, declares no @JsonInclude(NON_NULL) and sets no
// spring.jackson.default-property-inclusion, so Jackson's default ALWAYS
// applies: an absent optional arrives as an explicit `null`, not as a missing
// key (asserted upstream in EducationControllerTest:177 and
// SkillControllerTest:113, both confirmed against live MySQL). `| undefined` is
// then kept because the Domain* interfaces above spell these `?: string` and
// are not this task's to change -- so a rebuild copying `e.location` yields
// `string | undefined` and the public type must admit it. THE CONTRACT IS
// SILENT on null-vs-absent for optional fields; this is typed to observed
// upstream behaviour, not to a rule the contract states.
//
// The wire payload is unchanged by any of this because the normalizers copy
// these values VERBATIM -- a `null` upstream stays `null` on the wire, key
// present. (JSON.stringify's dropping of undefined-valued keys is load-bearing
// only for the case where the upstream omits a key entirely, which is what
// T-205's sparse test fixes in place; it is NOT why the payload is unchanged.)
// See test/public-types.test.ts for the guard on both directions.
export interface PublicExperience {
  company: string;
  role: string;
  location: string | null | undefined;
  startDate: string;
  endDate: string | null;
  description: string | null | undefined;
}

export interface PublicEducation {
  institution: string;
  degree: string;
  fieldOfStudy: string | null | undefined;
  startDate: string;
  endDate: string | null;
}

export interface PublicSkill {
  name: string;
  category: string | null | undefined;
  proficiency: string;
}

export interface PublicProject {
  name: string;
  description: string | null | undefined;
  repoUrl: string | null | undefined;
  startDate: string | null | undefined;
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
//     contract-optional fields, which is why those are declared `T | undefined`
//     rather than `?:`.
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

  // NOTE the singular/plural split, which is the contract's and not a typo:
  // the aggregate key is `education`, the upstream path is `/educations`.
  const get = async <T>(url: string, notFoundStatus: number): Promise<T> => {
    const response = await fetch(url);
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

export default router;
