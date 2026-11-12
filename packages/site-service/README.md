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

## Document door and durable lifecycle

`createDocumentHandler({publicOrigin,coreUrl,coreSecret,provider,store,requestAnswer})` mounts `POST /org/site/document` before Core consumes the body, inside its snapshot pause/drain boundary. There is no second public server. The SDK's `createDocumentClient({coreUrl,account})` exposes `create`, `get`, `submit` and `report`. The matching CLI is `doc create`, `doc get`, `doc submit`, `report run`, using `CAPXUL_CORE_URL` and the caller's `CAPXUL_PRIVATE_KEY`; `--help` lists the fields, filters and retry options. It accepts no impersonated email or bench credential.

The caller signs `Capxul document door\n<configured origin>\nPOST /org/site/document\n<raw JSON>` with EIP-191. The body carries `verb`, `orgId`, `caller`, an expiry within 60 seconds, and the operation input. Core resolves the recovered address to its registered person; the provider sends only that person's signed Frappe assertion. Native permissions, validations and feature switches remain authoritative. Normal results are `{doctype,name,docstatus,fields}` or reports `{columns,rows}`. Input/state, unauthenticated, permission, provider and feature-off failures exit 2, 3, 4, 5 and 6 respectively.

Create and submit require a stable `callId` (`--call-id`; generated when omitted). A private Capxul Door Call receipt commits with the mutation in the site's MariaDB transaction. Replays recheck current permissions; another person or changed input cannot reuse the receipt. Core keeps only identity/outcome metadata in `app.door_calls`, never document fields. A failed response tells the CLI caller which call ID to retain.

A Safe submit returns only a stable site request. `requestAnswer({org,request_id,requested_by})` is an injected Effect backed by approvals' **committed** same-Postgres lookup, not another endpoint. It returns `collecting`, `refused` with a typed error, or `answered` with `approval_id`, `approval_url`, `requested_by` and the actual `awaiting` signer address. Only the last case produces `{held:true,requestId,approvalId,awaiting}`. The requesting person must match the authenticated directory identity. A missing answer remains retryable; a site status, approval row or URL alone cannot produce a held result.

The migration owner calls `migrateSites(sql)` inside Core's migration transaction after its schema/roles exist. Construct `SitesStore(database,record,worldNow)` with Core's existing transaction, timestamp-aware event writer and canonical world clock. `worldNow(sql)` is required and runs on that same tenant transaction; there is no host-time fallback. The writer receives `(sql,org,kind,trace,data,at)` with the exact instant used for the row. Sites, features and calls force RLS even for the worker; the narrow worker-only `app.site_by_host(text)` lookup returns just organization/site IDs across tenants. The maintained backend platform door exports its Database, record and Sql integration surface.

Supply `lifecycle:{world,bench,store,readSite}` to the provisioning handler to record creating/default features before the bench call. The optional field preserves the existing narrow provisioner API; the composed selected stack must supply it. `readSite` is the typed provider's actual observation of Company, six installed apps, app/map versions, default features and configured assertion sign-in without legacy OAuth. Ready additionally requires released and fully acknowledged initial events. Inspection or delivery failure is persisted, and the same company can retry. This is configured programmatic readiness, not proof of human browser sign-in.

The recovery owner calls `rewriteSites(sql,{world,bench,sites})` only inside its stopped restore transaction, using the same migration-authority connection as Core's offline rewrite. `sites` maps every saved organization to its target host. Missing, extra or duplicate mappings refuse before writes. Only host, world and bench routing change: lifecycle state, versions, timestamps, features, calls and the saved event cut remain intact. This hook never migrates or marks a site ready; create is the only schema migration path.

`CAPXUL_SITES_PG_TEST=1` enables the disposable native Postgres store/RLS/atomic-event test using the local admin/tenant/worker URLs. Its clock controls check frozen/advanced instants, unchanged replay and rollback without an authority. Set `CAPXUL_SITES_NATIVE_FEATURES` to a JSON file captured from actual `capxul.features.state` fresh-default output and `CAPXUL_SITES_NATIVE_DRIFT_FEATURES` to the preserved preexisting payroll-on output. These exercise readiness and drift refusal against native observations rather than the unit fixture; they must remain distinct controls. `bench --site SITE execute capxul.tests.product_door.run` exercises native ERPNext mutation receipts, ledger submission, permissions, reports and the annotation Account resolver on a disposable site. These are component tests; neither scores the 82 nonfloor claims or a composed journey.
