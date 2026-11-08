// The as-is book of the old applications concept: the quickstarts area.
//
// `POST /v1/client/mint-quickstart-key` (`mint`) and its CORS preflight (`preflight`) are HTTP actions
// routed in packages/backend/convex/http.ts:112; they have no protocol row, so their ids are their
// operation catalog names (packages/observability/src/operations/applications.ts:25). `claim` is the
// internal mutation `mint` runs through `ctx.runMutation`. Nothing here is scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_RATE_LIMITED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  table_developer_applications,
  table_publishable_key_origins,
  table_publishable_keys,
  table_quickstart_mint_rate_limits,
} from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/applications/quickstarts.ts`;
const HTTP = `${BACKEND}/convex/http.ts`;
const A = `${BACKEND}/src/applications`;
const Q = `${A}/quickstarts`;
const OPS = `${Q}/operations`;

export const rpc_applications_quickstarts_mint = defineRpc({
  id: "applications.quickstarts.mint",
  title: "Mint a sandbox test key with no account",
  about:
    "`POST /v1/client/mint-quickstart-key`, an HTTP action with no session and no operator secret (`@capxul/sandbox key " +
    "create`). It runs as the system job `quickstart_mint`. The body must be one JSON object (INVALID_INPUT); its " +
    "`origin` defaults to `http://localhost:3000` and must be an http(s) loopback origin (localhost, *.localhost, " +
    "127.0.0.1, [::1]), else INVALID_INPUT. It reads the deployment before spending a mint: the vendor keys " +
    "(ENV_MISSING) and a CONVEX_CLOUD_URL that names a known tier (INVALID_INPUT). Then claim counts the mint against " +
    "the client IP's hour (15; the 16th is RATE_LIMITED, 429 with `Retry-After`), register makes or reuses the unowned " +
    "application `Quickstart <origin>`, and issue stores a `test` key for it. The key's environment is always `test`, " +
    "but the vendor keys and backend URL are this deployment's: on production it is a production backend's test key, " +
    "although the route comment says test-environment only. Its authBaseUrl is the developer's origin plus `/api/auth` " +
    "and its siteBaseUrl this request's origin. Answers the raw key, the site URL, the auth URL and the origins with " +
    "CORS. A refusal answers its public projection as JSON; WRONG_STATE (an ambiguous registration or application) and " +
    "ENV_MISSING are not in the HTTP status map, so they answer 500. Its wide event is scheduled after the response; it " +
    "emits no product event.",
  was: [
    `${HTTP}:122`,
    `${HTTP}:109`,
    `${CONVEX}:5`,
    `${OPS}/mint.ts:34`,
    `${OPS}/mint.ts:42`,
    `${OPS}/mint.ts:43`,
    `${OPS}/mint.ts:55`,
    `${OPS}/mint.ts:56`,
    `${OPS}/mint.ts:57`,
    `${OPS}/mint.ts:82`,
    `${OPS}/mint.ts:84`,
    `${Q}/rules.ts:8`,
    `${Q}/rules.ts:24`,
    `${Q}/rules.ts:45`,
    `${Q}/writes.ts:34`,
    `${Q}/writes.ts:44`,
    `${Q}/writes.ts:57`,
    `${Q}/errors.ts:14`,
    `${Q}/errors.ts:18`,
    `${A}/reads.ts:126`,
    `${A}/reads.ts:146`,
    `${A}/views.ts:11`,
  ],
  concept: concept_applications,
  kind: "action",
  who: "Anyone, unauthenticated, from any network; capped per client IP.",
  input: Schema.Struct({ origin: Schema.optionalKey(Schema.String) }),
  output: Schema.Struct({
    publishableKey: Schema.String,
    convexSiteUrl: Schema.String,
    authBaseUrl: Schema.String,
    allowedOrigins: Schema.Array(Schema.String),
  }),
  errors: [error_INVALID_INPUT, error_ENV_MISSING, error_RATE_LIMITED, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_quickstart_mint_rate_limits, table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_quickstart_mint_rate_limits, table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_quickstarts_preflight = defineRpc({
  id: "applications.quickstarts.preflight",
  title: "Answer the quickstart mint's CORS preflight",
  about:
    "`OPTIONS /v1/client/mint-quickstart-key`: the same 204 answer as the bootstrap preflight (kept 600 s, CORS for an " +
    "http(s) origin), wrapped in `observedRoute` as the system job `cors_preflight`. Reads and writes nothing.",
  was: [`${HTTP}:112`, `${CONVEX}:6`, `${OPS}/preflight.ts:6`, `${A}/views.ts:43`],
  concept: concept_applications,
  kind: "action",
  who: "Anyone: a browser's preflight before the mint POST.",
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

export const rpc_applications_quickstarts_claim = defineRpc({
  id: "applications.quickstarts.claim",
  title: "Count one quickstart mint against the caller's IP window",
  about:
    "The internal mutation `applications/quickstarts:claim`. A fixed one-hour window per IP admits 15 mints; the 16th " +
    "answers `allowed: false` with the wait and writes nothing. A new IP inserts its row; a passed window restarts at " +
    "`now`. `now` is the caller's wall time, passed in. The refusal is returned, not thrown: the caller turns it into " +
    "RATE_LIMITED. Every caller without an `x-forwarded-for` header shares the `unknown` bucket.",
  was: [`${CONVEX}:4`, `${OPS}/claim.ts:9`, `${Q}/writes.ts:17`, `${Q}/reads.ts:7`, `${Q}/rules.ts:11`, `${Q}/rules.ts:56`],
  concept: concept_applications,
  kind: "mutation",
  who: "internal: run by applications.quickstarts.mint (`claimMint`, quickstarts/writes.ts:34), admitting no code.",
  input: Schema.Struct({ ip: Schema.String, now: Schema.Number }),
  output: Schema.Struct({ allowed: Schema.Boolean, retryAfterMs: Schema.Number }),
  errors: [error_UNKNOWN],
  reads: [table_quickstart_mint_rate_limits],
  writes: [table_quickstart_mint_rate_limits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
