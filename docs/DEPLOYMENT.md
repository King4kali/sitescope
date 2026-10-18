# Deployment and operations

## Local Docker environment

Requirements: Node 22.19+ (24 recommended), Docker Engine with Compose v2, 4 CPU cores, around 6 GB available memory, and support for unprivileged user namespaces in the Linux Docker VM.

1. Copy `.env.example` to `.env` and replace the database and storage passwords. Keep paired POSTGRES_PASSWORD/DATABASE_URL values consistent for native commands. Avoid URL-reserved characters in the database password or URL-encode them in DATABASE_URL.
2. Run `docker compose up --build -d`.
3. Open http://localhost:3000. Test email is captured at http://localhost:8025 (Mailpit). Verify your email to launch an audit.
4. Create a project at a public URL, run an audit, wait for the persisted terminal status, and export a PDF.

`migrate` applies tracked SQL migrations. `storage-init` creates a private bucket. Data survives container restart in named PostgreSQL, Redis and object-storage volumes. Do not run `docker compose down -v` unless all local data may be discarded.

Optional administrator: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) in `.env`, then run `docker compose exec api npm run db:seed`. This creates an administrator without fabricated results. Existing accounts are not silently promoted.

## Native development

Start dependencies with `docker compose up -d db redis storage storage-init mailpit`. Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, and `npm run build -w @sitescope/core`. Then use separate terminals for `npm run dev:api`, `npm run dev:web`, and `npm run dev:worker`. Keep the isolated browser and egress services running via Compose for browser audits. Set BROWSER_RUNNER_URL to an address reachable from the worker; the default Compose runner is deliberately not published to the host. For full audits use the worker in Compose. Do not publish the browser endpoint to the internet.

## Public hosting

GitHub stores the source and runs CI. GitHub Pages cannot run this stack. Deploy the web, API, PostgreSQL, Redis, S3 storage, SMTP and worker/browser services to infrastructure capable of running containers, such as your own Linux server or a suitable container platform.

The included Compose configuration binds exposed ports to 127.0.0.1 and is a local development configuration. Before public deployment:

- Put a TLS reverse proxy in front of the web service, set WEB_ORIGIN to the exact HTTPS origin, and run the API with NODE_ENV=production for Secure session cookies. Configure TRUST_PROXY_HOPS to the actual trusted proxy topology.
- Use strong independent secrets and managed/private databases and buckets. Replace Mailpit with an SMTP provider. Keep all service/admin ports private.
- Retain browser internal-only networks, the validated egress proxy, seccomp and Chromium sandbox, nonroot execution, memory/CPU/request limits. Verify that the host supports user namespaces; do not disable the sandbox to work around an incompatible host.
- Validate isolation against DNS rebinding, redirects, IPv6 and browser subresources in the target environment. Keep browser/runtime dependencies patched.
- Configure database backups, object retention, storage lifecycle and observability before admitting untrusted users. Start with one audit worker and measure resources before increasing concurrency.

Full compliance with the specification's security requirements depends on the target infrastructure as well as application checks. No public production deployment is created by pushing the repository.

## Backup and restore

Create a PostgreSQL backup: `docker compose exec -T db pg_dump -U sitescope -Fc sitescope > sitescope.dump` (use the configured username/database). Back up private object storage separately using S3-compatible tooling and protect backups. Restore into a separate test environment with `pg_restore`; verify registration, project history and at least one artifact download. Record restore results before relying on backups.

S3 artifacts have expiresAt metadata and a default 30-day retention in the worker. Configure matching object lifecycle policies and a scheduled metadata cleanup for the deployment. Expired images are denied by the API; database rows should not be treated as proof that bytes still exist.

## Diagnostics

- `docker compose logs api worker browser egress`
- API `/api/v1/health/live` and `/api/v1/health/ready`
- API docs `/api/docs` on the API origin
- Admin dashboard for queue counts, failures, durations, storage and service health

Logs intentionally omit tokens and untrusted URL query strings. A failed/partial module is visible in the report and should be investigated by error code and audit ID.
