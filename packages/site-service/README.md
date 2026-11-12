# Site service

The narrow bench-host service for slice-zero site creation, plus the backend handler that calls it. It does not mint companies, sign payments, or implement snapshots. Recovery is owned by `packages/devnet`.

## Boundaries

1. The v4 company fixture mints and installs the company, then registers `{slug,name,safe,site,adminEmail,token,hats,people}` through Core's private `/admin/org`. People contain addresses, never keys. Registration is unreleased. `site` must equal `<slug>-<world>.<base>`.
2. The public SDK `createSitesClient({coreUrl,account}).provision({org})` or the one CLI's `org site provision --org <slug> --confirm --json` signs an origin-bound, 60-second EIP-191 request. It needs only the founder's signer, not operator credentials.
3. Core mounts `createProvisioningHandler(options)` **before reading the body**. It returns `(req: IncomingMessage, res: ServerResponse) => Promise<boolean>`; `false` means another route. Options are `{publicOrigin,rpcUrl,coreUrl,coreSecret,siteServiceUrl,siteServiceToken}`. `publicOrigin` is the exact origin used by the SDK; do not derive it from an untrusted Host header. `coreSecret` is Core's `CAPXUL_SECRET`.
4. The handler reads signed `/admin/org-info`, checks the registered founder and current Safe→personal Safe→key ownership on the chain, calls private `/sites/create`, verifies the result against Core's registered site/Safe, and only then calls `/admin/release`. Core independently verifies Ponder company-birth provenance before delivery.
5. The service persists immutable creation intent before running bench. The same identity resumes; changed company name, Safe or founder refuses. Concurrent requests coalesce and different sites serialize. The returned state is **provisioned**, not **ready**: first-event delivery and UI acceptance remain separate checks.

Only this service holds the bench command, database password, Administrator password and service token. Caller strings are passed as individual process arguments; no caller text becomes shell source. Service failures do not return subprocess output or credentials. No Core-reachable URL is needed by the site: `configure_site` receives the compatibility value `core_url: ""`.

## Running privately

`pnpm --filter @capxul/site-service start` binds loopback port 8788 (`PORT` overrides it). Run under the orb supervisor, never expose it through a portal. `GET /health` is a liveness check. `POST /sites/create` requires `Authorization: Bearer <SITE_SERVICE_TOKEN>` and `{org,name,safe,adminEmail}`.

SIGINT and SIGTERM stop new connections and wait for accepted creation work and responses to finish before exiting with code 0. The entrypoint does not force an early process exit; the supervisor can wait for that clean stop before taking a snapshot.

Required environment:

- `SITE_SERVICE_TOKEN`, `CAPXUL_SECRET`: private backend/service credentials.
- `SITE_SERVICE_STATE_DIR`: host-local durable intent directory, included in whole-world recovery.
- `CAPXUL_WORLD`: lowercase alphanumeric world, without hyphens.
- `SITE_BASE_DOMAIN`: the site's DNS suffix; `SITE_SCHEME=http` and `SITE_PORT=8000` for the orb.
- `BENCH_DB_ROOT_PASSWORD`, `CAPXUL_ADMIN_PASSWORD`: bench-only credentials.
- `BENCH_COMMAND_JSON`: fixed deployment-owned argv prefix invoking bench. For the pinned orb image, the bootstrap owner supplies `["/home/user/.local/bin/docker","compose","-f","/home/user/workspace/repo/packages/devnet/orb/compose.yaml","-p","capxul-skeleton","exec","-T","--user","frappe","bench","bench"]`. This prefix is configuration, not a shell command.

The image must already contain Frappe, ERPNext, HRMS, CRM, WhatsApp and Capxul. Creation installs those apps without downloading anything, configures Company/Safe/privacy/features, joins the world's saved clock, clears caches, and checks the site's company/Safe readback. It never accepts an arbitrary hostname or executable from a caller.

## Checks and delivery scope

`pnpm --filter @capxul/site-service test` runs real HTTP, EIP-191 signing and child processes with isolated Core/RPC/bench fixtures. It checks CLI and SDK, interrupted retry, duplicate concurrency, service restart, immutable identity and authority/refusal controls. It is **not** a Postgres/Ponder/Frappe acceptance run. The integrated slice-zero runner must register its real chain fixture, invoke this public CLI, verify Frappe source values and wait for Core delivery. The old skeleton CLI remains only as a comparison fixture, not the selected-stack entry point.
