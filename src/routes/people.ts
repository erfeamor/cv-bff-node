import { Router, Request, Response, NextFunction } from 'express';
import { isValidPersonId } from '../middleware/validate-person-id';

const router = Router();

const DOMAIN_SERVICE_URL = process.env.DOMAIN_SERVICE_URL || 'http://localhost:8080';

/**
 * Shape returned by cv-domain-service -- includes internal fields we strip.
 *
 * Optionals are `string | null`, NOT `?: string`: contract rule 7 ratifies that
 * an optional field is always a PRESENT key whose empty value is `null`
 * (cv-domain-service declares no @JsonInclude, so Jackson's ALWAYS applies).
 * The key is never missing, so `?:` described a shape the upstream does not
 * produce (T-210).
 */
interface DomainPerson {
  id: number;
  fullName: string;
  headline: string | null;
  email: string | null;
  location: string | null;
  summary: string | null;
}

/**
 * Public-facing shape: no internal `id`, no `email`.
 *
 * Every field is a REQUIRED KEY with a nullable value -- deliberately not `?:`.
 * An object literal may omit a `?:` key for free, so with `?:` a newly
 * contracted head field could silently vanish from this ANONYMOUS route
 * (T-013) with a green build. Required keys make that omission a TS2741.
 * This is the same guarantee T-207 established on the aggregate; this route
 * was the half it did not reach (found reviewing T-209).
 */
export interface PublicPerson {
  name: string;
  headline: string | null;
  location: string | null;
  summary: string | null;
}

function normalize(person: DomainPerson): PublicPerson {
  return {
    name: person.fullName,
    headline: person.headline,
    location: person.location,
    summary: person.summary,
  };
}

router.get('/people/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id;

  // BEFORE the upstream call -- Express percent-DECODES this param, so without
  // the guard `..` and `1%2Fadmin` reach the template below as path syntax and
  // steer the request at a different upstream path (T-204). Same shared guard,
  // same 400 body as the aggregate route: two public routes, one answer for one
  // class of input. See validate-person-id.ts for the three checks it applies.
  if (!isValidPersonId(id)) {
    return res.status(400).json({ error: 'invalid person id' });
  }

  try {
    // Encoded after validating, never instead of it (T-204 scope). The guard has
    // already run, so on today's `/^[0-9]+$/` this is a no-op -- the point is that
    // the URL's safety no longer rests solely on a regex in another module. If
    // `PERSON_ID_PATTERN` is ever widened, this line is the local defence.
    const response = await fetch(`${DOMAIN_SERVICE_URL}/api/v1/people/${encodeURIComponent(id)}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'upstream error' });
    }
    const person = (await response.json()) as DomainPerson;
    res.json(normalize(person));
  } catch (err) {
    next(err);
  }
});

export default router;
