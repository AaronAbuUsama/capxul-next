# frappe-app

The Capxul app that lives on every hosted Frappe site (component `frappe-app`, `blueprint/shared/foundation.ts`). A Frappe
v16 app named `capxul`: no fork of Frappe, ERPNext, Frappe HR or Frappe CRM, every join is a hook.

Moved here from `spikes/skeleton/frappe/capxul` (plan task `m2-graduate-spike`, first slice) without a change of
behaviour; its Python import path and whitelisted method names are the same (`capxul.api.chain_event`, `capxul.door.*`).
The test stack mounts it from here (`spikes/skeleton/frappe/compose.yml`); the production image copies it
(`packages/bench-image`).

| Module | What it does |
|---|---|
| `capxul/setup.py` | install and site-creation setup: wizard, Safe bank account, shipped hat map and CRM link; removes legacy OAuth and editable map metadata |
| `capxul/api.py` | signed chain delivery, durable payment-request collection/answers and scoped Socket.IO listener credentials |
| `capxul/hats.py` | hat events create and change Users and their roles; a hand edit of a role is refused |
| `capxul/payments.py` | a Payment Entry from the Safe is held until the chain confirms; ledger hooks refuse any other credit to the Safe |
| `capxul/reports.py` | native General Ledger adds the persisted Capxul Trace column through Frappe's Report extension hook |
| `capxul/door.py` | the door: whitelisted methods that run a call as the calling person |
| `capxul/features.py` | feature switches (Capxul Feature rows) and the request guard that answers 403 for a part that is off |
| `capxul/brand.py`, `capxul/privacy.py` | the names-only rename and nothing reporting usage outward; run after every migrate once setup is complete |
| `capxul/clock.py`, `capxul/world.py` | the world clock on the site, and a site's names in a restored world |

Spike helpers still here: `testutil.py` and `feature_experiments.py`. The skeleton's fake `/prepare` and OAuth checks describe the superseded outbound boundary, not acceptance for the request outbox below.

## Core boundary

The site never calls Core. `configure_site(slug, company_name, safe_address, admin_email, core_url, secret, ...)` and `world.rewrite(world, core_url, browser_core_url, site)` retain their call signatures; server `core_url` is unused. Configure, migrate and restore remove the legacy `capxul` Social Login Key. Agent calls still use `X-Capxul-Assertion`; human OAuth sign-in is outside slice zero. Restore leaves the scheduler unchanged; the recovery adapter owns final resume.

During explicit restore while writers are paused, nonempty `browser_core_url` rebases the origin of all saved approval links: `Capxul Payment Request.approval_url`, `approval_url` inside nonempty `answer_json`, and `Payment Entry.capxul_approval_url` commit together (`plugs.answer-origin`). Each reference retains its own path, query and fragment; it is never copied from another request on the voucher. Answer serialization remains compatible with exact signed answer retries. Empty browser URL leaves links unchanged, error/unanswered requests stay unchanged, and repeating restore is idempotent. Approval identity, request body/cursor, status, accounting, secret and scheduler state are not rewritten. Ordinary Core restarts must replay the complete saved answer, not regenerate links from the current gateway URL.

Hat roles come directly from `setup.DEFAULT_HAT_ROLES`, not site rows. `hats.map_version()` is the SHA-256 of the shipped map. Migrate removes editable Hat Map/Hat Role DocTypes and reprojects existing grants, removing roles the old mapping gave but no surviving hat grants. Grants record `map_version`; `chain_event` returns it for Core to retain.

Service methods are POSTs under `/api/method/capxul.api.` with `org` in the JSON body, `X-Frappe-Site-Name`, `X-Capxul-Signature` (HMAC-SHA-256 of raw body with the site's secret), and optional `X-Capxul-Trace`. Responses use Frappe's `message` envelope. Wrong signature or organization refuses before applying anything.

- `collect_payment_requests`: `{org, after: 0, limit: 100}` → `{requests, cursor}`. Limit: 1–100. Requests contain `request_id`, `idempotency_key` (same id), integer `cursor`, `trace_id`, `org`, current `site`, `doctype`, `name`, `document_hash`, `requested_by`, `to_party`, `to_address`, `amount`, `asset`, `department`. The body is captured alongside the draft's `Requesting` state; the counter stays locked until commit, so a higher committed cursor cannot skip a lower uncommitted request. Repeated Submit on an open draft/hash returns its existing request. Reads never acknowledge/delete rows. Restore changes only the returned `site`, not durable business identity.
- `answer_payment_request`: `{org, request_id, approval_id, approval_url, requested_by, awaiting?}` or `{org, request_id, error: {code, message}}` → `{request_id, status, duplicate}`. Exact retries succeed; conflicting answers refuse. The draft moves to `Waiting for signature` or a visible failure, never submitted. Old answers cannot replace a newer/edited draft's state or downgrade settlement. A late answer fills the settled approval reference only when its request matches the posted transaction and document hash.
- `payment_request_listener`: `{org}` → `{authorization, namespace, event, expires_at}`. Connect Socket.IO `/<site>` using `Authorization: <authorization>`, `X-Frappe-Site-Name: <site>` and matching Host/Origin. The site-bound `CapxulListener` token expires after 60 host-time seconds; it authenticates only Socket.IO's `frappe.realtime.get_user_info` callback as `capxul-listener@service.invalid`, a Website User with no business roles. It is not an Administrator or customer session. Frappe automatically joins its private user room; no room subscription is needed. Event `capxul_payment_request` carries `{org, cursor}`, after commit only. Core mints anew on reconnect, collects once after connecting, then on hints. Hints are not durable acknowledgements; reconnect catches up after an outage. Advance Core's cursor only after durable prepare and accepted answer, never on hints or collection. No periodic request poll is required.
- `chain_event`: existing `{event_key, seq, org, kind, data}` → `{applied, duplicate, last_seq}`. Applied repeats set `duplicate: true`. Parked events, including repeats, return `parked: true` and `error`, never a successful duplicate. Sequence gaps remain HTTP 409 with `expected`. Only applied/duplicate acknowledgement covering the sent sequence counts as delivery. A parked money error is not reconciled success.
- `retry_parked_event`: `{org, event_key}` → the same acknowledgement. Uses stored facts under the delivery lock, without rewinding the cursor. Money repair must actually post its matching voucher and reconcile any fallback Bank Transaction; failure remains parked with an error and increased attempts. Hat repair reprojects the newest later Applied grant/revocation for the same normalized person, hat and department when it supersedes the parked event, never restoring revoked roles or removing a later regrant. Applied retries are idempotent. Hat acknowledgements persist their applied `map_version`, including duplicates after a release upgrade.

Ordinary later incoming transfers use `deposit_received` with `{amount, asset, tx_hash, block_time, from, to}`. They create one unreconciled Bank Transaction deposit per stable `event_key`, never another founder capital Journal Entry or Shareholder. Distinct logs in one transaction retain separate bank lines; retries preserve those lines without duplicating them.

The pinned bench needs its usual MariaDB, Redis cache/queue, backend, Socket.IO and worker processes. Socket authentication's callback must reach the backend: use a reachable matching Host/Origin, or set bench `webserver_host` and `webserver_port` for a local backend callback; `X-Frappe-Site-Name` carries the tenant. Neither requires a Core URL on the site. A restored clone keeps its encrypted site secret and encryption key; cloned Core uses that same secret and mints assertions with the new site's name.

Purchase Invoice and Payment Entry show their Company even on one-company sites. Payment Entry shows read-only Capxul status and approval URL beside the posting date, including after settlement; signing remains draft-only. General Ledger keeps its native name, filters, permissions and calculations, adding `capxul_trace` from persisted `GL Entry` rows rather than the current request.

Native setup seeds eleven feature switches: accounts, people, projects and CRM on; payroll, WhatsApp, attendance, recruitment, reviews, stock and manufacturing off. Configure/migrate/restore preserve existing feature choices, including explicitly enabled payroll. Migration refreshes caches and user module blocks. The three split HR features also name their DocTypes explicitly because pinned HRMS keeps them in the shared HR module; their document RPCs and lists close without closing Employee, leave, expenses, shared skills or project timesheets. Signed `capxul.service.read_site` reports actual native features, apps, Company, map version and assertion/OAuth configuration, never substitutes expected defaults.

`tests/` holds fast unit tests of the money path that need no site: `frappe` is replaced by a small in-memory fake
(`pnpm frappe:test`, run by `pnpm test`). They cover once-per-payment posting, batch unmatched lines, late approvals, stable collection, idempotent/conflicting answers, tenant/signature refusals and listener scope. A real-stack payment/restart/recovery run is still required to accept slice zero.
