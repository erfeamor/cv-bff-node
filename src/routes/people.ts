import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

const DOMAIN_SERVICE_URL = process.env.DOMAIN_SERVICE_URL || 'http://localhost:8080';

/** Shape returned by cv-domain-service — includes internal fields we strip. */
interface DomainPerson {
  id: number;
  fullName: string;
  headline?: string;
  email?: string;
  location?: string;
  summary?: string;
}

/** Public-facing shape: no internal `id`, no `email`. */
interface PublicPerson {
  name: string;
  headline?: string;
  location?: string;
  summary?: string;
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
  try {
    const response = await fetch(`${DOMAIN_SERVICE_URL}/api/v1/people/${req.params.id}`);
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
