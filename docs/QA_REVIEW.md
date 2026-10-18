# Independent QA and security review

Review date: 18 October 2026. Scope: the initial SiteScope implementation, against `SPECIFICATION.md` and `CONTRACT.md`.

## Findings addressed during review

1. **P1 — a shared frontend IP also shared every user's rate window.** The Next API proxy removes untrusted forwarding headers, so the backend sees its shared IP. A small number of login attempts could previously prevent all other users from logging in. The API now uses normalized account, session and token digests for ordinary limits, plus a separate generous network ceiling. Regression tests prove independent sessions/accounts behind one proxy, normalized email identity, token hashing and the remaining shared anonymous ceiling. Client forwarding headers are not promoted to trusted identity.
2. **P2 — PDF generation and auditing competed for one busy browser.** A normal concurrent PDF export could previously make a new audit permanently partial when the browser returned 429. The worker now uses a bounded, cancellable browser client for backpressure. Separate engine tests exercise actual local HTTP 429/503 responses and cancellation.
3. **Deployment compatibility — modern glibc clone3 fallback.** The custom Chromium seccomp profile lacked an explicit `clone3` fallback. The coordinator added an `ENOSYS` response so glibc can use the permitted `clone` syscall. This change was inspected; a real Linux container launch remains a separate integration check.

## Checks performed

- Reviewed ownership checks for projects, audits, findings, screenshots, reports and exports; session expiration/revocation; administrator routes; CSRF checks; authentication token storage and consumption.
- Reviewed database locking for project/daily/active audit limits, transactional outbox publication, queue redelivery, reconciliation, hostname locks and partial-result persistence.
- Reviewed URL parsing, reserved address handling, per-connection DNS checks, pinned destination sockets, redirect validation, declared and streamed response limits, and absolute request deadlines.
- Reviewed HTML/PDF escaping, object key validation, artifact ownership/expiry, data deletion with active work and private object delivery.
- Reviewed Compose browser boundaries: no published runner port, no browser database/mail/storage credentials, internal browser networks, public-only egress proxy, nonroot execution, Chromium sandbox and resource limits. Compose is documented for local development; public deployment requires the documented TLS, secrets and infrastructure configuration.

Added ten focused regression cases in `tests/qa.api.test.ts` and `tests/qa.safety.test.ts`. Safety tests mock transport to verify the exact connected address and the absence of a second socket on an unsafe redirect; they do not claim to be a live DNS rebinding penetration test.

`npm test` completed with **34 passed, 0 failed and 1 skipped** at the end of this review. The skipped test is the explicitly gated real PostgreSQL/Redis/BullMQ/Chromium integration scenario. The sandbox initially blocked local loopback connections used by the engine backpressure tests; the authorized rerun allowed those local connections and passed. The ten new QA cases also passed independently.

## Verification limits

Docker is unavailable on the review workstation. This review does not establish that the complete Compose stack starts, that Chromium's sandbox works on the target Linux host, that live mobile/desktop Lighthouse measurements succeed, or that real PDF rendering, SMTP and S3 operations succeed together. The Docker integration workflow must complete before those acceptance criteria are called verified.

Browser service-worker interception and actual outbound network isolation also need verification in the target container environment. The default Lighthouse CDP context and screenshot context are created differently; source inspection alone does not prove that every service-worker-originated request is intercepted. The public-only egress proxy remains an independent SSRF control. A production deployment should test this boundary with controlled public fixtures and must retain the documented browser restrictions.

S3 object lifecycle rules, metadata cleanup and backup restoration are deployment operations documented in `DEPLOYMENT.md`, not completed by a source push. This review is a focused implementation check, not a penetration test or a production security certification.
