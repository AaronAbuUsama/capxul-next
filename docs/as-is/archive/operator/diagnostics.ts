// The as-is book of the old operator concept: the diagnostics area.
//
// Every operation registered at `operator/diagnostics:*` (packages/backend/convex/operator/diagnostics.ts):
// four public rows of `diagnostics` (packages/protocol/src/operator/operations.ts:62), each callable by
// anyone with the deployment URL, no session. Nothing here is scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { integration_chain_rpc } from "../shared/external.ts";
import { error_ENV_MISSING, error_INVALID_INPUT, error_PROVIDER_ERROR, error_UNKNOWN } from "../shared/vocabulary.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/operator/diagnostics.ts`;
const O = `${BACKEND}/src/operator`;
const D = `${O}/diagnostics`;
const ROWS = "packages/protocol/src/operator/operations.ts";

/** INPUT plus DEFECTS (operations.ts:17; protocol operation.ts:54). */
const ROW_ERRORS = [error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

const WHO = "Anyone who can reach the deployment: a public function with no session, gate or capability.";

export const rpc_operator_diagnostics_health = defineRpc({
  id: "operator.diagnostics.health",
  title: "Echo a nonce with the deployment that answered",
  about:
    "Row `operator.diagnostics.health`, registered as the public action `operator/diagnostics:health`. Answers the " +
    "caller's nonce, this deployment's name (the subdomain of a `*.convex.cloud` CONVEX_CLOUD_URL, else its host) and " +
    "the wall time. A deployment with no CONVEX_CLOUD_URL refuses ENV_MISSING. An action, so it continues the caller's " +
    "trace and its wide event is posted. The SDK's `client.system.health` calls it; reads no data.",
  was: [`${CONVEX}:6`, `${D}/operations/health.ts:13`, `${D}/reads.ts:13`, `${D}/errors.ts:6`, `${BACKEND}/src/platform/environment.ts:29`, `${ROWS}:64`],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({ nonce: Schema.String }),
  output: Schema.Struct({ nonce: Schema.String, deployment: Schema.String, at: Schema.Number }),
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_diagnostics_environment = defineRpc({
  id: "operator.diagnostics.environment",
  title: "The deployment's tier and the e2e auth gate's verdict",
  about:
    "Row `operator.diagnostics.environment`, registered as the public query `operator/diagnostics:environment`. The " +
    "tier this deployment derives from CONVEX_CLOUD_URL (development, staging, beta, production, local or unknown) and " +
    "Access's e2e auth gate verdict for SITE_URL: `disabled`, `enabled`, or `refused` with its reason. No values and no " +
    "secrets. Nothing in it fails.",
  was: [`${CONVEX}:5`, `${D}/operations/environment.ts:8`, `${D}/reads.ts:21`, `${D}/reads.ts:24`, `${D}/rules.ts:12`, `${BACKEND}/src/access/sessions/rules.ts:126`, `${ROWS}:71`],
  concept: concept_operator,
  kind: "query",
  who: WHO,
  input: Schema.Struct({}),
  output: Schema.Struct({
    environment: Schema.Literals(["development", "staging", "beta", "production", "unknown", "local"]),
    e2eAuth: Schema.Union([
      Schema.Struct({ status: Schema.Literal("disabled") }),
      Schema.Struct({ status: Schema.Literal("enabled") }),
      Schema.Struct({ status: Schema.Literal("refused"), reason: Schema.String }),
    ]),
  }),
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_diagnostics_clock = defineRpc({
  id: "operator.diagnostics.clock",
  title: "The backend's business time and its offset from the wall",
  about:
    "Row `operator.diagnostics.clock`, registered as the public action `operator/diagnostics:clock` (ADR-0041). The " +
    "business clock's now and its offset from the wall: a client adds the offset to its own clock so a devnet warp " +
    "moves its now too. Live, the offset is 0. An action because a query's time is frozen and cached. The SDK's " +
    "`client.system.clock` calls it.",
  was: [`${CONVEX}:4`, `${D}/operations/clock.ts:12`, `${BACKEND}/src/platform/clock.ts:54`, `${BACKEND}/src/platform/clock.ts:119`, `${ROWS}:89`],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({}),
  output: Schema.Struct({ nowMs: Schema.Number, offsetMs: Schema.Number }),
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_diagnostics_chain = defineRpc({
  id: "operator.diagnostics.chain",
  title: "The chain head the backend reads, on a local devnet",
  about:
    "Row `operator.diagnostics.chain`, registered as the public action `operator/diagnostics:chain`. Anywhere but a " +
    "local devnet it refuses INVALID_INPUT `environment` before any request; there it reads Base Sepolia's latest block " +
    "number through the live chain RPC, admitting PROVIDER_ERROR and ENV_MISSING.",
  was: [`${CONVEX}:3`, `${D}/operations/chain.ts:10`, `${D}/guards.ts:11`, `${D}/errors.ts:9`, `${D}/external.ts:10`, `${O}/external.ts:9`, `${ROWS}:96`],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({}),
  output: Schema.Struct({ blockNumber: Schema.Number }),
  errors: [...ROW_ERRORS, error_PROVIDER_ERROR],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.fetchLatestBlockNumber],
  chain: [],
  spans: [],
});
