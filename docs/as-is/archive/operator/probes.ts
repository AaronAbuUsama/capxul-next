// The as-is book of the old operator concept: the probes area, the backend tenancy probes (L4).
//
// Every operation registered at `operator/probes:*` (packages/backend/convex/operator/probes.ts): the three
// public rows of `probes` (packages/protocol/src/operator/operations.ts:167), gated by the
// CAPXUL_TEST_ONLY_TENANCY_CAPABILITY secret. None is scheduled, so every one is an rpc.
//
// The probes are the one place Operator writes another concept's tables itself, with no door: a synthetic
// row in Applications' `developerApplications` and a consent row in Access's `userAppConsents`. Recorded as
// writes; the build's write-boundary report is the finding (the operator README states the exception).

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_ENV_MISSING, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN } from "../shared/vocabulary.ts";
import { procedure_access_require_consented_user } from "../access/procedures.ts";
import { table_user_app_consents } from "../access/data.ts";
import { table_developer_applications } from "../applications/data.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/operator/probes.ts`;
const P = `${SRC}/operator/probes`;
const OPS = `${P}/operations`;
const ROWS = "packages/protocol/src/operator/operations.ts";

/** INPUT, GATED, DEFECTS (operations.ts:17, :23). */
const ROW_ERRORS = [error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN, error_ENV_MISSING];

/** requireTestOnlyCapability (probes/guards.ts:11): unset is ENV_MISSING, a mismatch NOT_AUTHENTICATED. */
const CAPABILITY_WAS = [`${P}/guards.ts:11`, `${P}/errors.ts:8`, `${P}/errors.ts:11`, `${P}/rules.ts:4`];

/** consentedUser (probes/reads.ts:33): Access's own verdict, admitting NOT_AUTHENTICATED and INVALID_INPUT. */
const VERDICT_WAS = [`${P}/reads.ts:33`, `${P}/views.ts:5`, `${SRC}/access/sessions/guards.ts:135`];

const WHO =
  "Anyone presenting the exact CAPXUL_TEST_ONLY_TENANCY_CAPABILITY secret (the L4 tenancy test); no session. A " +
  "deployment without the secret refuses every call with ENV_MISSING; a wrong one is NOT_AUTHENTICATED.";

/** `Tenant` (operations.ts:52): `appId` must be `app_` plus a ULID, `authUserId` non-empty. */
const Tenant = { appId: Schema.String, authUserId: Schema.String, capability: Schema.String };

/** `ConsentedUser` (operations.ts:55): the consent `requireConsentedUser` admits. */
const ConsentedUser = Schema.Struct({
  ok: Schema.Literal(true),
  appId: Schema.String,
  authUserId: Schema.String,
  scopes: Schema.Array(Schema.String),
});

export const rpc_operator_probes_seed_backend_tenancy = defineRpc({
  id: "operator.probes.seed-backend-tenancy",
  title: "Register the probe application if absent and grant the person its consent",
  about:
    "Row `operator.probes.seedBackendTenancy`, registered as the public mutation `operator/probes:seedBackendTenancy`. " +
    "The capability, then it runs as the system actor `tenancy_test`. An application with the given id that does not " +
    "exist is inserted directly into `developerApplications` as `Backend tenancy L4`, owned by the probed person, with " +
    "fixed test routing and vendor keys; an existing one, whatever it is, is left. The pair's consent is inserted with " +
    "the scopes `identity:read` and `smart-account:read`, or the existing one is un-revoked and given those scopes, " +
    "directly in `userAppConsents`. Answers what Access's `requireConsentedUser` now admits for the pair. `now` is the " +
    "caller's.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/seed-backend-tenancy.ts:13`,
    `${OPS}/seed-backend-tenancy.ts:18`,
    `${OPS}/seed-backend-tenancy.ts:20`,
    `${OPS}/seed-backend-tenancy.ts:23`,
    `${P}/reads.ts:10`,
    `${P}/reads.ts:21`,
    `${P}/writes.ts:11`,
    `${P}/writes.ts:24`,
    `${P}/rules.ts:6`,
    `${P}/rules.ts:9`,
    `${SRC}/operator/README.md:17`,
    `${ROWS}:169`,
    ...CAPABILITY_WAS,
    ...VERDICT_WAS,
  ],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ ...Tenant, now: Schema.Number }),
  output: ConsentedUser,
  errors: ROW_ERRORS,
  reads: [table_developer_applications, table_user_app_consents],
  writes: [table_developer_applications, table_user_app_consents],
  drives: [],
  invokes: [procedure_access_require_consented_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_probes_revoke_backend_tenancy_consent = defineRpc({
  id: "operator.probes.revoke-backend-tenancy-consent",
  title: "Revoke the person's consent to the probe application",
  about:
    "Row `operator.probes.revokeBackendTenancyConsent`, registered as the public mutation " +
    "`operator/probes:revokeBackendTenancyConsent`. The capability, then as `tenancy_test` it stamps the pair's consent " +
    "`revokedAt` directly in `userAppConsents`; an absent consent succeeds. `revokedAt` is the caller's time.",
  was: [`${CONVEX}:4`, `${OPS}/revoke-backend-tenancy-consent.ts:12`, `${OPS}/revoke-backend-tenancy-consent.ts:19`, `${P}/reads.ts:21`, `${P}/writes.ts:42`, `${ROWS}:176`, ...CAPABILITY_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ ...Tenant, revokedAt: Schema.Number }),
  output: Schema.Struct({ ok: Schema.Literal(true) }),
  errors: ROW_ERRORS,
  reads: [table_user_app_consents],
  writes: [table_user_app_consents],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_probes_assert_require_consented_user = defineRpc({
  id: "operator.probes.assert-require-consented-user",
  title: "What Access's consent guard admits for an application and person",
  about:
    "Row `operator.probes.assertRequireConsentedUser`, registered as the public query " +
    "`operator/probes:assertRequireConsentedUser`. The capability, then Access's `requireConsentedUser` for the pair: " +
    "the consent it admits (without timestamps), or its refusal (NOT_AUTHENTICATED or INVALID_INPUT).",
  was: [`${CONVEX}:3`, `${OPS}/assert-require-consented-user.ts:10`, `${ROWS}:183`, ...CAPABILITY_WAS, ...VERDICT_WAS],
  concept: concept_operator,
  kind: "query",
  who: WHO,
  input: Schema.Struct(Tenant),
  output: ConsentedUser,
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_require_consented_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
