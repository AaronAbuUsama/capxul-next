// The as-is book of the old indexing concept: the drifts area.
//
// Every operation registered at `indexing/drifts:*` (packages/backend/convex/indexing/drifts.ts).
// `reconcile` is the cron-driven internal action `reconcile indexer drift` (packages/backend/src/platform/
// jobs.ts:150), so it is a workflow; the six internal queries and mutations it runs through
// `ctx.runQuery` and `ctx.runMutation` are rpcs.
//
// Indexing owns only its lease row (`driftCycles`). The snapshots it compares and the rows it corrects
// are Organizations', Accounts', Permissions' and Payments', read and written through their doors: the
// rpcs invoke those procedures and list no neighbour table.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_indexing } from "../shared/foundation.ts";
import { integration_chain_rpc, integration_ponder } from "../shared/external.ts";
import { error_UNKNOWN, event_indexer_drift_corrected } from "../shared/vocabulary.ts";
import {
  procedure_accounts_read_reconciliation_account_in_tx,
  procedure_accounts_read_reconciliation_account_page_in_tx,
} from "../accounts/procedures.ts";
import {
  procedure_organizations_read_reconciliation_organization_in_tx,
  procedure_organizations_read_reconciliation_organization_page_in_tx,
  procedure_organizations_reconcile_member_authority_in_tx,
  procedure_organizations_record_safe_signers_in_tx,
} from "../organizations/procedures.ts";
import {
  procedure_payments_correct_payment_occurrences_in_tx,
  procedure_payments_read_included_payment_occurrences_in_tx,
} from "../payments/procedures.ts";
import {
  procedure_permissions_load_assignment_authority,
  procedure_permissions_reconcile_assignment_authority,
} from "../permissions/procedures.ts";
import { table_drift_cycles } from "./data.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/indexing/drifts.ts`;
const DR = `${SRC}/indexing/drifts`;
const OPS = `${DR}/operations`;

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

/** `ComparedInputs` (drifts/rules.ts:121): what a completed cycle compared. */
const Compared = Schema.Struct({
  head: Schema.Number,
  blockHash: Schema.optionalKey(Schema.String),
  mark: Schema.String,
});

/** `ScopePage` (drifts/reads.ts:53): one native page's comparable snapshots (deep, Schema.Unknown). */
const ScopePage = Schema.Struct({
  scopes: Schema.Array(Schema.Unknown),
  count: Schema.Number,
  isDone: Schema.Boolean,
  continueCursor: Schema.String,
});

/** `ReconcileDrift` (drifts/rules.ts:20): one corrected durable row. */
const Drift = Schema.Struct({
  projectionKind: Schema.Literals(["member_authority", "payment_settlement", "permission_assignment", "owners"]),
  previousState: Schema.String,
  currentState: Schema.String,
  previousBlock: Schema.optionalKey(Schema.Number),
  logicalEventId: Schema.optionalKey(Schema.String),
  referenceId: Schema.optionalKey(Schema.String),
});

/** `paymentOccurrenceValidator` (payments/model.ts:121): a Payment and the evidence row it consumed. */
const PaymentOccurrence = Schema.Unknown;

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/** organizationScopePage (drifts/reads.ts:106): the page, then each Organization's snapshot in one query. */
const ORGANIZATION_PAGE_INVOKES = [
  procedure_organizations_read_reconciliation_organization_page_in_tx,
  procedure_organizations_read_reconciliation_organization_in_tx,
  procedure_payments_read_included_payment_occurrences_in_tx,
  procedure_permissions_load_assignment_authority,
];
/** accountScopePage (drifts/reads.ts:123). */
const ACCOUNT_PAGE_INVOKES = [
  procedure_accounts_read_reconciliation_account_page_in_tx,
  procedure_accounts_read_reconciliation_account_in_tx,
  procedure_payments_read_included_payment_occurrences_in_tx,
];
/** correctOrganization (drifts/writes/corrections.ts:42). */
const ORGANIZATION_CORRECTION_INVOKES = [
  procedure_organizations_reconcile_member_authority_in_tx,
  procedure_permissions_reconcile_assignment_authority,
  procedure_organizations_record_safe_signers_in_tx,
  procedure_payments_correct_payment_occurrences_in_tx,
];

const SNAPSHOT_WAS = [`${DR}/reads.ts:50`, `${DR}/reads.ts:68`, `${DR}/reads.ts:86`, `${DR}/reads.ts:101`, `${DR}/rules.ts:71`];
const LEASE_WAS = [`${DR}/writes/leases.ts:21`, `${DR}/writes/leases.ts:29`, `${DR}/reads.ts:222`];

// ── rpcs ───────────────────────────────────────────────────────────────────────────────────

export const rpc_indexing_drifts_list_organizations = defineRpc({
  id: "indexing.drifts.list-organizations",
  title: "One native page of Organizations, with each snapshot the cycle compares",
  about:
    "The internal query `indexing/drifts:listOrganizations`. Organizations pages its rows 100 at a time; for each " +
    "Organization on the page, in the same query, it reads the reconciliation view (Safe, claiming members, stored " +
    "signers), Payments' included occurrences updated in the last 24 hours (wall time) and Permissions' assignment " +
    "authority. A snapshot with no claiming member, no such Payment and no assignment is dropped; `count` is the native " +
    "rows read. Every door call is admitted with no codes.",
  was: [`${CONVEX}:8`, `${OPS}/list-organizations.ts:9`, `${DR}/reads.ts:106`, ...SNAPSHOT_WAS],
  concept: concept_indexing,
  kind: "query",
  who: "internal: run by indexing.drifts.reconcile page by page (`organizationScopes`, drifts/reads.ts:158).",
  input: Schema.Struct({ cursor: Schema.optionalKey(Schema.String) }),
  output: ScopePage,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: ORGANIZATION_PAGE_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_drifts_list_accounts = defineRpc({
  id: "indexing.drifts.list-accounts",
  title: "One native page of Personal Accounts, with each snapshot the cycle compares",
  about:
    "The internal query `indexing/drifts:listAccounts`. Accounts pages the configured chain's Personal Accounts 100 at " +
    "a time; for each it reads the reconciliation view (its Safe) and Payments' included occurrences updated in the " +
    "last 24 hours. A Personal snapshot has no members and no assignments, so only a Payment keeps it. Every door call " +
    "is admitted with no codes.",
  was: [`${CONVEX}:7`, `${OPS}/list-accounts.ts:9`, `${DR}/reads.ts:123`, ...SNAPSHOT_WAS],
  concept: concept_indexing,
  kind: "query",
  who: "internal: run by indexing.drifts.reconcile page by page (`accountScopes`, drifts/reads.ts:167).",
  input: Schema.Struct({ cursor: Schema.optionalKey(Schema.String) }),
  output: ScopePage,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: ACCOUNT_PAGE_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_drifts_claim_cycle = defineRpc({
  id: "indexing.drifts.claim-cycle",
  title: "Claim the drift cycle's lease",
  about:
    "The internal mutation `indexing/drifts:claimCycle`. A lease another run holds (`leaseUntil` after now) answers " +
    "`claimed: false` and writes nothing. Otherwise it writes the token and a ten-minute lease (inserting the one row on " +
    "the first cycle) and answers what the last completed cycle compared. A successful claim writes no wide event of " +
    "its own; a refused claim records (ADR-0020 B1).",
  was: [`${CONVEX}:5`, `${OPS}/claim-cycle.ts:16`, `${OPS}/claim-cycle.ts:21`, `${DR}/writes/leases.ts:37`, `${DR}/writes/leases.ts:79`, ...LEASE_WAS],
  concept: concept_indexing,
  kind: "mutation",
  who: "internal: run by indexing.drifts.reconcile (`claimedCycle`, drifts/writes/leases.ts:107).",
  input: Schema.Struct({ token: Schema.String }),
  output: Schema.Union([
    Schema.Struct({ claimed: Schema.Literal(true), compared: Schema.optionalKey(Compared) }),
    Schema.Struct({ claimed: Schema.Literal(false) }),
  ]),
  errors: [error_UNKNOWN],
  reads: [table_drift_cycles],
  writes: [table_drift_cycles],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_drifts_close_cycle = defineRpc({
  id: "indexing.drifts.close-cycle",
  title: "Release the drift cycle's lease",
  about:
    "The internal mutation `indexing/drifts:closeCycle`. Only the run whose token holds the lease changes anything: it " +
    "clears the lease and, when `compared` is given (a completed cycle), replaces every `compared*` field. A lease that " +
    "expired and passed to another run answers false and writes nothing. A held release writes no wide event; a " +
    "release that found another run's lease records.",
  was: [`${CONVEX}:6`, `${OPS}/close-cycle.ts:16`, `${OPS}/close-cycle.ts:26`, `${DR}/writes/leases.ts:54`, `${DR}/writes/leases.ts:86`, ...LEASE_WAS],
  concept: concept_indexing,
  kind: "mutation",
  who: "internal: run by indexing.drifts.reconcile (`closedCycle`, drifts/writes/leases.ts:114), on success, skip and failure.",
  input: Schema.Struct({ token: Schema.String, compared: Schema.optionalKey(Compared) }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_drift_cycles],
  writes: [table_drift_cycles],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_drifts_apply_organization_corrections = defineRpc({
  id: "indexing.drifts.apply-organization-corrections",
  title: "Apply one Organization's proven corrections in one transaction",
  about:
    "The internal mutation `indexing/drifts:applyOrganizationCorrections`. Through each owner's door: confirmed members " +
    "are stamped holding their role and drifted members revoked (Organizations), each drifted assignment revoked " +
    "(Permissions), the Safe's signers recorded when given (Organizations), and the drifted Payments whose occurrence " +
    "the caller passed corrected (Payments; an id without an occurrence is dropped). Each owner re-reads the row it " +
    "corrects, so a snapshot a newer write overtook corrects nothing. Returns one drift per corrected durable row; a " +
    "Payroll run leaving its settled index is part of a Payment's correction, not another drift. Every door call is " +
    "admitted with no codes.",
  was: [`${CONVEX}:4`, `${OPS}/apply-organization-corrections.ts:11`, `${DR}/writes/corrections.ts:42`, `${DR}/writes/corrections.ts:67`, `${DR}/writes/corrections.ts:78`, `${DR}/writes/corrections.ts:89`],
  concept: concept_indexing,
  kind: "mutation",
  who: "internal: run by indexing.drifts.reconcile for an Organization scope with something to correct (drifts/writes/cycles.ts:91).",
  input: Schema.Struct({
    orgId: Schema.String,
    at: Schema.Number,
    confirmedMembers: Schema.Array(Schema.String),
    driftedMembers: Schema.Array(Schema.String),
    driftedPayments: Schema.Array(Schema.String),
    /** `assignmentAuthoritySnapshot` (permissions/views/snapshots): too deep to transcribe. */
    driftedAssignments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    paymentOccurrences: Schema.optionalKey(Schema.Array(PaymentOccurrence)),
    safeSigners: Schema.optionalKey(
      Schema.Struct({ owners: Schema.Array(Schema.String), threshold: Schema.Number, blockNumber: Schema.Number }),
    ),
  }),
  output: Schema.Array(Drift),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: ORGANIZATION_CORRECTION_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_drifts_apply_account_corrections = defineRpc({
  id: "indexing.drifts.apply-account-corrections",
  title: "Apply one Personal Account's proven Payment corrections",
  about:
    "The internal mutation `indexing/drifts:applyAccountCorrections`: Payments corrects the given occurrences in the " +
    "Account's scope, in one transaction, and returns one drift per corrected Payment. Admitted with no codes.",
  was: [`${CONVEX}:3`, `${OPS}/apply-account-corrections.ts:10`, `${DR}/writes/corrections.ts:100`],
  concept: concept_indexing,
  kind: "mutation",
  who: "internal: run by indexing.drifts.reconcile for an Account scope with something to correct (drifts/writes/cycles.ts:100).",
  input: Schema.Struct({ accountId: Schema.String, at: Schema.Number, paymentOccurrences: Schema.Array(PaymentOccurrence) }),
  output: Schema.Array(Drift),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_payments_correct_payment_occurrences_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflow ───────────────────────────────────────────────────────────────────────────────

export const workflow_indexing_drifts_reconcile = defineWorkflow({
  id: "indexing.drifts.reconcile",
  title: "Compare Convex's outcomes to the Ponder index and correct proven drift",
  about:
    "The internal action `indexing/drifts:reconcile`, the cron job `reconcile indexer drift` (every minute, registered " +
    "unconditionally), run as the system job `indexer_reconciler`. With COMMAND_FATE_READ_SOURCE unset or `rpc` it reads " +
    "and corrects nothing (`off`, a no-op tick). It claims the lease (another run's: `overlapping`, recorded), reads " +
    "the indexer head once, every Organization and Personal Account page, and the mark of their snapshots; when head, " +
    "the canonical block at an unmoved head and mark all equal the last completed cycle it skips. Otherwise each scope, " +
    "eight at a time, reads its bounded fact pages (role assignments and payments, five pages of 200, and the Safe " +
    "row), compares (an empty or capped assignment page revokes no member), proves each proposed loss against the " +
    "current canonical block, and sends at most one correction mutation, uninterruptible once sent; each corrected row " +
    "posts `indexer_drift_corrected`, attributed to its Organization when it has one. A completed cycle records what it compared; a " +
    "failed one releases the lease and records nothing. An indexer that will not answer fails the cycle " +
    "(PROVIDER_ERROR). Returns `skipped` with its reason or the corrected count. The same-height fork the indexer " +
    "cannot report stays invisible to the skip (README.md:135). Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:9`,
    `${OPS}/reconcile.ts:32`,
    `${OPS}/reconcile.ts:41`,
    `${OPS}/reconcile.ts:42`,
    `${OPS}/reconcile.ts:45`,
    `${OPS}/reconcile.ts:51`,
    `${OPS}/reconcile.ts:60`,
    `${SRC}/platform/jobs.ts:150`,
    `${DR}/external.ts:39`,
    `${DR}/external.ts:56`,
    `${DR}/external.ts:84`,
    `${DR}/external.ts:107`,
    `${DR}/external.ts:148`,
    `${DR}/external.ts:192`,
    `${DR}/reads.ts:214`,
    `${DR}/rules.ts:137`,
    `${DR}/rules.ts:207`,
    `${DR}/rules.ts:261`,
    `${DR}/rules.ts:267`,
    `${DR}/writes/cycles.ts:54`,
    `${DR}/writes/cycles.ts:87`,
    `${DR}/writes/cycles.ts:121`,
    `${DR}/events.ts:21`,
    `${DR}/events.ts:68`,
    `${DR}/events.ts:79`,
    `${SRC}/integrations/ponder/pages.ts:16`,
    `${SRC}/integrations/ponder/pages.ts:23`,
    `${SRC}/indexing/README.md:110`,
    `${SRC}/indexing/external.ts:11`,
  ],
  concept: concept_indexing,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job `indexer_reconciler`." },
    { name: "source", about: "COMMAND_FATE_READ_SOURCE unset or `rpc`: skipped `off`, a no-op tick." },
    { name: "claim", about: "Runs indexing.drifts.claim-cycle with a fresh ULID; another run's lease is skipped `overlapping`." },
    { name: "open", about: "Reads Ponder's head for Base Sepolia once; the cycle shares it, the indexer and the chain reader." },
    {
      name: "scopes",
      about: "Runs indexing.drifts.list-organizations, then list-accounts, for every native page, and hashes every snapshot into the mark.",
    },
    {
      name: "skip",
      about: "Reads the canonical block at the head only when the head has not moved; nothing moved closes the lease and skips.",
    },
    {
      name: "compare",
      about: "Per scope, eight at a time: fact pages, a pure comparison and a canonical-block proof of each proposed member, assignment or Payment loss.",
    },
    {
      name: "correct",
      about: "At most one mutation per scope (apply-organization-corrections or apply-account-corrections), then one `indexer_drift_corrected` per row.",
    },
    { name: "close", about: "Runs indexing.drifts.close-cycle with what it compared; a failure closes with nothing recorded." },
  ],
  reads: [table_drift_cycles],
  writes: [table_drift_cycles],
  drives: [],
  invokes: [...ORGANIZATION_PAGE_INVOKES, ...ACCOUNT_PAGE_INVOKES.slice(0, 2), ...ORGANIZATION_CORRECTION_INVOKES],
  emits: [event_indexer_drift_corrected],
  calls: [integration_ponder.c.head, integration_ponder.c.read, integration_chain_rpc.c.fetchBlockIdentity],
  chain: [],
  idempotency:
    "The lease (one run at a time), the skip when nothing moved, and each correction re-reading the row it corrects, so a second run corrects nothing new.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
