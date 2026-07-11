const { expressjwt } = require('express-jwt');
const jwksRsa = require('jwks-rsa');

/**
 * Validates AWS Cognito JWTs and propagates claims onto req.auth for
 * downstream calls to cv-domain-service.
 */
function requireAuth() {
  const issuer = process.env.COGNITO_ISSUER_URI;
  if (!issuer) {
    throw new Error('COGNITO_ISSUER_URI must be set to enable auth');
  }

  return expressjwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${issuer}/.well-known/jwks.json`,
    }),
    issuer,
    algorithms: ['RS256'],
  });
}

module.exports = { requireAuth };
