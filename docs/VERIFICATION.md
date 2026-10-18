# Verification record

Updated 2026-10-18. This document records executed checks, not guarantees about untested hosting environments.

## Local environment

Windows, Node 24.12.0. Docker/PostgreSQL/Redis are not installed on this host, so full Docker isolation and database/queue integration are exercised by the GitHub Actions integration job rather than claimed as locally verified.

- Prisma PostgreSQL schema generated and initial SQL migration committed.
- API TypeScript build and 11 authentication/authorization/security tests passed.
- Worker/browser TypeScript builds and eight extraction/report/backpressure tests passed.
- Core public URL/IP/DNS-rebinding and private-storage tests passed.
- Full frontend production build passed using the documented webpack path. Browser QA confirmed the desktop landing, mobile landing, registration layout and field validation. Actual screenshots are in docs/screenshots.
- Dependency audit: zero reported vulnerabilities after compatible patches and documented transitive overrides. Prisma config uses effect 3.20.0 and deepmerge-ts 8.0.2; Swagger uses js-yaml 5.5.0. Prisma generate/build validate these toolchain overrides.
- Real browser PDF smoke succeeded using installed Microsoft Edge with sandbox enabled; output was a valid PDF of 40,234 bytes. Docker uses a matching Playwright Chromium version instead.
- Real example.com mobile/desktop Lighthouse, axe-core and two screenshots completed through the development runner. This does not substitute for the isolated Docker check.
- Final local suite: 34 passed, zero failed, one gated real-stack integration test skipped. Ten cases were added by the independent QA/Security agent.

## Full-stack acceptance

The integration test uses a real PostgreSQL, Redis/BullMQ, SMTP/Mailpit, isolated browser runner, validating egress proxy and private object storage. It asserts real registration/verification/reset, session revocation, CSRF and ownership, concurrent quotas, outbox/idempotency, an actual example.com audit, mobile/desktop Lighthouse measurements, two PNG downloads and an authorized PDF. It is skipped unless INTEGRATION_TESTS=1. A skipped test is not a pass.

The CI result is available at https://github.com/King4kali/sitescope/actions. Ubuntu types, tests, Prisma validation, production builds and dependency audit passed. The first Compose run identified an unavailable MinIO image; the development stack now uses the official S3-compatible RustFS 1.0.3 image and a native AWS SDK bucket initializer. Final full-stack run results will be recorded after execution.

## Deployment-dependent items

- No public hosting provisioned. GitHub repository and CI are separate from a running SaaS.
- Real SMTP credentials, HTTPS ingress, production secrets and target-host browser/network isolation need deployment configuration.
- CrUX requires an optional API key and sufficient real-user data. No key was provided.
- Backup commands are documented; a restore drill against a production provider has not been executed.
- A 30-day artifact expiration is enforced at download; automatic bucket lifecycle/metadata cleanup must be configured by the hosting operator.
- No p95 performance/load guarantee is claimed; worker concurrency starts at one and needs load testing on the target host.
