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
interface PublicCv {
  name: string;
  headline?: string;
  location?: string;
  summary?: string;
  experiences: PublicExperience[];
  education: PublicEducation[];
  skills: PublicSkill[];
  projects: PublicProject[];
}

type PublicExperience = Omit<DomainExperience, 'id'>;
type PublicEducation = Omit<DomainEducation, 'id'>;
type PublicSkill = Omit<DomainSkillAssignment, 'skillId'>;
type PublicProject = Omit<DomainProject, 'id'>;

function normalizePerson(person: DomainPerson) {
  return {
    name: person.fullName,
    headline: person.headline,
    location: person.location,
    summary: person.summary,
  };
}

// Each normalizer drops exactly one internal key and passes the rest through.
// Destructuring rather than rebuilding field-by-field is deliberate: a new
// contract field arrives in the payload without an edit here, and the only way
// an internal id leaks is if it is named something these do not strip -- which
// the "no internal ids" test asserts directly rather than trusting.
const stripExperience = ({ id: _id, ...rest }: DomainExperience): PublicExperience => rest;
const stripEducation = ({ id: _id, ...rest }: DomainEducation): PublicEducation => rest;
const stripSkill = ({ skillId: _skillId, ...rest }: DomainSkillAssignment): PublicSkill => rest;
const stripProject = ({ id: _id, ...rest }: DomainProject): PublicProject => rest;

/**
 * Thrown when an upstream fetch fails. `status` is the HTTP status this route
 * should answer with -- already mapped, so the handler never re-derives it.
 */
class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`upstream returned ${status}`);
  }
}

router.get('/people/:id/cv', async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id;

  // BEFORE any upstream call -- five URLs are built from this value, on a route
  // that is anonymous by contract (T-013). See validate-person-id.ts and T-204.
  if (!isValidPersonId(id)) {
    return res.status(400).json({ error: 'invalid person id' });
  }

  const base = `${DOMAIN_SERVICE_URL}/api/v1/people/${id}`;

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
    // Promise.all, not sequential awaits: all five requests are in flight before
    // any of them resolves. The test proves this with deferred promises rather
    // than by counting fetch calls, which is identical under both shapes.
    const [person, experiences, education, skills, projects] = await Promise.all([
      // Person 404 -> 404. Any OTHER person failure -> 502, and any section
      // failure -> 502: the contract is silent on a non-404 person failure, and
      // T-201 ruling 4 fills that silence toward the contract's own stated
      // reason -- "the public site treats the CV as one unit". Passing the
      // upstream status through, as `people.ts` does, would leak a 500.
      get<DomainPerson>(base, 404),
      get<DomainExperience[]>(`${base}/experiences`, 502),
      get<DomainEducation[]>(`${base}/educations`, 502),
      get<DomainSkillAssignment[]>(`${base}/skills`, 502),
      get<DomainProject[]>(`${base}/projects`, 502),
    ]);

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
