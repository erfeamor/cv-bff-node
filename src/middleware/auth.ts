import { expressjwt, GetVerificationKey } from 'express-jwt';
import { expressJwtSecret } from 'jwks-rsa';

/**
 * One allowlist entry. Structurally the object form of express-unless' `Path`,
 * declared locally rather than imported so we don't depend on a package that is
 * only a transitive dependency of express-jwt.
 */
interface PublicRoute {
  url: RegExp;
  methods: string[];
}

/**
 * Public edge path for every BFF API route (docs/api-contract.md § BFF).
 * CloudFront forwards `/bff/*` without stripping the prefix, so the BFF serves
 * the exact same URL locally and behind the edge. The old `/api/v1` base is
 * gone: it collided with cv-domain-service, which owns `/api/*` at the edge.
 */
export const API_BASE_PATH = '/bff/api/v1';

/**
 * The anonymous allowlist: exactly the two routes the contract marks public,
 * because the public sites have no user to authenticate. Everything else under
 * API_BASE_PATH stays gated by AUTH_ENABLED.
 *
 * Matched on **exact method + full path**, never on prefix. Both entries live
 * under `/people/:id`, so a prefix-style exemption would look correct today and
 * silently exempt any future non-GET route added below that path.
 *
 * Two details that bite here:
 *  - express-unless matches plain strings by equality, with no `:param`
 *    support, so `'/bff/api/v1/people/:id'` would never match. Hence anchored
 *    regexes with a `[^/]+` id segment.
 *  - it matches against `req.originalUrl` (`useOriginalUrl`, set explicitly at
 *    the mount site), i.e. the full path *before* Express strips the router
 *    mount prefix. These patterns are therefore absolute, not mount-relative.
 *
 * The allowlist deliberately mirrors what the router actually dispatches, so a
 * request the router treats as public is never gated by accident:
 *  - `HEAD` as well as `GET`: Express auto-generates a HEAD handler for every
 *    GET route, so omitting it would 401 monitoring probes and CDN HEAD
 *    requests against an endpoint that is public by contract.
 *  - the `i` flag: Express routing is case-insensitive by default (`case
 *    sensitive routing` is not set), so `/BFF/API/V1/PEOPLE/1` already reaches
 *    the public handler. Do NOT "tighten" this by dropping the flag — it
 *    widens nothing (no gated route becomes reachable; a mixed-case gated path
 *    is still gated by the same rule) and only stops over-gating a route that
 *    is already public.
 */
export const PUBLIC_ROUTES: PublicRoute[] = [
  { url: new RegExp(`^${API_BASE_PATH}/people/[^/]+/?$`, 'i'), methods: ['GET', 'HEAD'] },
  { url: new RegExp(`^${API_BASE_PATH}/people/[^/]+/cv/?$`, 'i'), methods: ['GET', 'HEAD'] },
];

/**
 * Validates AWS Cognito JWTs and propagates claims onto req.auth for
 * downstream calls to cv-domain-service.
 */
export function requireAuth() {
  const issuer = process.env.COGNITO_ISSUER_URI;
  if (!issuer) {
    throw new Error('COGNITO_ISSUER_URI must be set to enable auth');
  }

  return expressjwt({
    secret: expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${issuer}/.well-known/jwks.json`,
    }) as GetVerificationKey,
    issuer,
    algorithms: ['RS256'],
  });
}
