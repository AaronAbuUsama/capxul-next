// The as-is book of the old operator concept: the identities area.
//
// Every operation registered at `operator/identities:*` (packages/backend/convex/operator/identities.ts).
// `peekOtp`, `peekSmartAccount` and `seedFinancialOpsOrg` implement the public rows `identities`
// (packages/protocol/src/operator/operations.ts:126), gated by the CAPXUL_DEV_IDENTITY_CAPABILITY secret.
// `purgeAccount` and `purgeByEmail` are internal mutations run with `convex run`. None is scheduled.
//
// Operator owns none of the rows these read or write: every read and write goes through the owning
// concept's in-transaction function, each booked as an invoke of that concept's procedure. The
// capability check (`assertDevIdentityCapability`, access/sessions/rules.ts:149) is a pure rule of
// Access that reads the environment, so it is not a procedure.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import {
  procedure_access_read_pending_proof_otp_in_tx,
  procedure_access_read_proof_auth_user_emails_in_tx,
  procedure_access_read_proof_auth_user_ids_in_tx,
  procedure_access_remove_native_client_rows_in_tx,
  procedure_access_remove_proof_auth_email_in_tx,
  procedure_access_remove_proof_otp_rate_limit_in_tx,
  procedure_access_remove_proof_subject_access_in_tx,
} from "../access/procedures.ts";
import {
  procedure_accounts_purge_account_rows_in_tx,
  procedure_accounts_read_account_purge_target_in_tx,
  procedure_accounts_read_proof_smart_accounts_in_tx,
  procedure_accounts_remove_first_proof_safe_in_tx,
} from "../accounts/procedures.ts";
import { procedure_applications_read_owned_application_references_in_tx } from "../applications/procedures.ts";
import {
  procedure_organizations_read_account_organization_references_in_tx,
  procedure_organizations_seed_financial_proof_organization_in_tx,
} from "../organizations/procedures.ts";
import {
  procedure_parties_purge_account_parties_in_tx,
  procedure_parties_read_party_references_in_tx,
  procedure_parties_read_person_parties_in_tx,
} from "../parties/procedures.ts";
import { procedure_payments_read_account_ledger_references_in_tx } from "../payments/procedures.ts";
import { procedure_permissions_read_member_safe_references_in_tx } from "../permissions/procedures.ts";
import {
  procedure_profiles_purge_profiles_in_tx,
  procedure_profiles_read_first_proof_profile_email_in_tx,
  procedure_profiles_remove_first_proof_profile_in_tx,
} from "../profiles/procedures.ts";
import { procedure_requests_read_person_request_references_in_tx } from "../requests/procedures.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/operator/identities.ts`;
const I = `${SRC}/operator/identities`;
const OPS = `${I}/operations`;
const ROWS = "packages/protocol/src/operator/operations.ts";

/** INPUT, GATED, DEFECTS (operations.ts:17, :23). */
const ROW_ERRORS = [error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN, error_ENV_MISSING];

/** requireDevIdentityCapability (identities/guards.ts:21): admits NOT_AUTHENTICATED and ENV_MISSING. */
const CAPABILITY_WAS = [`${I}/guards.ts:21`, `${SRC}/access/sessions/rules.ts:149`];

const CAPABILITY_WHO =
  "Anyone presenting the exact CAPXUL_DEV_IDENTITY_CAPABILITY secret (the MCP proof scripts); no session. A wrong " +
  "capability is NOT_AUTHENTICATED; a deployment without the secret refuses every call with ENV_MISSING.";

const INTERNAL_WHO = "internal: an operator with `convex run`; no session, no caller check.";

/** `ProofSafe` (operations.ts:39): a person's personal Safe as the proof runner reads it back. */
const ProofSafe = Schema.Struct({
  authUserId: Schema.String,
  signerAddress: Schema.NullOr(Schema.String),
  smartAccountAddress: Schema.String,
  chainId: Schema.Number,
  deployedAt: Schema.NullOr(Schema.Number),
  deployTxHash: Schema.NullOr(Schema.String),
  claimedAt: Schema.NullOr(Schema.Number),
  claimTxHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

export const rpc_operator_identities_peek_otp = defineRpc({
  id: "operator.identities.peek-otp",
  title: "The pending sign-in code BetterAuth holds for an email",
  about:
    "Row `operator.identities.peekOtp`, registered as the public query `operator/identities:peekOtp`. The capability, " +
    "then Access's read of the newest unexpired code for the email, or null. It hands a live sign-in code to whoever " +
    "holds the capability secret, on any deployment that carries the secret. Access's read is admitted with no codes, " +
    "so any refusal it throws becomes UNKNOWN.",
  was: [`${CONVEX}:4`, `${OPS}/peek-otp.ts:9`, `${I}/reads.ts:60`, `${SRC}/access/sessions/reads.ts:103`, `${ROWS}:128`, ...CAPABILITY_WAS],
  concept: concept_operator,
  kind: "query",
  who: CAPABILITY_WHO,
  input: Schema.Struct({ email: Schema.String, capability: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      email: Schema.String,
      identifier: Schema.String,
      otp: Schema.String,
      expiresAt: Schema.NullOr(Schema.Number),
    }),
  ),
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_read_pending_proof_otp_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_identities_peek_smart_account = defineRpc({
  id: "operator.identities.peek-smart-account",
  title: "A person's personal Safe rows, with deploy and claim evidence",
  about:
    "Row `operator.identities.peekSmartAccount`, registered as the public query `operator/identities:peekSmartAccount`. " +
    "The capability, then Accounts' read of the person's Safe rows on every chain. Any refusal Accounts throws becomes " +
    "UNKNOWN.",
  was: [`${CONVEX}:5`, `${OPS}/peek-smart-account.ts:9`, `${I}/reads.ts:66`, `${SRC}/accounts/reads/proofs.ts:6`, `${ROWS}:142`, ...CAPABILITY_WAS],
  concept: concept_operator,
  kind: "query",
  who: CAPABILITY_WHO,
  input: Schema.Struct({ authUserId: Schema.String, capability: Schema.String }),
  output: Schema.Array(ProofSafe),
  errors: ROW_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_proof_smart_accounts_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_identities_seed_financial_ops_org = defineRpc({
  id: "operator.identities.seed-financial-ops-org",
  title: "Create a Solo Organization for a seeded identity",
  about:
    "Row `operator.identities.seedFinancialOpsOrg`, registered as the public mutation " +
    "`operator/identities:seedFinancialOpsOrg`. The capability, then it runs as the system actor `dev_identity` (the " +
    "seeded person is not the caller) and asks Organizations to create a Solo Organization on the identity's Safe chain " +
    "at the business clock's now, admitting INVALID_INPUT, PROFILE_NOT_FOUND and SMART_ACCOUNT_MISSING. Answers the " +
    "Organization's id, handle, Safe and chain.",
  was: [
    `${CONVEX}:8`,
    `${OPS}/seed-financial-ops-org.ts:11`,
    `${OPS}/seed-financial-ops-org.ts:16`,
    `${I}/writes.ts:26`,
    `${SRC}/organizations/setups/writes/organizations.ts:133`,
    `${ROWS}:149`,
    ...CAPABILITY_WAS,
  ],
  concept: concept_operator,
  kind: "mutation",
  who: CAPABILITY_WHO,
  input: Schema.Struct({
    authUserId: Schema.String,
    email: Schema.String,
    handle: Schema.String,
    name: Schema.String,
    capability: Schema.String,
  }),
  output: Schema.Struct({
    orgId: Schema.String,
    handle: Schema.String,
    safeAddress: Schema.String,
    chainId: Schema.Number,
  }),
  errors: [...ROW_ERRORS, error_PROFILE_NOT_FOUND, error_SMART_ACCOUNT_MISSING],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_seed_financial_proof_organization_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_identities_purge_account = defineRpc({
  id: "operator.identities.purge-account",
  title: "Remove the person behind an Account, unless history still names them",
  about:
    "The internal mutation `operator/identities:purgeAccount`. Reads the whole person first: every Account and Safe of " +
    "theirs (Accounts), their auth users' emails (Access) and each first Profile email (Profiles), and every Party a " +
    "Safe or email names (Parties); no Account answers `found: false`. Then fails closed: a Payment or Movement " +
    "attribution, a Party edge, an Organization tie, a member Safe's assignment, a request or Offer, or an owned " +
    "application each keeps the person, and the purge returns `refused` (WRONG_STATE serialized, naming the tables) and " +
    "writes nothing; the refusal is returned, not thrown (#2378), and the wide event records it with `reason_code`. " +
    "Otherwise each owner removes its own rows in this transaction: Profiles and photos, Parties and destinations, " +
    "native client grants, consents and sessions, OTP cooldowns and auth users, Accounts, Safes and welcome grants. " +
    "Returns how many rows each table lost (deep, Schema.Unknown). Every owner call is admitted with no codes.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/purge-account.ts:23`,
    `${OPS}/purge-account.ts:30`,
    `${OPS}/purge-account.ts:32`,
    `${OPS}/purge-account.ts:35`,
    `${OPS}/purge-account.ts:41`,
    `${I}/reads.ts:30`,
    `${I}/guards.ts:31`,
    `${I}/errors.ts:6`,
    `${I}/writes.ts:47`,
    `${SRC}/operator/README.md:261`,
  ],
  concept: concept_operator,
  kind: "mutation",
  who: INTERNAL_WHO,
  input: Schema.Struct({ accountId: Schema.String }),
  output: Schema.Struct({
    accountId: Schema.String,
    found: Schema.Boolean,
    authUserIds: Schema.Array(Schema.String),
    /** `serializeCapxulError` of the WRONG_STATE refusal, with `details.references`. */
    refused: Schema.optionalKey(Schema.Unknown),
    /** Rows each owner removed, by table. */
    removed: Schema.Unknown,
  }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_read_account_purge_target_in_tx,
    procedure_access_read_proof_auth_user_emails_in_tx,
    procedure_profiles_read_first_proof_profile_email_in_tx,
    procedure_parties_read_person_parties_in_tx,
    procedure_payments_read_account_ledger_references_in_tx,
    procedure_parties_read_party_references_in_tx,
    procedure_organizations_read_account_organization_references_in_tx,
    procedure_permissions_read_member_safe_references_in_tx,
    procedure_requests_read_person_request_references_in_tx,
    procedure_applications_read_owned_application_references_in_tx,
    procedure_profiles_purge_profiles_in_tx,
    procedure_parties_purge_account_parties_in_tx,
    procedure_access_remove_native_client_rows_in_tx,
    procedure_access_remove_proof_subject_access_in_tx,
    procedure_access_remove_proof_otp_rate_limit_in_tx,
    procedure_access_remove_proof_auth_email_in_tx,
    procedure_accounts_purge_account_rows_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_identities_purge_by_email = defineRpc({
  id: "operator.identities.purge-by-email",
  title: "The legacy purge of one email's proof rows",
  about:
    "The internal mutation `operator/identities:purgeByEmail`, with its original bounds and order: the email's OTP " +
    "cooldown row, then for each auth user of the email its first Profile, its first Safe and every consent, then the " +
    "BetterAuth user and sessions. It checks no history: Accounts, Payments and every other row naming the person stay. " +
    "Returns the normalized email, the auth user ids and the tables it removed from (`betterAuth:user` and " +
    "`betterAuth:session` are reported whenever an auth user was found, whether or not anything was deleted).",
  was: [`${CONVEX}:7`, `${OPS}/purge-by-email.ts:9`, `${I}/writes.ts:75`, `${I}/writes.ts:93`],
  concept: concept_operator,
  kind: "mutation",
  who: INTERNAL_WHO,
  input: Schema.Struct({ email: Schema.String }),
  output: Schema.Struct({
    email: Schema.String,
    authUserIds: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
  }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_remove_proof_otp_rate_limit_in_tx,
    procedure_access_read_proof_auth_user_ids_in_tx,
    procedure_profiles_remove_first_proof_profile_in_tx,
    procedure_accounts_remove_first_proof_safe_in_tx,
    procedure_access_remove_proof_subject_access_in_tx,
    procedure_access_remove_proof_auth_email_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
