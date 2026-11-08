// The as-is Core SDK flows of the old applications concept (packages/sdk/src/applications/): the
// bootstrap composition, and the comment at the end lists the methods that forward one rpc.
//
// The bootstrap is not a `client.*` method: `createCapxulClient` (packages/sdk/src/platform/production.ts:135)
// resolves the publishable key through the applications folder's `HttpBootstrapAdapter` before any client
// exists. This book records that composition under the SDK function a host calls, and only its bootstrap
// steps: the adapters, the Convex client and the signer it builds next belong to no concept of this lane.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
} from "../shared/vocabulary.ts";
import { rpc_applications_bootstraps_resolve } from "./bootstraps.ts";

const SDK = "packages/sdk/src";
const APPS = `${SDK}/applications`;
const PLATFORM = `${SDK}/platform`;

export const flow_create_capxul_client = defineFlow({
  id: "create-capxul-client",
  title: "Create a client: resolve the publishable key into a bootstrap envelope",
  about:
    "createCapxulClient (and createCapxulClientWithSignerControls) builds the client through createProductionAdapters, " +
    "whose first work is the bootstrap. The key must match `cap_pk_(test|live)_` plus 32 Crockford characters and the " +
    "origin and bootstrapBaseUrl must be http(s) (INVALID_INPUT); in a browser both default to the page's origin, in " +
    "Node the origin is absent and the base URL defaults to staging (`https://api.staging.capxul.com`, runtime-urls.ts:17). A host-supplied cache is read first: an " +
    "envelope it holds that decodes and is not within 30 s of its own expiry is used with no request. Otherwise it POSTs " +
    "`{ publishableKey }` to `/v1/client/bootstrap` with the Origin header and the observation headers, and retries a " +
    "408, 425, 429 or 5xx answer twice (400 ms, doubling); a network rejection is NETWORK_ERROR at once. A refusal body " +
    "passes through as its code (a 429 is RATE_LIMITED after the retries); another 401 is NOT_AUTHENTICATED; another " +
    "status PROVIDER_ERROR with the proxy's evidence masked; a 200 that is not JSON or not the envelope " +
    "PROVIDER_RESPONSE_INVALID. A good body is saved to the cache, a save failure ignored. A `local-private-key` signer " +
    "on a chain outside the dev-key list refuses INVALID_INPUT, and the runtime URLs must resolve. The SDK emits its own " +
    "`bootstrap_failed` (reason the code) or `bootstrap_resolved` through the host's telemetry port, besides the " +
    "server's events of the same names. Output: the CapxulClient (Schema.Unknown).",
  component: component_core_sdk,
  sdk: "createCapxulClient",
  input: Schema.Struct({
    publishableKey: Schema.String,
    origin: Schema.optionalKey(Schema.String),
    bootstrapBaseUrl: Schema.optionalKey(Schema.String),
    runtime: Schema.optionalKey(Schema.Literals(["browser", "node"])),
    /** `BootstrapCache`: the host's load and save of the last body. */
    bootstrapCache: Schema.optionalKey(Schema.Unknown),
    /** The rest of `ProductionAdapterInput` (signer, fetch, telemetry, auth URL): too deep to transcribe. */
    rest: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Unknown,
  steps: [
    {
      name: "resolve-input",
      local: "build",
      about: "Brands the key and origin and normalizes the bootstrap base URL; a browser derives both from its page.",
    },
    {
      name: "cache",
      local: "cache",
      about: "With a host cache: reuses a stored envelope that decodes and expires more than 30 s from now; no request.",
    },
    {
      name: "bootstrap",
      rpc: rpc_applications_bootstraps_resolve,
      about: "POST /v1/client/bootstrap with the key, the Origin and the observation headers; up to two retries of a transient status.",
    },
    {
      name: "decode",
      local: "build",
      about: "Decodes the `capxul.bootstrap` v1 envelope and normalizes its URLs; saves the body to the host cache.",
    },
    {
      name: "fence",
      local: "build",
      about: "A dev-key signer is refused on a chain outside the testnet list; the runtime URLs are resolved.",
    },
    {
      name: "report",
      local: "build",
      about: "Emits `bootstrap_failed` or `bootstrap_resolved` to the host's telemetry port, defects swallowed.",
    },
  ],
  errors: [
    error_INVALID_INPUT,
    error_NOT_AUTHENTICATED,
    error_RATE_LIMITED,
    error_NETWORK_ERROR,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  calls: [],
  spans: [],
  was: [
    `${PLATFORM}/production.ts:135`,
    `${PLATFORM}/client/create.ts:9`,
    `${PLATFORM}/production-adapters.ts:58`,
    `${PLATFORM}/production-adapters.ts:70`,
    `${PLATFORM}/production-adapters.ts:81`,
    `${PLATFORM}/production-adapters.ts:87`,
    `${PLATFORM}/production-adapters.ts:107`,
    `${PLATFORM}/production-adapters.ts:113`,
    `${PLATFORM}/production-adapters.ts:132`,
    `${PLATFORM}/production-bootstrap.ts:23`,
    `${PLATFORM}/production-bootstrap.ts:53`,
    `${PLATFORM}/production-bootstrap.ts:93`,
    `${APPS}/bootstrap-adapter.ts:50`,
    `${APPS}/bootstrap-adapter.ts:57`,
    `${APPS}/bootstrap-adapter.ts:70`,
    `${APPS}/bootstrap-adapter.ts:120`,
    `${APPS}/bootstrap-adapter.ts:138`,
    `${APPS}/bootstrap-adapter.ts:164`,
    `${APPS}/bootstrap-adapter.ts:222`,
    `${APPS}/bootstrap-envelope.ts:27`,
    `${SDK}/signing/dev-signer.ts:47`,
    `${PLATFORM}/runtime-urls.ts:17`,
    "packages/protocol/src/applications/model.ts:41",
  ],
});

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.account.keys.create   → applications.keys.create, actor { kind: account }; `origins` becomes
//                                `allowedOrigins` (applications/keys.ts:84). Mounted by parties/contacts.ts:227.
// client.account.keys.list     → applications.keys.list (applications/keys.ts:93).
// client.account.keys.rotate   → applications.keys.rotate (applications/keys.ts:94).
// client.account.keys.revoke   → applications.keys.revoke (applications/keys.ts:95).
// client.org(orgId).keys.*     → the same four rows with actor { kind: org, orgId } (parties/contacts.ts:243).
//
// Without a Convex port or a runner every keys method answers NOT_IMPLEMENTED `keys` without a call
// (applications/keys.ts:49). The registrations rows (`applications.registrations.list`, `create`) have no SDK
// method: nothing in packages/sdk calls them.
