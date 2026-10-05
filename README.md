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
- `GET /bff/api/v1/people/:id` — normalized person payload sourced from `cv-domain-service`

API routes are served under the `/bff/api/v1` base path (`docs/api-contract.md` § BFF): the
edge routes `/bff/*` here and `/api/*` to `cv-domain-service`, without stripping the prefix,
so URLs are identical locally and in AWS. `/health` and `/metrics` stay at the app root.

## Deploy

Deploys are automatic on a **push to `master`** (never on PRs — the `deploy` job's own `if:`
in `.github/workflows/ci.yml` gates it):

1. `test` (lint, typecheck, test, build) and `docker` (image builds) must both pass.
2. `deploy` assumes the AWS deploy role via **GitHub OIDC** (no stored AWS keys), logs in to
   ECR, and builds a **multi-arch** image (`linux/amd64,linux/arm64`; the app host is
   Graviton) with QEMU + buildx.
3. The image is pushed to `760904708057.dkr.ecr.eu-west-3.amazonaws.com/cv-project-bff-node`
   as `:latest` and as the immutable `:<commit sha>` (label `org.opencontainers.image.revision`).
4. An SSM Run Command with the document `cv-redeploy-bff-node` (runs only
   `cv-redeploy bff-node`) targets the app host **by tag** `Name=cv-project-domain-service`
   — no instance id is stored, since the host is replaced often. The job waits (bounded, 5 min)
   for exactly one invocation, prints the tail of its output (`bff-node image: old=… new=…`),
   and fails unless its status is `Success`.
5. A smoke test retries `GET https://dvdlxl0zqepqi.cloudfront.net/bff/api/v1/people/1/cv`
   (6 × ~10 s) and fails the job unless it returns HTTP 200.

Deploys are serialized (`concurrency: cv-bff-node-deploy`, queued, never cancelled).

**Repository variable** (Settings → Secrets and variables → Actions → Variables):

- `AWS_DEPLOY_ROLE_ARN` — the OIDC deploy role from `cv-infra` (trusted only for this repo's
  `master`). The job fails up front if it is empty.

**Rollback:** point `:latest` back at a previous commit's image and re-roll, e.g.

```bash
MANIFEST=$(aws ecr batch-get-image --region eu-west-3 --repository-name cv-project-bff-node \
  --image-ids imageTag=<previous-sha> --query 'images[0].imageManifest' --output text)
aws ecr put-image --region eu-west-3 --repository-name cv-project-bff-node \
  --image-tag latest --image-manifest "$MANIFEST"
aws ssm send-command --region eu-west-3 --document-name cv-redeploy-bff-node \
  --targets Key=tag:Name,Values=cv-project-domain-service --comment "cv-bff-node rollback"
```

or revert the commit on `master` (which redeploys through the pipeline), or follow the
`cv-infra` runbook (`cv-redeploy`).
