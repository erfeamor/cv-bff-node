# CLAUDE.md — cv-bff-node

Backend-for-Frontend for the public site: Node 20 + Express, **TypeScript** (strict, compiled to CommonJS). Aggregates and **normalizes** data from cv-domain-service for `cv-public-vanilla`. Read-only by design — mutations belong to the domain API. Cross-repo context: meta repo CLAUDE.md one directory up.

## Commands

```bash
npm install
npm test                   # Jest + Supertest (via ts-jest)
npm run typecheck          # tsc --noEmit (strict; separate gate from build)
npm run lint               # eslint (@typescript-eslint)
npm run dev                # :3000, tsx watch (cp .env.example .env first)
npm run build              # tsc → dist/ (production output); npm start runs dist/index.js
docker build -t cv-bff-node .
```

CI: `.github/workflows/ci.yml` (lint → typecheck → test → build → docker image). On a `master` push only, the `deploy` job (OIDC role from repo variable `AWS_DEPLOY_ROLE_ARN`) builds a multi-arch image (amd64 + arm64) → ECR `:latest` + `:<sha>` → SSM document `cv-redeploy-bff-node` targeted by tag `Name=cv-project-domain-service` → CloudFront smoke on `/bff/api/v1/people/1/cv`. Details and rollback: README § Deploy.

## TypeScript layout

- All source is TypeScript under `src/` (`.ts`); `tsconfig.json` is `strict` and type-checks `src` + `test` (used by `npm run typecheck` and ts-jest). `tsconfig.build.json` is the emit config: `src` only → `dist/` (`rootDir: src`, `outDir: dist`), excluding tests.
- Build compiles to **CommonJS** (`module: commonjs`, `"type": "commonjs"` stays); source uses ES module `import`/`export` syntax. `dist/` is gitignored and produced by `npm run build`; `npm start` and the Docker runtime stage run `dist/index.js`.
- Jest uses the `ts-jest` preset (`jest.config.js`, `testEnvironment: node`) — tests run straight from `.ts`, no separate build step and no babel.

## Architecture & conventions

- **`createApp()` factory** in `src/app.ts` (no `listen`) so tests build fresh instances; `src/index.ts` is the only place that listens. Keep it that way.
- Routes in `src/routes/`, cross-cutting middleware in `src/middleware/`. Upstream calls use global `fetch` (Node ≥18) — no axios.
- **Normalization is the product**: public payloads never expose internal `id`s or `email`; field names are public-friendly (`fullName` → `name`). See `normalize()` in `src/routes/people.ts`, typed with a `DomainPerson` input / `PublicPerson` output. New endpoints follow the API contract in the meta repo (`docs/api-contract.md`).
- Error mapping: upstream 404 passes through; upstream/partial failures on aggregates → 502; an upstream 401/403 → 502 on every route (it means the BFF's service token failed, never the visitor's); a service-token failure → 502 with no upstream call; JWT failures → 401 (handled centrally in `app.ts`).
- Tests mock `global.fetch` (see `test/people.test.ts` for the pattern, including `afterEach` restore; the mock is cast `as unknown as typeof global.fetch`). Supertest against `createApp()` — never against a running server.

## Auth & config

`AUTH_ENABLED=true` mounts Cognito JWT validation (`src/middleware/auth.ts`, jwks-rsa; the `expressJwtSecret` result is cast to `GetVerificationKey`) on `API_BASE_PATH` = `/bff/api/v1/*`, **minus the `PUBLIC_ROUTES` allowlist** (`GET`/`HEAD` on `/bff/api/v1/people/:id` and `.../cv`, matched on exact method + full path, never by prefix; case-insensitive to match Express's default routing); **default is off** for local dev. `/health` and `/metrics` are always public and stay at the app root. The old `/api/v1` base is removed, not dual-mounted — it belongs to cv-domain-service at the edge. Config via env only: `PORT`, `DOMAIN_SERVICE_URL`, `CORS_ALLOWED_ORIGINS`, `COGNITO_ISSUER_URI` — document new vars in `.env.example` in the same PR.

**Service token (T-211).** Upstream calls to cv-domain-service carry `Authorization: Bearer <token>` from `src/service-token.ts`: OAuth2 client_credentials against Cognito, configured by `COGNITO_TOKEN_URL`, `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`, `SERVICE_TOKEN_SCOPE`, read when `createApp()` builds its provider (tests inject one via `createApp({ serviceToken })`). All four set → cached until `expires_in` minus min(5 min, 10%), one shared in-flight request, fail closed (502, no upstream call). None set → no header (local stack). Some set → misconfiguration, rejects naming the missing variable names. The secret and the token never appear in logs, error bodies or metrics; errors carry fixed messages only.

## Observability

prom-client histogram (`http_request_duration_seconds`) via `metricsMiddleware` in `src/metrics.ts`; new routes are measured automatically. Don't add per-route custom metrics without a task that asks for them.

## Code review guidance

Priorities, ranked:

1. **Normalization leaks.** Any public payload containing `id`, `personId`, `skillId`, or `email` is a hard blocker — normalization stripping these is this repo's entire job.
2. **Sequential upstream calls on an aggregate.** New aggregate endpoints (like the `/cv` route) must fetch sections with `Promise.all`, not sequential `await`s.
3. **Error-mapping drift.** Upstream 404 must pass through as 404; a partial/failed section fetch on an aggregate must map to 502 — not swallowed, not a different code.
4. A new route that bypasses `createApp()`'s central error handler, or a test that hits a running server instead of `createApp()` directly via supertest.

Don't flag:
- CommonJS build output (`tsconfig.build.json` targeting `commonjs`) — deliberate, not a missed ESM migration.
- Missing OpenAPI spec — noted as optional in this repo's stack.

## Git workflow

`master` is protected — feature branch (`feat/…`) → push → PR via `gh`. Definition of done: tests for the new path, `typecheck`/`lint`/`build` green, `.env.example` current.
