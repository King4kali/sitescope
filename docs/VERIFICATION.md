# Verification record

Updated 2026-10-18. This records executed checks and their limits.

## Verified revision

Application revision: `7f6a8971662e27ad687b28fdf760cd897380787c`.

[GitHub Actions run 39143595001](https://github.com/King4kali/sitescope/actions/runs/39143595001): **both jobs succeeded**.

| Check                                                                     | Result                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Prisma generation and PostgreSQL schema validation                        | Passed                                                                         |
| All workspace TypeScript checks                                           | Passed                                                                         |
| Automated suite                                                           | 35 passed, 0 failed; the separately gated integration test skipped in this job |
| Production builds: core, API, worker, browser and Next.js                 | Passed                                                                         |
| npm dependency audit                                                      | Zero reported vulnerabilities                                                  |
| Full Docker Compose build, migrations, private bucket and service startup | Passed                                                                         |
| Isolated Chromium sandbox and actual PDF preflight                        | Passed; valid PDF, 16,072 bytes                                                |
| Real PostgreSQL/Redis/BullMQ/SMTP/S3 audit scenario                       | 1 passed, 0 failed, 0 skipped                                                  |

## Full-stack acceptance

The real integration scenario verified registration, delivery of verification/reset emails to Mailpit, single-use verification, password reset and session revocation, CSRF rejection, cross-user access denial, concurrent project/active-audit quotas, daily usage limits, transactional outbox and idempotency. It then audited example.com with successful independent mobile/desktop Lighthouse measurements, downloaded both real PNG screenshots, generated and downloaded a real PDF, checked that another user could not download those artifacts, and deleted the disposable accounts and associated data.

The browser container used its nonroot user, Chromium sandbox, custom seccomp profile, read-only root filesystem, dropped host capabilities, resource limits and internal-only networks. External browser traffic passed through the public-address-validating, IP-pinned egress proxy. This confirms a functional run in the tested topology; it is not an exhaustive network penetration test.

## Local and independent checks

- Windows, Node 24.12.0. Docker/PostgreSQL/Redis are not installed on this workstation; the complete stack was verified on GitHub's Ubuntu runner.
- Actual Microsoft Edge development smoke completed mobile/desktop Lighthouse, axe-core, two screenshots and PDF rendering. Production Docker uses matching Playwright/Chromium versions.
- Desktop/mobile landing pages and mobile registration layout/validation were inspected in the browser. Actual interface screenshots are in `docs/screenshots/`.
- Independent QA/Security added ten regression cases for authorization, rate-window separation, outbound IP pinning, redirects, byte budgets and absolute deadlines. A further browser-boundary case verifies that isolated DNS is delegated only to the configured proxy.
- Toolchain overrides: Prisma config uses effect 3.20.0 and deepmerge-ts 8.0.2; Swagger uses js-yaml 5.5.0. Generation, compilation and the dependency audit passed with these overrides.

## Deployment-dependent items

- No public SaaS hosting was provisioned. The GitHub repository and temporary CI stack are separate from a persistent running service.
- Public hosting needs HTTPS ingress, production secrets, real SMTP, backups, storage lifecycle policies and target-host isolation checks. See `DEPLOYMENT.md`.
- CrUX requires an optional API key and eligible real-user data; no key was provided.
- Backup/restore commands are documented; a production-provider restore drill was not executed.
- Screenshot download expiration is enforced by the API. Automatic S3 lifecycle and expired-metadata cleanup must be configured by the hosting operator.
- No p95 latency or load guarantee is claimed. Worker concurrency starts at one and needs load testing on the target host.
- Automated accessibility and header checks do not certify WCAG compliance or complete security.
