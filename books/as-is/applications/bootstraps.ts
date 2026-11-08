// The as-is book of the old applications concept: the bootstraps area.
//
// `POST /v1/client/bootstrap` (`resolve`) and its CORS preflight (`OPTIONS`, `preflight`) are HTTP actions
// routed in packages/backend/convex/http.ts:93; they have no protocol row, so their ids are their
// operation catalog names (packages/observability/src/operations/applications.ts:9). `admitKey` and
// `recordUse` are the internal query and mutation `resolve` runs through `ctx.runQuery` and
// `ctx.runMutation` in the same call. Nothing here is scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_UNKNOWN,
  event_bootstrap_failed,
  event_bootstrap_resolved,
} from "../shared/vocabulary.ts";
import { table_developer_applications, table_publishable_keys } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/applications/bootstraps.ts`;
const HTTP = `${BACKEND}/convex/http.ts`;
const A = `${BACKEND}/src/applications`;
const BS = `${A}/bootstraps`;
const OPS = `${BS}/operations`;

/** `keyResolution` (bootstraps/views.ts:21): the admitted key's identity and the metadata it serves. */
const KeyResolution = Schema.Struct({
  keyId: Schema.String,
  applicationId: Schema.String,
  environment: Schema.Literals(["test", "live"]),
  authBaseUrl: Schema.String,
  convexUrl: Schema.String,
  siteBaseUrl: Schema.String,
  openfortPublishableKey: Schema.String,
  shieldPublishableKey: Schema.String,
});

/** `requireActiveKey` and `requireAllowedOrigin` (bootstraps/guards.ts:13, :20). */
const ADMIT_WAS = [
  `${BS}/guards.ts:13`,
  `${BS}/guards.ts:20`,
  `${BS}/errors.ts:16`,
  `${BS}/errors.ts:29`,
  `${BS}/rules.ts:66`,
  `${A}/rules.ts:24`,
  `${A}/rules.ts:93`,
  `${A}/rules.ts:51`,
];

/** markResolved (bootstraps/writes.ts:22): the key's minute window and its last-use stamp. */
const USE_WAS = [`${BS}/writes.ts:22`, `${BS}/rules.ts:16`, `${BS}/rules.ts:25`, `${BS}/rules.ts:46`, "packages/protocol/src/applications/policy.ts:5"];

export const rpc_applications_bootstraps_resolve = defineRpc({
  id: "applications.bootstraps.resolve",
  title: "Resolve a publishable key into a bootstrap envelope",
  about:
    "`POST /v1/client/bootstrap`, an HTTP action with no session. It runs as the system job `client_bootstrap` under " +
    "the caller's trace. The body must be one JSON object (INVALID_INPUT `body`) with a string `publishableKey` " +
    "(INVALID_INPUT). It runs admit-key (the key by its hash, active, and the request's `Origin` allowed when one is " +
    "sent; NOT_AUTHENTICATED otherwise, with a `next` command), then record-use: the key's 61st bootstrap inside its " +
    "minute refuses RATE_LIMITED (429 with `Retry-After`). It encodes the `capxul.bootstrap` v1 envelope: a fresh " +
    "`bsk_` session token nothing stores or checks, a 300 s lifetime, chain 8453 for a live key or 84532 for a test " +
    "key, the key's stored backend URL and vendor keys, the Origin plus `/api/auth` as authBaseUrl when an Origin was " +
    "sent (else the stored one), and always this request's own origin as siteBaseUrl, never the stored one; plus INDEXER_URL, the " +
    "Safe salt namespace, Companies House v4 and the engineering telemetry policy from this deployment's settings. A " +
    "stored identity that does not encode is UNKNOWN (500). It queues `bootstrap_resolved` or `bootstrap_failed` " +
    "(`reason` the code) and its wide event into one delivery scheduled after the response. A failure answers its " +
    "public projection as JSON with CORS for an http(s) Origin: INVALID_INPUT 400, NOT_AUTHENTICATED 401, " +
    "ROLE_PERMISSION_DENIED 403, RATE_LIMITED 429, anything else 500. The bootstrap grants neither application consent " +
    "nor Organization authority.",
  was: [
    `${HTTP}:103`,
    `${CONVEX}:8`,
    `${OPS}/resolve.ts:39`,
    `${OPS}/resolve.ts:43`,
    `${OPS}/resolve.ts:51`,
    `${OPS}/resolve.ts:52`,
    `${OPS}/resolve.ts:53`,
    `${OPS}/resolve.ts:54`,
    `${OPS}/resolve.ts:59`,
    `${OPS}/resolve.ts:77`,
    `${OPS}/resolve.ts:80`,
    `${BS}/reads.ts:10`,
    `${BS}/writes.ts:47`,
    `${BS}/rules.ts:10`,
    `${BS}/rules.ts:53`,
    `${BS}/views.ts:18`,
    `${BS}/views.ts:37`,
    `${BS}/views.ts:68`,
    `${BS}/events.ts:12`,
    `${BS}/events.ts:34`,
    `${BS}/errors.ts:22`,
    `${BS}/errors.ts:40`,
    `${A}/reads.ts:146`,
    `${A}/views.ts:11`,
    `${A}/views.ts:56`,
    ...ADMIT_WAS,
    ...USE_WAS,
  ],
  concept: concept_applications,
  kind: "action",
  who: "Anyone holding a publishable key: a browser (its Origin checked against the key) or a Node host (no Origin, no check).",
  input: Schema.Struct({ publishableKey: Schema.String }),
  output: Schema.Struct({
    protocol: Schema.Literal("capxul.bootstrap"),
    version: Schema.Literal(1),
    /** `BootstrapEnvelope` state (protocol access/bootstrap-schema): ids, URLs, vendor keys and policy; too deep to transcribe. */
    state: Schema.Unknown,
  }),
  errors: [error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_RATE_LIMITED, error_UNKNOWN],
  reads: [table_publishable_keys, table_developer_applications],
  writes: [table_publishable_keys],
  drives: [],
  invokes: [],
  emits: [event_bootstrap_resolved, event_bootstrap_failed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_bootstraps_preflight = defineRpc({
  id: "applications.bootstraps.preflight",
  title: "Answer the bootstrap's CORS preflight",
  about:
    "`OPTIONS /v1/client/bootstrap`: 204 with `Access-Control-Max-Age: 600`, and CORS for the calling origin when it is " +
    "http(s) (methods POST and OPTIONS; headers content-type, origin and the observation context header). Any origin " +
    "is answered: the origin check is the key's, at resolve. Wrapped in `observedRoute` as the system job " +
    "`cors_preflight`, so it leaves one backend row. Reads and writes nothing.",
  was: [`${HTTP}:93`, `${CONVEX}:6`, `${OPS}/preflight.ts:6`, `${A}/views.ts:28`, `${A}/views.ts:43`],
  concept: concept_applications,
  kind: "action",
  who: "Anyone: a browser's preflight before the bootstrap POST.",
  input: Schema.Struct({}),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_bootstraps_admit_key = defineRpc({
  id: "applications.bootstraps.admit-key",
  title: "Admit a presented key for its origin",
  about:
    "The internal query `applications/bootstraps:admitKey`. Hashes the trimmed key (empty: INVALID_INPUT), reads the " +
    "key by its hash and refuses NOT_AUTHENTICATED with `reason` `unknown` (no row), `revoked` or `expired` (grace " +
    "passed) and `next: capxul key create`. With an origin, the key's own `allowedOrigins` must hold it, compared as " +
    "`protocol//host`; otherwise it reads the key's application and refuses NOT_AUTHENTICATED " +
    "`origin-not-allowed` with a shell-quoted `capxul key create --app … --origin …` command that repeats the key's " +
    "origins, adds this one and names the Organization. It does not check that the application is archived. Answers " +
    "the key's resolution, never the key.",
  was: [`${CONVEX}:5`, `${OPS}/admit-key.ts:14`, `${OPS}/admit-key.ts:21`, `${A}/reads.ts:98`, `${BS}/views.ts:21`, ...ADMIT_WAS],
  concept: concept_applications,
  kind: "query",
  who: "internal: run by applications.bootstraps.resolve (`admit`, bootstraps/reads.ts:10), admitting only NOT_AUTHENTICATED and INVALID_INPUT.",
  input: Schema.Struct({ publishableKey: Schema.String, origin: Schema.optionalKey(Schema.String) }),
  output: KeyResolution,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_publishable_keys, table_developer_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_bootstraps_record_use = defineRpc({
  id: "applications.bootstraps.record-use",
  title: "Count a bootstrap against its key's minute and stamp its use",
  about:
    "The internal mutation `applications/bootstraps:recordUse`. A key deleted since admission counts nothing and " +
    "answers allowed. A fixed 60 s window per key admits 60 bootstraps (`BOOTSTRAP_RATE_LIMIT_PER_KEY_PER_MIN`); the " +
    "61st answers `allowed: false` with the wait and writes nothing. Otherwise it stores the window and count, and " +
    "`lastResolvedAt`/`lastResolvedOrigin` when the stamp is older than 60 s, so a stamp names the first resolution of " +
    "its minute. The per-origin limit the protocol declares (120 a minute, policy.ts:7) is never applied. The refusal " +
    "is returned, not thrown: the caller turns it into RATE_LIMITED.",
  was: [`${CONVEX}:7`, `${OPS}/record-use.ts:9`, `${A}/reads.ts:69`, "packages/protocol/src/applications/policy.ts:7", ...USE_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: "internal: run by applications.bootstraps.resolve (`recordResolution`, bootstraps/writes.ts:47), admitting no code.",
  input: Schema.Struct({ keyId: Schema.String, origin: Schema.optionalKey(Schema.String) }),
  output: Schema.Struct({ allowed: Schema.Boolean, retryAfterMs: Schema.Number }),
  errors: [error_UNKNOWN],
  reads: [table_publishable_keys],
  writes: [table_publishable_keys],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
