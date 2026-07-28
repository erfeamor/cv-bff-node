import { expressjwt, GetVerificationKey } from 'express-jwt';
import { expressJwtSecret } from 'jwks-rsa';

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
