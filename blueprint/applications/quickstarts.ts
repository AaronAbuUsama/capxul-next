// Applications' quickstarts area: an anonymous test key for an app on a developer's machine, with no
// sign-in (`dev key`). One HTTP route, `POST /v1/client/mint-quickstart-key`, answered only on a devnet
// or staging (decision applications.quickstart-keys).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_RATE_LIMITED, error_WRONG_ENVIRONMENT } from "../shared/vocabulary.ts";
import { table_quickstart_keys } from "./data.ts";

const OLD = "packages/backend/src/applications/quickstarts";
const ASIS = "docs/as-is/archive/applications/quickstarts.ts";

const S = Schema.String;

/** What a mint answers. The field names are the frozen `dev key` returns'. */
export const MintedKey = Schema.Struct({
  publishableKey: S,
  /** The backend's public origin, which `dev key` writes as CAPXUL_SITE_URL. */
  convexSiteUrl: S,
  /** Where sign-in answers: the same backend origin, since sign-in is the backend's own rpcs. */
  authBaseUrl: S,
  /** The one origin the key works from. */
  allowedOrigins: Schema.Array(S),
});

export const rpc_applications_quickstarts_mint = defineRpc({
  id: "applications.quickstarts.mint",
  title: "Mint an anonymous test key for a local app",
  about:
    "Anyone, with no sign-in. A deployment that is not a devnet or staging refuses WRONG_ENVIRONMENT before anything else " +
    "(the old route minted a production backend's test key). `origin` defaults to `http://localhost:3000` and must be an " +
    "http(s) origin on localhost, *.localhost, 127.0.0.1 or [::1], else INVALID_INPUT. The route passes the caller's " +
    "address, kept only as a keyed hash: an address with 15 keys minted in the last hour refuses RATE_LIMITED with " +
    "`retryAfterMs`, until its oldest one leaves the hour. Otherwise one insert stores the new key's hash, prefix " +
    "(`cap_pk_test_`), last four characters and origin. Answers the raw key, once, with the backend's origin and the key's " +
    "origin.",
  concept: concept_applications,
  kind: "mutation",
  who: "Anyone, unauthenticated, on a devnet or staging; at most 15 keys an hour per network address.",
  input: Schema.Struct({ origin: Schema.optionalKey(S) }),
  output: MintedKey,
  errors: [error_WRONG_ENVIRONMENT, error_INVALID_INPUT, error_RATE_LIMITED],
  reads: [table_quickstart_keys],
  writes: [table_quickstart_keys],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${ASIS}:33`, `${ASIS}:118`, `${OLD}/operations/mint.ts:34`, `${OLD}/rules.ts:11`, `${OLD}/rules.ts:24`, "packages/backend/convex/http.ts:122"],
});
