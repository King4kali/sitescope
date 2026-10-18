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

`npm test` completed with **34 passed, 0 failed and 1 skipped** at the end of the initial review. The skipped test is the explicitly gated real PostgreSQL/Redis/BullMQ/Chromium integration scenario. The sandbox initially blocked local loopback connections used by the engine backpressure tests; the authorized rerun allowed those local connections and passed. The ten new QA cases also passed independently.

## Follow-up review at 0b8dbc7

The browser boundary now delegates DNS to the configured enforcing HTTP proxy, while retaining URL syntax, literal IP, credentials, protocol and port validation. This is consistent with the supplied Compose topology: browser networks remain internal, Chromium is forced through the proxy with loopback bypass disabled, and the egress service resolves all destination answers, rejects forbidden addresses and connects to the validated address. The browser's lack of direct external DNS is therefore no longer a reason to reject an otherwise allowed hostname. Native execution without a proxy still performs DNS validation. The proxy setting is trusted deployment configuration, not a user request field.

The writable Chromium home is now `/tmp`. This change retains the nonroot `pwuser`, read-only root filesystem, dropped capabilities, seccomp policy, memory/CPU limits and internal network boundaries. It does not introduce a sandbox bypass. Chromium startup diagnostics and a separate sandbox-enabled PDF preflight have been added to CI.

The default Lighthouse context now installs a service-worker registration restriction before page scripts and requests CDP service-worker bypass; screenshot contexts also retain Playwright's explicit service-worker blocking. These are additional source-level controls. They do not replace an adversarial browser-network test.

No concrete new SSRF or Chromium sandbox regression was found in this follow-up review. The browser-boundary regression and all ten QA cases passed together (**11 passed, 0 failed**). The coordinator reported that earlier Docker integration runs exercised authentication, email, ownership and quotas before failing at browser DNS/startup. The complete audit/PDF acceptance scenario was still pending for this revision at review time; partial CI progress must not be presented as an end-to-end pass.

## Subsequent coordinator acceptance evidence

After the independent review, revision `7f6a897` completed [GitHub Actions run 39143595001](https://github.com/King4kali/sitescope/actions/runs/39143595001) successfully. Both the build/test job and the complete Docker integration job passed. The isolated Chromium/PDF preflight and the real mobile/desktop Lighthouse, two PNG downloads and PDF download all succeeded. The seccomp policy explicitly permits Chromium's chroot inside its private user namespace while host capabilities remain dropped. See `VERIFICATION.md` for the final executed checks. This evidence supplements the earlier review; it does not imply an independent penetration test or production deployment signoff.

## Verification limits

Docker is unavailable on the review workstation. The independent source review itself did not execute the complete stack; the subsequent successful CI run supplies the functional acceptance evidence for the tested Ubuntu/Docker environment. Other hosting environments still require their own isolation and startup verification.

Browser service-worker interception and actual outbound network isolation also need verification in the target container environment. The default Lighthouse CDP context and screenshot context are created differently; source inspection alone does not prove that every service-worker-originated request is intercepted. The public-only egress proxy remains an independent SSRF control. A production deployment should test this boundary with controlled public fixtures and must retain the documented browser restrictions.

S3 object lifecycle rules, metadata cleanup and backup restoration are deployment operations documented in `DEPLOYMENT.md`, not completed by a source push. This review is a focused implementation check, not a penetration test or a production security certification.
