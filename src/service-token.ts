/**
 * The BFF's own credential towards cv-domain-service (T-211).
 *
 * The domain service in AWS requires a Cognito JWT on every call, while the
 * public routes here are anonymous by contract (T-013) -- so the BFF calls the
 * domain service as ITSELF, with an OAuth2 client_credentials token from the
 * user pool's token endpoint.
 *
 * Three configurations, decided at H1 (T-043):
 *   - all four env vars set   -> fetch, cache until shortly before expiry,
 *                                and FAIL CLOSED on any error (reject).
 *   - none set                -> `undefined`: no token, the local dev stack
 *                                (domain auth off) works exactly as before.
 *   - some but not all set    -> a misconfiguration: reject, naming the
 *                                missing variables (never any value).
 *
 * SECRECY. Neither the client secret nor the access token may appear in a log
 * line, an error message or a metric. Every error this module produces is a
 * ServiceTokenError with a fixed message ("... (status N)" at most) and no
 * `cause` -- an upstream error object or response body is never chained,
 * because it could echo what we sent.
 */

export const SERVICE_TOKEN_ENV = {
  tokenUrl: 'COGNITO_TOKEN_URL',
  clientId: 'SERVICE_CLIENT_ID',
  clientSecret: 'SERVICE_CLIENT_SECRET',
  scope: 'SERVICE_TOKEN_SCOPE',
} as const;

export interface ServiceTokenConfig {
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/** Resolves the current bearer token, or `undefined` when none is configured. */
export type ServiceTokenProvider = () => Promise<string | undefined>;

export interface ServiceTokenDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
  /** Milliseconds since the epoch; injectable so expiry is testable. */
  now?: () => number;
}

/** Always carries a message that is safe to log and nothing else. */
export class ServiceTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceTokenError';
  }
}

/** Refresh this long before expiry: 5 minutes, or 10% of a short token's life. */
const MAX_MARGIN_SECONDS = 300;
const marginSeconds = (expiresIn: number) => Math.min(MAX_MARGIN_SECONDS, expiresIn * 0.1);

const blankToUndefined = (value: string | undefined) => (value === undefined || value === '' ? undefined : value);

export function serviceTokenConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServiceTokenConfig {
  return {
    tokenUrl: blankToUndefined(env[SERVICE_TOKEN_ENV.tokenUrl]),
    clientId: blankToUndefined(env[SERVICE_TOKEN_ENV.clientId]),
    clientSecret: blankToUndefined(env[SERVICE_TOKEN_ENV.clientSecret]),
    scope: blankToUndefined(env[SERVICE_TOKEN_ENV.scope]),
  };
}

export function createServiceTokenProvider(
  config: ServiceTokenConfig,
  deps: ServiceTokenDeps = {},
): ServiceTokenProvider {
  const keys = Object.keys(SERVICE_TOKEN_ENV) as (keyof typeof SERVICE_TOKEN_ENV)[];
  const missing = keys.filter((k) => blankToUndefined(config[k]) === undefined);

  if (missing.length === keys.length) {
    return async () => undefined;
  }
  if (missing.length > 0) {
    const names = missing.map((k) => SERVICE_TOKEN_ENV[k]).join(', ');
    const error = `service token misconfigured: missing ${names}`;
    return async () => {
      throw new ServiceTokenError(error);
    };
  }

  const { tokenUrl, clientId, clientSecret, scope } = config as Required<ServiceTokenConfig>;
  const doFetch = deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let cached: { token: string; refreshAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function requestToken(): Promise<string> {
    let response: Pick<Response, 'ok' | 'status' | 'json'>;
    try {
      response = await doFetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
      });
    } catch {
      throw new ServiceTokenError('service token request failed (network error)');
    }
    if (!response.ok) {
      throw new ServiceTokenError(`service token request failed (status ${response.status})`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceTokenError('service token request failed (malformed response)');
    }
    const { access_token: token, expires_in: expiresIn } = (body ?? {}) as Record<string, unknown>;
    if (typeof token !== 'string' || token === '' || typeof expiresIn !== 'number' || !(expiresIn > 0)) {
      throw new ServiceTokenError('service token request failed (malformed response)');
    }
    cached = { token, refreshAt: now() + (expiresIn - marginSeconds(expiresIn)) * 1000 };
    return token;
  }

  return async () => {
    if (cached && now() < cached.refreshAt) {
      return cached.token;
    }
    if (!inFlight) {
      // Shared by every caller that arrives while it is pending; cleared on
      // settle either way, so a failure is never cached and the next call retries.
      inFlight = requestToken().finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  };
}

/**
 * Request headers for one upstream call: `Authorization: Bearer` when a token
 * is configured, none otherwise. Rejects (fail closed) when the provider does.
 */
export async function upstreamAuthHeaders(provider: ServiceTokenProvider): Promise<Record<string, string>> {
  const token = await provider();
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

/**
 * The one log line a route writes when the provider rejects. Only a
 * ServiceTokenError's message is trusted to be secret-free; anything else is
 * reduced to a constant.
 */
export function logServiceTokenFailure(err: unknown): void {
  console.error(err instanceof ServiceTokenError ? err.message : 'service token request failed');
}
