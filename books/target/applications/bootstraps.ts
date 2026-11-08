// Applications' bootstraps area: a publishable key becomes the envelope a client needs to use this
// deployment. It is one of the backend's few HTTP routes (`POST /v1/client/bootstrap`), callable with
// no session; the runtime answers its CORS preflight like every route's (decision
// applications.no-preflight-rpcs). The envelope is built from the deployment's settings at the
// moment of the call, never from metadata stored with the key (decision
// applications.envelope-from-deployment). Bootstrap grants no authority: a person still signs in
// through access, and what they may do still comes from hats, budgets and Seats.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { KeyEnvironment, table_applications, table_publishable_keys, table_quickstart_keys } from "./data.ts";

const OLD = "packages/backend/src/applications/bootstraps";
const ASIS = "books/as-is/applications/bootstraps.ts";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;

/** `capxul.bootstrap` v2: what a client needs to reach and use this deployment. */
export const Envelope = Schema.Struct({
  protocol: Schema.Literal("capxul.bootstrap"),
  version: Schema.Literal(2),
  application: Schema.Struct({
    /** Null for a quickstart key, which belongs to no application. */
    applicationId: Null(S),
    keyId: S,
    environment: KeyEnvironment,
  }),
  /** The browser origin admitted, or null for a host that sent none (Node). */
  origin: Null(S),
  /** The backend's public origin: its rpcs over HTTP, its live rpcs over a WebSocket, and sign-in. */
  backendUrl: S,
  chainId: Schema.Int,
  /** The Protocol v4 deployment's address book: contract name to address, from PROTOCOL_V4_DEPLOYMENT. */
  contracts: Schema.Record(S, S),
  companiesHouseNamespace: S,
  /** What the Openfort embedded signer needs in a browser. */
  signer: Schema.Struct({ openfortPublishableKey: S, shieldPublishableKey: S }),
  /** Where the SDK exports its spans (OTLP over HTTP), or null when this deployment collects none. */
  traces: Null(S),
  /**
   * Capxul's MAC over the key id, the origin and the expiry: the backend admits that browser origin for this
   * deployment's rpcs until then. Null when no origin was sent.
   */
  originToken: Null(S),
  /** Five minutes from now: a client bootstraps again before then, so a revoked key stops within five minutes. */
  expiresAt: N,
});

export const rpc_applications_bootstraps_resolve = defineRpc({
  id: "applications.bootstraps.resolve",
  title: "Resolve a publishable key into a bootstrap envelope",
  about:
    "`POST /v1/client/bootstrap`, with no session; the route passes the request's `Origin` header, or null from a host " +
    "that sends none. A key that is not `cap_pk_(test|live)_` and 32 Crockford characters is INVALID_INPUT. The key is " +
    "found by its hash among owned keys, then quickstart keys; none, a revoked or expired key, or a grace key past " +
    "`grace_ends_at` is NOT_AUTHENTICATED with `reason` and `next: capxul key create`. A sent origin must be one of the " +
    "key's application's origins now (a quickstart key: its one origin), else NOT_AUTHENTICATED `origin-not-allowed`, " +
    "whose `next` is the `key create --app … --origin …` that would add it. It stamps the owned key's last use when the " +
    "stamp is a minute old or more (one conditional update, so a busy key costs one write a minute), then answers the " +
    "envelope from the deployment's settings, with an origin token for the admitted origin. Replaces the old route, " +
    "which counted every call on the key row and answered a session token nothing checked.",
  concept: concept_applications,
  kind: "mutation",
  who: "Anyone holding a publishable key: a browser, its Origin checked against the key, or a Node host with none.",
  input: Schema.Struct({ publishableKey: S, origin: Null(S) }),
  output: Envelope,
  errors: [error_INVALID_INPUT, error_NOT_AUTHENTICATED],
  reads: [table_publishable_keys, table_applications, table_quickstart_keys],
  writes: [table_publishable_keys],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [
    `${ASIS}:58`,
    `${ASIS}:156`,
    `${ASIS}:178`,
    `${OLD}/operations/resolve.ts:39`,
    `${OLD}/guards.ts:13`,
    `${OLD}/guards.ts:20`,
    `${OLD}/views.ts:37`,
    "packages/backend/convex/http.ts:103",
  ],
});
