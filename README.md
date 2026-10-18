# SiteScope

**Know what your website is really doing.** A full-stack website audit SaaS built with Next.js, NestJS, PostgreSQL, Redis and isolated browser workers.

[![SiteScope CI](https://github.com/King4kali/sitescope/actions/workflows/ci.yml/badge.svg)](https://github.com/King4kali/sitescope/actions/workflows/ci.yml)

SiteScope turns a public URL into a saved technical report: real mobile/desktop Lighthouse measurements, SEO findings, broken links, automated accessibility checks, TLS/response headers, screenshots and a downloadable PDF. Checks run in a background worker; failures remain explicit and partial results survive.

## Run locally

```sh
git clone https://github.com/King4kali/sitescope.git
cd sitescope
cp .env.example .env
# Edit .env: replace database and storage passwords.
docker compose up --build -d
```

Open **http://localhost:3000**. Register, open the verification email in **http://localhost:8025**, create a project with a public URL and run an audit. In PowerShell use `Copy-Item .env.example .env` instead of `cp` if preferred. Requirements: Docker Compose v2, 4 CPU cores and about 6 GB available memory. Node 24 is recommended for native development.

The Compose environment is local-only. A GitHub repository does not itself host the API or browser workers. See [deployment instructions](docs/DEPLOYMENT.md) before public hosting.

## Features

- Email/password registration, Argon2id hashes, verified email, password recovery and opaque revocable sessions.
- Private projects and history, real stage progress over SSE, re-runs and side-by-side comparisons.
- Independent mobile and desktop Lighthouse runs; FCP, LCP, CLS, TBT and Speed Index.
- Bounded SEO crawling (5 HTML pages), links (30), robots policy, time and byte budgets.
- Real HTTP status/redirect evidence, TLS certificate and response-header checks.
- axe-core checks and mobile/desktop PNG screenshots in private object storage.
- Escaped HTML-to-PDF reports including failed checks and factual measurements.
- Configurable per-user quotas, transactional outbox, idempotent jobs and hostname leases.
- Responsive light/dark UI, localization structure, user settings and administrator operations view.
- Optional CrUX field data when a key and eligible data exist; unavailable data is explicitly marked.

This is technical auditing, not a penetration test, a Google ranking guarantee, or WCAG certification. There is no fake audit dataset. Missing measurements have no score.

## Repository

```text
apps/web        Next.js App Router interface and streaming API proxy
apps/api        NestJS authorization, projects, audits, exports and administration
apps/worker     BullMQ audit and report processors
apps/browser    Isolated Lighthouse/Playwright/axe and PDF runner
packages/core   Shared contracts, IP-pinned safe networking and private storage
prisma          PostgreSQL schema, SQL migrations and optional admin seed
infra           Container images, restricted egress proxy and seccomp profile
tests           Rules, security, storage and real-stack integration tests
```

## Development agents

The implementation is divided between **Frontend**, **Backend**, **Audit Engine**, **QA/Security**, and **Coordinator/DevOps** roles. Their responsibilities, shared contracts and rules are preserved in [AGENTS.md](AGENTS.md) and [architecture](docs/ARCHITECTURE.md). These are coding-agent roles; starting SiteScope does not launch paid AI agents, and no AI key is needed for the MVP.

## Validation

```sh
npm ci
npm run db:generate
npm run typecheck
npm test
npm run build
```

For the real integration suite, start the full Compose stack and run `INTEGRATION_TESTS=1 npm run test:integration` (PowerShell: `$env:INTEGRATION_TESTS='1'; npm run test:integration`). It exercises actual email delivery, database transactions, authentication, cross-user access control, quota races, background audits, Lighthouse, screenshots and PDF downloads. It uses disposable users in the configured database; run against a test environment. GitHub Actions includes both build checks and this full stack scenario.

See [verification record](docs/VERIFICATION.md) for what was actually checked, [specification](docs/SPECIFICATION.md) for acceptance criteria, [API contract](docs/CONTRACT.md), and [deployment and operations](docs/DEPLOYMENT.md) for hosting, isolation and backups.
