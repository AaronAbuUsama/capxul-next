// The old payroll concept's tables and the state machines that live on them, as the old code has
// them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/payroll/tables.ts, spread into packages/backend/convex/schema.ts:81.
// The README says payroll owns three tables (`payrollRuns`, `payrollItems`, `payrollGroups`); tables.ts
// defines eight. Machines: every status/state/lifecycle field with a literal union. Transitions are
// named to_<state>, one per target state; `from` lists every state an old write moves the field from.
// A birth (an insert) has no source state and is said in `about`; a write that leaves the field as it
// was (a self-loop) is not listed.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  event_payroll_agreement_transitioned,
  event_payroll_department_change_proposed,
  event_payroll_run_transitioned,
} from "../shared/vocabulary.ts";

const B = "packages/backend/src/payroll";
const T = `${B}/tables.ts`;
const SCHEMA = "packages/backend/convex/schema.ts:81";

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const Bool = Schema.Boolean;

/** `observationContextValidator` (packages/backend/src/platform/observation/validators.ts:4). */
const ObservationContext = Schema.Struct({
  application: opt(S),
  applicationId: opt(S),
  release: opt(S),
  sessionId: opt(S),
  organizationId: opt(S),
  journeyId: opt(S),
  correlationId: opt(S),
  anonymousId: opt(S),
  traceparent: opt(S),
});

const WRITE_STATES = ["awaiting_approval", "sent", "landed", "failed", "abandoned"] as const;
const Holder = Schema.Struct({ email: S, safe: S, label: S });
const Call = Schema.Struct({ to: S, data: S });

// ── runs ────────────────────────────────────────────────────────────────────────────────────

export const table_payroll_runs = defineTable({
  id: "payroll-runs",
  title: "Payroll runs: the run of record",
  about:
    "One row per authorized run (ADR-0022 R9, #1625). `runId` is `payroll_run_` + the sha256 of the request (version, " +
    "orgId, permissionId, asset, requestKey, period, items), so a replayed authorize finds the same row. `orgPartyId` is " +
    "the employer: the Organization's claimed Party, not its orgId. The run maps onto the shipped Payment command " +
    "lifecycle: `draft` while prepared, `authorized` once its signed UserOperation is submitted, `settled` when the last " +
    "Payment of its own command settles; Payments drives both moves inside its own transactions through payroll's door. " +
    "`batchRef` is the `paymentCommands.commandId` the run's transaction prepared. `settledAt` is stamped only by the " +
    "settle flip and cleared by the un-settle flip, so `updatedAt` never re-dates a run inside the month aggregate. " +
    "Periods and times are epoch ms; an instant run has start equal to end.",
  was: [`${T}:167`, `${T}:159`, `${B}/runs/rules/admission.ts:72`, `${B}/runs/writes/runs.ts:197`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgPartyId",
  scope: "The tenant column holds the Organization's claimed Party id (organizations' readOrganizationPartyIdInTx), not the orgId.",
  fields: Schema.Struct({
    runId: S,
    orgPartyId: S,
    assetId: S,
    periodStart: N,
    periodEnd: N,
    status: Schema.Literals(["draft", "authorized", "settled"]),
    batchRef: opt(S),
    settledAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["runId"],
  indexes: [
    {
      name: "by_run_id",
      fields: ["runId"],
      for: "One run by id: runByIdInTx (runs/reads/runs.ts:17) for prepare, replay and progression; organizationRun collects it to refuse a duplicate (runs/reads/details.ts:30).",
    },
    {
      name: "by_org_party_created",
      fields: ["orgPartyId", "createdAt"],
      for: "One page of an employer's runs, newest first (runsOf, runs/reads/runs.ts:64).",
    },
    {
      name: "by_org_party_settled",
      fields: ["orgPartyId", "settledAt"],
      for: "Every run of an employer settled since the start of this calendar month, for \"Paid This Month\" (runs/reads/runs.ts:78).",
    },
  ],
  retention: KEPT,
});

export const table_payroll_items = defineTable({
  id: "payroll-items",
  title: "Payroll items: one per person a run pays",
  about:
    "One row per person paid by a run (ADR-0022 R9). `net = gross + sum(adjustments)` (R8) and `net` equal to the exact raw " +
    "units of the run's asset are checked before the row is written (admitRun), so a stored row adds up. Fiat figures are " +
    "minor-unit strings; `amountValue` is the settlement quantity as a decimal string of the run's asset. " +
    "`engagementEdgeId` is the Parties `employed` edge the run paid through. Inserted only with a new run, in item order; " +
    "never patched.",
  was: [`${T}:189`, `${B}/runs/writes/runs.ts:177`, `${B}/runs/rules/admission.ts:38`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  scope: "No tenant column: an item belongs to the Organization of its run, through runId to payroll-runs.orgPartyId.",
  fields: Schema.Struct({
    runId: S,
    engagementEdgeId: S,
    gross: S,
    adjustments: Schema.Array(Schema.Struct({ label: S, amount: S })),
    net: S,
    amountValue: S,
    createdAt: N,
  }),
  key: ["runId", "engagementEdgeId"],
  indexes: [
    {
      name: "by_run",
      fields: ["runId"],
      for: "A run's items: its total and recipient count (wireRun), and the stored membership a run detail is proven against (runs/reads/runs.ts:24).",
    },
  ],
  retention: KEPT,
});

// ── groups ──────────────────────────────────────────────────────────────────────────────────

export const table_payroll_groups = defineTable({
  id: "payroll-groups",
  title: "Payroll groups: saved rosters an employer pays again",
  about:
    "A saved roster the run composer prefills (PAYROLL #1626), replacing a browser-local record no other member could see. " +
    "`groupId` is `payroll_group_` + a ULID. A member is a Party id, never an email (ruling Q1); `amount` is the " +
    "employer's typed text, not minor units, and is not checked. The name is trimmed and non-empty and members are " +
    "deduped by Party before the write. A group is found only through its Organization. `tone` is a display preference " +
    "the app narrows to its own union.",
  was: [`${T}:198`, `${T}:211`, `${B}/groups/writes.ts:29`, `${B}/groups/rules.ts:17`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    groupId: S,
    orgId: S,
    name: S,
    tone: S,
    members: Schema.Array(Schema.Struct({ partyId: S, amount: S, currency: S })),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["groupId"],
  indexes: [
    {
      name: "by_org",
      fields: ["orgId"],
      for: "An Organization's groups, oldest first, and the save and remove lookup, which scans them for the group id (groups/reads.ts:9, :21).",
    },
  ],
  retention: "A group is deleted when a member removes it (groups/writes.ts:77); otherwise kept indefinitely.",
});

// ── departments ─────────────────────────────────────────────────────────────────────────────

export const table_payroll_departments = defineTable({
  id: "payroll-departments",
  title: "Payroll departments: a budget its holders pay from",
  about:
    "A department (ADR-0040 departments amendment): what the chain cannot name about it. `departmentId` is `dep_` + a ULID; " +
    "`slug` is the key commands take (its keccak256 is the PayrollDepartments id on chain). Before v4, `budgets` holds one " +
    "yearly budget per token (lower case, raw units) on the PayrollDepartments contract and the holders hold its Roles role; " +
    "on Protocol v4 the department is one top budget in Budgets: `hat` is its office hat (decimal uint256), each line keeps " +
    "its own `period`, and `budgetId` is the top budget's id once a read, the first offer or a budget set finds it. " +
    "`closed` is set when a v4 close executes and cleared by a reopen. `proposed` until the Directors' create proposal " +
    "executes; `abandoned` when it never will. A payment from a v4 department reads it through readDepartmentSpendInTx " +
    "(CAP-1165).",
  was: [`${T}:220`, `${T}:227`, `${B}/departments/writes.ts:108`, `${B}/departments/rules.ts:64`, `${B}/departments/reads/spend.ts:28`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    departmentId: S,
    orgId: S,
    name: S,
    slug: S,
    status: Schema.Literals(["proposed", "active", "abandoned"]),
    budgets: Schema.Array(Schema.Struct({ token: S, budget: S, period: opt(Schema.Literals(["year", "quarter", "month"])) })),
    holders: Schema.Array(Holder),
    hat: opt(S),
    budgetId: opt(S),
    closed: opt(Bool),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["departmentId"],
  indexes: [
    {
      name: "by_department",
      fields: ["departmentId"],
      for: "One department by id: settling a change, keeping a budget id, an offer's budget id and the notice facts (departments/writes.ts:146, :241; writes/budget-ids.ts:14).",
    },
    {
      name: "by_org_slug",
      fields: ["orgId", "slug"],
      for: "An Organization's departments (readDepartmentsInTx, departments/reads.ts:30), and whether a create's slug is taken (departments/writes.ts:155).",
    },
  ],
  retention: KEPT,
});

export const table_payroll_department_changes = defineTable({
  id: "payroll-department-changes",
  title: "Payroll department changes: one Director proposal each",
  about:
    "One write the Directors proposed for a department, or for a token's payout ceiling (no `departmentId`). `changeId` is " +
    "`dep_change_` + a ULID and is the subject of the organizations proposal that carries it. It applies when that " +
    "proposal executes and ends `abandoned` when it is rejected or replaced; every department action settles waiting " +
    "changes in nonce order before it answers. `enablesToken` marks a first budget in a token the payout role does not pay " +
    "in yet (its proposal rewrites the role's send condition). A freeze keeps what it replaced in `restore` (raw units and " +
    "Unix seconds) so an unfreeze can put it back.",
  was: [`${T}:261`, `${T}:264`, `${B}/departments/writes.ts:186`, `${B}/departments/writes.ts:209`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    changeId: S,
    orgId: S,
    departmentId: opt(S),
    kind: Schema.Literals([
      "create",
      "setBudget",
      "addHolder",
      "removeHolder",
      "setCeiling",
      "freezeCeiling",
      "unfreezeCeiling",
      "close",
      "reopen",
    ]),
    token: opt(S),
    enablesToken: opt(Bool),
    budget: opt(S),
    holder: opt(Holder),
    ceiling: opt(S),
    restore: opt(Schema.Struct({ amount: S, left: S, leave: S, timestamp: S })),
    state: Schema.Literals(["proposed", "applied", "abandoned"]),
    proposalId: S,
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["changeId"],
  indexes: [
    {
      name: "by_change",
      fields: ["changeId"],
      for: "One change by id: settling it (departments/writes.ts:232) and its holder notice facts (departments/reads/notices.ts:17).",
    },
    {
      name: "by_org_state",
      fields: ["orgId", "state"],
      for: "An Organization's waiting changes (conflicts, settling, holder Safes) and applied ones (v4 creations, the last freeze) (departments/reads.ts:42, :149, :183).",
    },
  ],
  retention: KEPT,
});

// ── agreements ──────────────────────────────────────────────────────────────────────────────

export const table_payroll_agreements = defineTable({
  id: "payroll-agreements",
  title: "Payroll agreements: a holder's offer and its last write",
  about:
    "One payment agreement a department holder offered (slice 08), and what the chain cannot name about it: the " +
    "department, the payee's email and name (or, Payee A, the payee Organization and handle), who offered it, its terms " +
    "document, and the holder's last write. The contract's `agreementOf` is what reads show for rate, acceptance, pause " +
    "and end; this row keeps the terms as offered. `agreementId` is `ag_` + a ULID; `chainAgreementId` is the contract's " +
    "uint256 once the offer lands. `token` is lower case for its life (CAP-1012); `rate` is raw units per `period`; " +
    "`startsAt`/`endsAt`/`offerExpiresAt` are Unix seconds (0: from acceptance, open-ended); `pausedAt` is the landed pause " +
    "block's time in Unix ms. `lastWrite` is the holder's write (offer, withdraw, change, cancelChange, pause, resume, " +
    "end) with its approval, call and state; `earlierWrites` keeps at most 20 replaced writes so their approvals still read " +
    "an outcome. `lastWrite.observationContext` is Schema.Unknown here: it is observationContextValidator.",
  was: [`${T}:6`, `${T}:38`, `${T}:55`, `${T}:298`, `${T}:305`, `${B}/agreements/writes/records.ts:40`, `${B}/agreements/writes/records.ts:79`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  scope: "orgId is the paying Organization. The payee (a person's personal Safe, or a payee Organization's Safe) reads it across tenants through by_payee.",
  fields: Schema.Struct({
    agreementId: S,
    orgId: S,
    departmentId: S,
    slug: S,
    chainId: N,
    safeAddress: S,
    kind: Schema.Literals(["salary", "stream", "retainer", "fixed_term"]),
    payee: Schema.Struct({ address: S, email: opt(S), label: opt(S), orgId: opt(S), handle: opt(S) }),
    offeredBy: Schema.Struct({ address: S, label: opt(S), authUserId: S }),
    token: S,
    rate: S,
    period: Schema.Literals(["year", "month", "week"]),
    release: Schema.Literals(["1mo", "7d", "1d", "1s"]),
    startsAt: N,
    endsAt: N,
    offerExpiresAt: N,
    reserved: S,
    terms: Schema.Struct({ documentId: S, hash: S, content: S }),
    lifecycle: Schema.Literals(["prepared", "onChain", "abandoned"]),
    chainAgreementId: opt(S),
    endSet: opt(Bool),
    withdrawn: opt(Bool),
    pausedAt: opt(N),
    txHash: opt(S),
    lastWrite: opt(
      Schema.Struct({
        writeId: S,
        action: Schema.Literals(["offer", "withdraw", "change", "cancelChange", "pause", "resume", "end"]),
        approvalId: S,
        state: Schema.Literals(WRITE_STATES),
        reservedBefore: S,
        expiresAt: N,
        userOpHash: opt(S),
        txHash: opt(S),
        roleCall: Call,
        authUserId: opt(S),
        observationContext: opt(Schema.Unknown),
      }),
    ),
    earlierWrites: opt(
      Schema.Array(
        Schema.Struct({
          writeId: S,
          approvalId: S,
          state: Schema.Literals(["landed", "failed", "abandoned", "dropped", "replaced"]),
        }),
      ),
    ),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["agreementId"],
  indexes: [
    {
      name: "by_agreement",
      fields: ["agreementId"],
      for: "One agreement by id, in any Organization: readAgreementInTx, the next write and its submission (agreements/reads/rows.ts:24, writes/records.ts:65).",
    },
    {
      name: "by_org_department",
      fields: ["orgId", "departmentId"],
      for: "Every agreement of an Organization (only orgId is matched): the context, settling sent writes, the sweep of one Organization (rows.ts:15, records.ts:222).",
    },
    {
      name: "by_payee",
      fields: ["payee.address"],
      crossTenant: true,
      for: "The agreements that pay one Safe, from every Organization: a person payee's list (slice 09) and an Organization payee's (Payee A) (rows.ts:36).",
    },
  ],
  retention: KEPT,
});

export const table_payroll_agreement_payee_writes = defineTable({
  id: "payroll-agreement-payee-writes",
  title: "Payroll agreement payee writes: each accept or collect",
  about:
    "A payee's accept or collect (slice 09), one row per write, so an agreement keeps every collection with its release " +
    "window and its Payment. `writeId` is `aw_` + a ULID. A person's write signs through an approval (`approvalId`); an " +
    "Organization payee's (Payee A, `payeeOrgId`) names the Director proposal on its Safe (`sp_…`) that carries the call. " +
    "A collection keeps its amount and window (Unix seconds), `remainderOwed` when the payout ceiling split it, and once " +
    "landed its Payments V3 `settlementId`, the `paymentId` payments recorded for it and `landedAt` (block time, Unix ms). " +
    "A write still waiting for its approval is abandoned when the payee makes the next one. `observationContext` is " +
    "Schema.Unknown here: it is observationContextValidator.",
  was: [`${T}:112`, `${T}:113`, `${T}:310`, `${T}:313`, `${B}/agreements/writes/payees.ts:40`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  scope: "orgId is the paying Organization; authUserId and payeeSafe name the payee person, payeeOrgId a payee Organization.",
  fields: Schema.Struct({
    writeId: S,
    agreementId: S,
    orgId: S,
    chainId: N,
    authUserId: S,
    payeeSafe: S,
    action: Schema.Literals(["accept", "collect"]),
    approvalId: S,
    payeeOrgId: opt(S),
    state: Schema.Literals(WRITE_STATES),
    expiresAt: N,
    call: Call,
    userOpHash: opt(S),
    txHash: opt(S),
    amount: opt(S),
    periodStart: opt(N),
    periodEnd: opt(N),
    remainderOwed: opt(S),
    settlementId: opt(S),
    paymentId: opt(S),
    landedAt: opt(N),
    observationContext: opt(ObservationContext),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["writeId"],
  indexes: [
    {
      name: "by_write",
      fields: ["writeId"],
      for: "One payee write by id: its submission, its clearing, settling it, following its proposal and an approval's outcome (agreements/writes/payees.ts:65, reads/rows.ts:60).",
    },
    {
      name: "by_agreement",
      fields: ["agreementId", "createdAt"],
      for: "Every payee write on one agreement, oldest first (readPayeeWritesInTx, agreements/reads/rows.ts:48; writesOf, writes/payees.ts:28).",
    },
    {
      name: "by_settlement",
      fields: ["settlementId"],
      for: "No query in the old code uses it (a gap): defined at tables.ts:316 only.",
    },
  ],
  retention: KEPT,
});

export const table_payroll_agreement_notices = defineTable({
  id: "payroll-agreement-notices",
  title: "Payroll agreement notices: each notice claimed once",
  about:
    "One agreement notice claimed before it is sent (G5), so each is sent once: `ready:<period>:<agreementId>` (pay ready " +
    "in one release period), `reminder:<agreementId>` (a fixed term's last week), `ended:<agreementId>` (an ended " +
    "agreement's last pay) and `low_balance:<orgId>:<token>` (a Safe short of what its payees can collect). `sentAt` is " +
    "when it was claimed, before the send. A low-balance key is deleted once the Safe holds enough again, or nothing is " +
    "owed in the token, so it can alert again.",
  was: [`${T}:317`, `${T}:323`, `${B}/agreements/writes/sweeps.ts:22`, SCHEMA],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({ key: S, orgId: S, sentAt: N }),
  key: ["key"],
  indexes: [
    {
      name: "by_key",
      fields: ["key"],
      for: "Whether a notice key is claimed, and the rows of a cleared key to delete (claimNoticesInTx, agreements/writes/sweeps.ts:22).",
    },
  ],
  retention: "Kept indefinitely, except a low_balance key, which is deleted when its condition clears (agreements/writes/sweeps.ts:46).",
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_payroll_run = defineMachine({
  id: "payroll-run",
  title: "Payroll run status",
  about:
    "payrollRuns.status, on the shipped Payment command lifecycle. Payroll writes the birth; Payments moves the run in its " +
    "own transactions through payroll's door: the submission choke point advances it, the settle paths settle it, and a " +
    "drift correction that removes a Payment's indexed fact returns it. The settle flip refuses only an already settled " +
    "run or one with no batchRef, so a draft run whose command's Payments all settled would settle without passing " +
    "authorized. No state is terminal: a settled run goes back to authorized after a reorg.",
  was: [`${T}:173`, `${B}/runs/writes/progression.ts:24`, `${B}/runs/writes/progression.ts:51`, `${B}/runs/writes/progression.ts:72`],
  table: table_payroll_runs,
  field: "status",
  initial: "draft",
  states: [
    { id: "draft", about: "Prepared with its items and Payment batch; its UserOperation not yet submitted." },
    { id: "authorized", about: "The signed UserOperation of its command was submitted, or a settlement was undone." },
    { id: "settled", about: "Every Payment of its own command (batchRef) settled; settledAt is stamped." },
  ],
  transitions: {
    to_draft: {
      from: [],
      to: "draft",
      about:
        "Inserted draft by ensureRun (runs/writes/runs.ts:209). bindRun then schedules payroll_run_transitioned `prepared` for a new run (runs.ts:271), which reports only when the batch facts are found.",
      emits: [event_payroll_run_transitioned],
    },
    to_authorized: {
      from: ["draft", "settled"],
      to: "authorized",
      about:
        "advanceRunsToAuthorized from the submission write (progression.ts:36) schedules `authorized`; returnRunToAuthorized (progression.ts:80) clears settledAt and reports nothing.",
      guard: "Only a draft run advances; only a settled run returns. Each needs the Payment's payrollRunId.",
      emits: [event_payroll_run_transitioned],
    },
    to_settled: {
      from: ["draft", "authorized"],
      to: "settled",
      about: "settleRunForSettledPayment (progression.ts:61) stamps settledAt, schedules `settled` and the run's payment emails (payroll.runs.notify).",
      guard: "Not settled already, a batchRef, and payments' isPayrollBatchSettledInTx: every Payment of that command found under the run and settled.",
      emits: [event_payroll_run_transitioned],
    },
  },
});

export const machine_payroll_department = defineMachine({
  id: "payroll-department",
  title: "Payroll department status",
  about:
    "payrollDepartments.status. A create inserts the department `proposed` with its change; settling the change applies " +
    "or abandons it when the Directors' proposal executes, or is rejected or replaced. Other changes patch budgets, " +
    "holders and `closed` without moving the status.",
  was: [`${T}:232`, `${B}/departments/writes.ts:175`, `${B}/departments/writes.ts:248`, `${B}/departments/writes.ts:251`, `${B}/departments/rules.ts:67`],
  table: table_payroll_departments,
  field: "status",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Its create proposal waits for the Directors." },
    { id: "active", about: "Its create proposal executed: the department exists on chain." },
    { id: "abandoned", about: "Its create proposal was rejected or replaced; reads leave it out and its slug is free again.", terminal: true },
  ],
  transitions: {
    to_proposed: {
      from: [],
      to: "proposed",
      about: "Inserted by recordDepartmentProposalInTx with its create change and Director proposal (departments/writes.ts:175).",
      emits: [],
    },
    to_active: {
      from: ["proposed"],
      to: "active",
      about: "appliedDepartment of an applied create sets it active (rules.ts:67), written by settleChangeInTx (writes.ts:251).",
      guard: "The create change's proposal executed, settled in nonce order.",
      emits: [],
    },
    to_abandoned: {
      from: ["proposed"],
      to: "abandoned",
      about: "An abandoned create change abandons its department (writes.ts:248).",
      guard: "The create change's proposal was rejected or replaced.",
      emits: [],
    },
  },
});

export const machine_payroll_department_change = defineMachine({
  id: "payroll-department-change",
  title: "Payroll department change state",
  about:
    "payrollDepartmentChanges.state. A change is born `proposed` with its Director proposal and settled once, by the " +
    "proposal's status as organizations last read it from the chain: executed applies it, rejected or replaced abandons " +
    "it, awaiting approvals leaves it. Settling stamps settledAt.",
  was: [`${T}:291`, `${B}/departments/writes.ts:186`, `${B}/departments/writes.ts:238`, `${B}/departments/rules.ts:100`],
  table: table_payroll_department_changes,
  field: "state",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Its Director proposal waits for approvals." },
    { id: "applied", about: "Its proposal executed; the department was patched and an applied create or holder change schedules holder emails.", terminal: true },
    { id: "abandoned", about: "Its proposal was rejected or replaced.", terminal: true },
  ],
  transitions: {
    to_proposed: {
      from: [],
      to: "proposed",
      about: "Inserted by recordDepartmentProposalInTx (departments/writes.ts:186); payroll.departments.record then schedules payroll_department_change_proposed (record.ts:99).",
      emits: [event_payroll_department_change_proposed],
    },
    to_applied: {
      from: ["proposed"],
      to: "applied",
      about: "settleChangeInTx (writes.ts:238); a create, addHolder or removeHolder schedules payroll.departments.notify (writes/notices.ts:18).",
      guard: "The carrying proposal's status is executed.",
      emits: [],
    },
    to_abandoned: {
      from: ["proposed"],
      to: "abandoned",
      about: "settleChangeInTx (writes.ts:238).",
      guard: "The carrying proposal's status is rejected or replaced.",
      emits: [],
    },
  },
});

export const machine_payroll_agreement = defineMachine({
  id: "payroll-agreement",
  title: "Payroll agreement lifecycle",
  about:
    "payrollAgreements.lifecycle: whether the contract has the offer. An offer is born `prepared` with its first write; " +
    "settling that write's receipt makes it `onChain` only when the receipt carries its `offered` event, and `abandoned` " +
    "when the offer failed, its receipt carried no `offered` event, its approval lapsed unsent, or its sent operation " +
    "lapsed with no receipt. Later writes (withdraw, end, pause) set flags, not the lifecycle.",
  was: [`${T}:96`, `${B}/agreements/writes/records.ts:49`, `${B}/agreements/writes/records.ts:157`, `${B}/agreements/writes/records.ts:270`],
  table: table_payroll_agreements,
  field: "lifecycle",
  initial: "prepared",
  states: [
    { id: "prepared", about: "The offer's approval is open or its operation sent; nothing on chain yet." },
    { id: "onChain", about: "The contract holds the agreement under chainAgreementId.", terminal: true },
    { id: "abandoned", about: "The offer never reached the chain.", terminal: true },
  ],
  transitions: {
    to_prepared: {
      from: [],
      to: "prepared",
      about: "Inserted by recordWriteInTx with the offer's write (agreements/writes/records.ts:54).",
      emits: [],
    },
    to_onChain: {
      from: ["prepared"],
      to: "onChain",
      about: "landed() of an offer whose receipt carries `offered` (records.ts:172), written by settleWritesInTx (records.ts:240), which schedules payroll_agreement_transitioned `offered` and the offer letter.",
      emits: [event_payroll_agreement_transitioned],
    },
    to_abandoned: {
      from: ["prepared"],
      to: "abandoned",
      about: "A landed offer with no `offered` event (records.ts:170); a failed receipt, a lapsed sent operation or a lapsed approval (settledPatch, records.ts:283, :290, :296).",
      emits: [],
    },
  },
});

export const machine_payroll_agreement_write = defineMachine({
  id: "payroll-agreement-write",
  title: "Payroll agreement holder write state",
  about:
    "payrollAgreements.lastWrite.state: the holder's latest write on the agreement. A new write replaces the last one " +
    "unless it is `sent` (WRONG_STATE writeInFlight); the replaced write moves to earlierWrites (an unsent one as " +
    "`replaced`, an abandoned sent one as `dropped`). Replacing a write still `awaiting_approval` with another is a " +
    "self-loop on the field and is not listed. A write lands only when its receipt carries its own event for this " +
    "agreement; a receipt that says success without it fails the write.",
  was: [`${T}:19`, `${B}/agreements/writes/records.ts:40`, `${B}/agreements/writes/records.ts:100`, `${B}/agreements/writes/records.ts:128`, `${B}/agreements/writes/records.ts:270`],
  table: table_payroll_agreements,
  field: "lastWrite.state",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Its approval is open; nothing is sent." },
    { id: "sent", about: "Its operation hash is noted and the operation handed to the bundler; its receipt decides." },
    { id: "landed", about: "Its receipt carries the write's own event: the contract applied it." },
    { id: "failed", about: "The chain refused it, or its receipt lacked its own event." },
    { id: "abandoned", about: "Its approval lapsed unsent, or its sent operation never reached the chain before its sponsorship ran out." },
  ],
  transitions: {
    to_awaiting_approval: {
      from: ["sent", "landed", "failed", "abandoned"],
      to: "awaiting_approval",
      about:
        "Born with an offer (records.ts:45); the next write on an agreement replaces a landed, failed or abandoned one (records.ts:71); clearSubmissionInTx hands back a sent write the bundler refused and does not hold (records.ts:150).",
      guard: "A sent write is never replaced (writeInFlight); a clear needs the same writeId and userOpHash.",
      emits: [],
    },
    to_sent: {
      from: ["awaiting_approval"],
      to: "sent",
      about: "recordSubmissionInTx notes the hash before the send (records.ts:118); the same hash again writes nothing.",
      guard: "Same writeId; anything but awaiting_approval is WRONG_STATE staleWrite.",
      emits: [],
    },
    to_landed: {
      from: ["sent"],
      to: "landed",
      about: "settleWritesInTx (records.ts:240) by landed() (records.ts:160): schedules payroll_agreement_transitioned and the payee's notice (none for withdraw or cancelChange).",
      guard: "The receipt carries the write's own event for this chainAgreementId (an offer: `offered`).",
      emits: [event_payroll_agreement_transitioned],
    },
    to_failed: {
      from: ["sent"],
      to: "failed",
      about: "A failed receipt (settledPatch, records.ts:289) or a landed one without its own event (records.ts:169, :186).",
      emits: [],
    },
    to_abandoned: {
      from: ["awaiting_approval", "sent"],
      to: "abandoned",
      about: "A lapsed approval (records.ts:295) or a sent operation still pending once its sponsorship and grace lapsed (records.ts:282).",
      emits: [],
    },
  },
});

export const machine_payroll_agreement_payee_write = defineMachine({
  id: "payroll-agreement-payee-write",
  title: "Payroll agreement payee write state",
  about:
    "payrollAgreementPayeeWrites.state: a payee's accept or collect. A person's write is sent from its approval; an " +
    "Organization payee's (Payee A) becomes `sent` when the Director proposal carrying it executes, with that execution's " +
    "hash, and never lapses on time. A landed collect births its collection Payment through payments' door.",
  was: [`${T}:127`, `${B}/agreements/writes/payees.ts:40`, `${B}/agreements/writes/payees.ts:167`, `${B}/agreements/writes/payees.ts:231`, `${B}/agreements/writes/organization-payees.ts:62`],
  table: table_payroll_agreement_payee_writes,
  field: "state",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Its approval, or for an Organization payee its Director proposal, is open." },
    { id: "sent", about: "Its operation hash is noted; its receipt decides." },
    { id: "landed", about: "Its receipt carries `accepted` or `collected` for this agreement.", terminal: true },
    { id: "failed", about: "The chain refused it, or its receipt lacked its own event.", terminal: true },
    { id: "abandoned", about: "Replaced by the payee's next write, lapsed, or its proposal rejected or replaced.", terminal: true },
  ],
  transitions: {
    to_awaiting_approval: {
      from: ["sent"],
      to: "awaiting_approval",
      about: "Inserted awaiting_approval (payees.ts:60); clearPayeeSubmissionInTx hands back a sent write the bundler refused (payees.ts:149).",
      guard: "A new write is refused while another is sent (payeeWriteInFlight).",
      emits: [],
    },
    to_sent: {
      from: ["awaiting_approval"],
      to: "sent",
      about: "recordPayeeSubmissionInTx (payees.ts:80); an Organization payee's executed proposal (organization-payees.ts:82).",
      emits: [],
    },
    to_landed: {
      from: ["sent"],
      to: "landed",
      about: "settleSent (payees.ts:207): a collect births its Payment first; schedules payroll_agreement_transitioned and the accepted or collected notice.",
      guard: "The receipt carries the write's own event for this chainAgreementId.",
      emits: [event_payroll_agreement_transitioned],
    },
    to_failed: {
      from: ["sent"],
      to: "failed",
      about: "A failed receipt or one without its own event (payees.ts:187); a failed collect schedules collection_refused with TRANSACTION_FAILED.",
      emits: [],
    },
    to_abandoned: {
      from: ["awaiting_approval", "sent"],
      to: "abandoned",
      about:
        "The payee's next write abandons a waiting one (payees.ts:52); a person's lapsed approval or lapsed sent operation (payees.ts:255, :263); a rejected or replaced proposal (organization-payees.ts:90).",
      emits: [],
    },
  },
});
