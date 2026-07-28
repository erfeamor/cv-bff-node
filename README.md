# cv-bff-node

Backend-for-Frontend for [cv-public-vanilla](../cv-public-vanilla): aggregates and normalizes data from [cv-domain-service](../cv-domain-service) for the public site's consumption.

Part of the [cv-project](../README.md) multi-repo. Pipeline: GitHub Actions.

## Stack

- Node.js 20 + Express, **TypeScript** (strict, compiled to CommonJS)
- express-jwt / jwks-rsa (validates AWS Cognito JWTs, propagates claims downstream)
- prom-client (`/metrics`)
- Jest + Supertest via ts-jest (TDD)

## Local development

```bash
cp .env.example .env      # point at your cv-domain-service instance
npm install
npm run dev                 # start on :3000 with reload (tsx watch)
npm test                    # run the test suite
npm run typecheck           # tsc --noEmit
npm run build               # compile to dist/ (npm start runs dist/index.js)
```

## Endpoints

- `GET /health`
- `GET /metrics` — Prometheus exposition format
- `GET /api/v1/people/:id` — normalized person payload sourced from `cv-domain-service`
