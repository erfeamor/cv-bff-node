# CLAUDE.md — cv-bff-node

Backend-for-Frontend for the public site: Node 20 + Express (CommonJS). Aggregates and **normalizes** data from cv-domain-service for `cv-public-vanilla`. Read-only by design — mutations belong to the domain API. Cross-repo context: meta repo CLAUDE.md one directory up.

## Commands

```bash
npm install
npm test                   # Jest + Supertest
npm run lint               # eslint
npm run dev                # :3000 with --watch (cp .env.example .env first)
docker build -t cv-bff-node .
```

CI: `.github/workflows/ci.yml` (lint → test → docker image).

## Architecture & conventions

- **`createApp()` factory** in `src/app.js` (no `listen`) so tests build fresh instances; `src/index.js` is the only place that listens. Keep it that way.
- Routes in `src/routes/`, cross-cutting middleware in `src/middleware/`. Upstream calls use global `fetch` (Node ≥18) — no axios.
- **Normalization is the product**: public payloads never expose internal `id`s or `email`; field names are public-friendly (`fullName` → `name`). See `normalize()` in `src/routes/people.js`. New endpoints follow the API contract in the meta repo (`docs/api-contract.md`).
- Error mapping: upstream 404 passes through; upstream/partial failures on aggregates → 502; JWT failures → 401 (handled centrally in `app.js`).
- Tests mock `global.fetch` (see `test/people.test.js` for the pattern, including `afterEach` restore). Supertest against `createApp()` — never against a running server.

## Auth & config

`AUTH_ENABLED=true` mounts Cognito JWT validation (`src/middleware/auth.js`, jwks-rsa) on `/api/v1/*`; **default is off** for local dev. `/health` and `/metrics` are always public. Config via env only: `PORT`, `DOMAIN_SERVICE_URL`, `CORS_ALLOWED_ORIGINS`, `COGNITO_ISSUER_URI` — document new vars in `.env.example` in the same PR.

## Observability

prom-client histogram (`http_request_duration_seconds`) via `metricsMiddleware`; new routes are measured automatically. Don't add per-route custom metrics without a task that asks for them.

## Git workflow

`master` is protected — feature branch (`feat/…`) → push → PR via `gh`. Definition of done: tests for the new path, lint clean, `.env.example` current.
