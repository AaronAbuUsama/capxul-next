// The applications concept's own door, as it is: the functions packages/backend/src/applications/index.ts
// exports that another concept calls inside its own Convex transaction (they take the caller's QueryCtx
// and throw CapxulErrors). Callers import them by subpath ("#applications/reads", "#applications/rules"),
// never through the door file itself.
//
// Not booked here, because they are not in-transaction functions: the constants the door re-exports
// (BETA_PRODUCT_APP, LOCAL_NATIVE_DEVNET, STAGING_NATIVE_CLIENT, read by requests/reads/links.ts:11) and the
// HTTP helpers Access's beta waitlist reuses (`failureResponse`, `preflight`, `withCors` from views.ts and
// `requestBody` from reads.ts, access/waitlist/operations/request.ts:5). They are findings of their own: a
// door that exports HTTP response builders and fixed deployment identities.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import { error_ENV_MISSING, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { table_developer_applications, table_publishable_keys } from "./data.ts";

const B = "packages/backend/src";
const A = `${B}/applications`;
const DOOR = `${A}/index.ts`;

export const procedure_applications_hash_credential_value = defineProcedure({
  id: "applications.hash-credential-value",
  title: "Hash a credential the way a publishable key is hashed",
  about:
    "`sha256:` plus the hex SHA-256 of the trimmed value (crypto.subtle). An empty value throws INVALID_INPUT " +
    "(`emptyCredential`, field `publishableKey` whatever the caller hashes). It reads and writes nothing; it is a door " +
    "function because Access hashes its device codes, continuity tokens and context proofs with it. Invoked today by " +
    "access: access/clients/rules.ts:10.",
  concept: concept_applications,
  input: Schema.Struct({ raw: Schema.String }),
  output: Schema.String,
  errors: [error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:8`, `${A}/rules.ts:34`, `${A}/rules.ts:18`, `${A}/errors.ts:17`, `${B}/access/clients/rules.ts:10`],
});

export const procedure_applications_read_owned_application_references_in_tx = defineProcedure({
  id: "applications.read-owned-application-references-in-tx",
  title: "Whether any of these people owns an application",
  about:
    "For an operator purge: `[\"developerApplications\"]` when any of the auth users owns an application, archived or " +
    "not, else empty. It reads the `by_owner_name` index by `ownerAuthUserId` only, so an Organization's application a " +
    "person made (which carries `ownerOrgId` and no `ownerAuthUserId`) does not keep the person. Invoked today by " +
    "operator: operator/identities/guards.ts:51.",
  concept: concept_applications,
  input: Schema.Struct({ authUserIds: Schema.Array(Schema.String) }),
  output: Schema.Array(Schema.Literal("developerApplications")),
  errors: [],
  reads: [table_developer_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:14`, `${A}/reads.ts:154`, `${A}/reads.ts:160`, `${B}/operator/identities/guards.ts:51`],
});

export const procedure_applications_resolve_application_observation_hint = defineProcedure({
  id: "applications.resolve-application-observation-hint",
  title: "Admit an observation's application hint",
  about:
    "The application id when the hint names an application that is not archived, else null; no hint is null. It grants " +
    "no authority. The door comment says Organizations admits an observation's application hint with it, but no file " +
    "outside applications imports it on this branch: a door export with no caller.",
  concept: concept_applications,
  input: Schema.Struct({ applicationHint: Schema.optionalKey(Schema.String) }),
  output: Schema.NullOr(Schema.String),
  errors: [],
  reads: [table_developer_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:15`, `${DOOR}:11`, `${A}/reads.ts:170`, `${A}/reads.ts:179`],
});

export const procedure_applications_resolve_native_client_metadata = defineProcedure({
  id: "applications.resolve-native-client-metadata",
  title: "The native client metadata this deployment publishes",
  about:
    "Read and checked against the store on every request. On `staging` it reads the pinned application " +
    "(app_50ACBRRF7N7QGYD87SX7QZQM0P) and key (key_439CE47R15PYMH7MC3QKW46BYS) by id; on `local` the application named " +
    "`Capxul local devnet` and its first test key. Any other environment, a missing row, or a row whose routing, origins, " +
    "environment, archive, revocation or grace differ from the pinned configuration throws ENV_MISSING " +
    "(`CAPXUL_NATIVE_CLIENT_REGISTRATION`). The staging routing it checks is hard-coded in the code " +
    "(`https://convex.staging.capxul.com`, issuer plus `/api/auth`); the devnet's authBaseUrl is the bare issuer. " +
    "Answers the `capxul.client-authorization` v1 metadata with the device-code and refresh-token grants and the " +
    "endpoints of the configuration (deep, Schema.Unknown). Invoked today by access: access/clients/reads/store.ts:9.",
  concept: concept_applications,
  input: Schema.Struct({ environment: Schema.String, now: Schema.Number }),
  output: Schema.Unknown,
  errors: [error_ENV_MISSING],
  reads: [table_developer_applications, table_publishable_keys],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [
    `${DOOR}:16`,
    `${A}/reads.ts:266`,
    `${A}/reads.ts:192`,
    `${A}/reads.ts:212`,
    `${A}/reads.ts:242`,
    `${A}/reads.ts:278`,
    `${A}/model.ts:34`,
    `${A}/errors.ts:26`,
    `${B}/access/clients/reads/store.ts:9`,
  ],
});
