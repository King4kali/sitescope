# SiteScope agent team

Read `docs/SPECIFICATION.md` and `docs/CONTRACT.md` before implementation. This is a real audit service: never replace unavailable results with random measurements, hardcoded scores, timers pretending to be progress, or publicly readable artifacts.

## Roles and ownership

The coordinator owns architecture, shared contracts, Prisma migrations, infrastructure and integration. Delegate bounded implementation tasks to Frontend (`apps/web`), Backend (`apps/api`), and Audit Engine (`apps/worker`, `apps/browser`). Use an independent QA/Security review after integration. A DevOps pass covers deployment and recovery. Use at most three implementation agents concurrently so the coordinator retains capacity to integrate; run QA after a slot becomes available. Agents are development collaborators, not background agents installed on GitHub or AI features inside SiteScope.

Each delegated task must state its owned paths, expected behavior, public interfaces, tests, and assumptions. Agents may read the repository but must not overwrite another agent's work. Shared schema/API changes require coordinator approval and updates to CONTRACT.md. Keep root dependencies under one owner; finish installation before changing manifests again.

## Required conventions

- TypeScript strict, Next App Router, Nest with explicit `@Inject` for tsx compatibility, Prisma PostgreSQL and BullMQ Redis.
- Use `@sitescope/core` for untrusted outbound HTTP, URL validation, contracts and private storage. No raw fetch of user-provided URLs.
- A redirect and a browser subresource are new network destinations; validate both. Connect sockets to already validated DNS addresses. Browser processes have no database, SMTP or storage secrets and can reach the public internet only through the egress proxy.
- Preserve the Chromium sandbox; do not add `--no-sandbox`, privileged containers, or host networking to make a test pass.
- All resources require ownership checks. Writes require CSRF protections. Do not log passwords, session tokens or query strings containing secrets.
- Preserve partial results, record errors, use null for unmeasured scores, record versions, keep mobile and desktop independent.
- Queue redelivery must be idempotent. PostgreSQL is authoritative; transactional outbox bridges queue publication.
- Escape audited content in HTML/PDF. Private screenshots and PDF downloads go through authorized endpoints.
- Use clear English interface copy and keep localization possible. No fabricated customer claims or audit data.

## Handoff and validation

Report changed paths, completed behaviors, checks run and unresolved gaps. Run `npm run db:generate`, `npm run typecheck`, `npm test`, `npm run build`. Integration checks require real PostgreSQL/Redis. Review Docker network boundaries and test a real end-to-end audit plus PDF before calling a deployment verified. A passing compilation alone is not a passing audit. Document limits honestly in `docs/VERIFICATION.md`.
