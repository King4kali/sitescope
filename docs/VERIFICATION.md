# Verification record

Updated 2026-10-18. This document records executed checks, not guarantees about untested hosting environments.

## Local environment

Windows, Node 24.12.0. Docker/PostgreSQL/Redis are not installed on this host, so full Docker isolation and database/queue integration are exercised by the GitHub Actions integration job rather than claimed as locally verified.

- Prisma PostgreSQL schema generated and initial SQL migration committed.
- API TypeScript build and 11 authentication/authorization/security tests passed.
- Worker/browser TypeScript builds and five extraction/report tests passed.
- Core public URL/IP/DNS-rebinding and private-storage tests passed.
- Frontend TypeScript checks passed; production build and browser QA tracked below.
- Dependency audit: zero reported vulnerabilities after compatible patches and documented transitive overrides. Prisma config uses effect 3.20.0 and deepmerge-ts 8.0.2; Swagger uses js-yaml 5.5.0. Prisma generate/build validate these toolchain overrides.
- Real browser PDF smoke succeeded using installed Microsoft Edge with sandbox enabled; output was a valid PDF of 40,234 bytes. Docker uses a matching Playwright Chromium version instead.

## Full-stack acceptance

The integration test uses a real PostgreSQL, Redis/BullMQ, SMTP/Mailpit, isolated browser runner, validating egress proxy and private object storage. It asserts real registration/verification/reset, session revocation, CSRF and ownership, concurrent quotas, outbox/idempotency, an actual example.com audit, mobile/desktop Lighthouse measurements, two PNG downloads and an authorized PDF. It is skipped unless INTEGRATION_TESTS=1. A skipped test is not a pass.

The CI result is available at https://github.com/King4kali/sitescope/actions. Final run results will be recorded after execution.

## Deployment-dependent items

- No public hosting provisioned. GitHub repository and CI are separate from a running SaaS.
- Real SMTP credentials, HTTPS ingress, production secrets and target-host browser/network isolation need deployment configuration.
- CrUX requires an optional API key and sufficient real-user data. No key was provided.
- Backup commands are documented; a restore drill against a production provider has not been executed.
- A 30-day artifact expiration is enforced at download; automatic bucket lifecycle/metadata cleanup must be configured by the hosting operator.
- No p95 performance/load guarantee is claimed; worker concurrency starts at one and needs load testing on the target host.
