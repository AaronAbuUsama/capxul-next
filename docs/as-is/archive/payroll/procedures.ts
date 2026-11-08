// The payroll concept's own door, as it is: every function packages/backend/src/payroll/index.ts
// exports that runs inside its caller's Convex transaction (it takes the caller's QueryCtx or
// MutationCtx). Other concepts import them by subpath (`#payroll/runs/writes/progression`,
// `#payroll/departments/reads`, `#payroll/departments/reads/spend`, `#payroll/agreements/reads/rows`),
// never through the door file. The door's pure rule `isDepartmentId` (a `dep_` prefix test) is not a
// procedure and is not booked.
//
// The progression procedures call back into payments' own door (`isPayrollBatchSettledInTx`,
// `readOrganizationPaymentBatchFactsInTx`). That call is named in `about` and not linked: payments'
// procedures invoke these, so a link back would be a circular import. Reads and writes list the
// payroll tables each touches; none touches another concept's table directly.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { event_payroll_run_transitioned } from "../shared/vocabulary.ts";
import {
  machine_payroll_run,
  table_payroll_agreement_payee_writes,
  table_payroll_agreements,
  table_payroll_department_changes,
  table_payroll_departments,
  table_payroll_runs,
} from "./data.ts";

const B = "packages/backend/src/payroll";
const DOOR = `${B}/index.ts`;
const PAY = "packages/backend/src/payments";

const opt = Schema.optionalKey;
const S = Schema.String;

const none = { drives: [], invokes: [], emits: [] } as const;

// ── runs: the progression Payments drives ───────────────────────────────────────────────────

export const procedure_payroll_advance_runs_to_authorized = defineProcedure({
  id: "payroll.advance-runs-to-authorized",
  title: "Advance submitted payroll runs to authorized",
  about:
    "The submit flip, called from payments' one submission choke point (recordSubmission): the distinct defined run ids " +
    "are read together and every run still `draft` becomes `authorized` (`updatedAt` now, backendNow). Each advanced run " +
    "schedules payroll_run_transitioned `authorized` through scheduleRunTransitionInTx, which reads the run's batch facts " +
    "through payments' own door `readOrganizationPaymentBatchFactsInTx` (not linked) and schedules nothing for a run with " +
    "no batchRef or no batch facts; the command's own person and observation context win. An unknown or non-draft run " +
    "is skipped, so a replayed submission writes and reports nothing. No error of its own.",
  was: [
    `${DOOR}:6`,
    `${B}/runs/writes/progression.ts:24`,
    `${B}/runs/writes/progression.ts:36`,
    `${B}/runs/writes/progression.ts:38`,
    `${B}/runs/events.ts:54`,
    `${B}/runs/events.ts:64`,
    `${B}/runs/reads/runs.ts:17`,
    `${PAY}/verifications/writes/submissions.ts:131`,
  ],
  concept: concept_payroll,
  input: Schema.Struct({ payrollRunIds: Schema.Array(Schema.UndefinedOr(S)) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  drives: [machine_payroll_run.t.to_authorized],
  invokes: [],
  emits: [event_payroll_run_transitioned],
});

export const procedure_payroll_settle_run_for_settled_payment = defineProcedure({
  id: "payroll.settle-run-for-settled-payment",
  title: "Settle a payroll run when its last Payment settles",
  about:
    "The settle flip, run once per settled Payment by payments' settle paths (indexed settlement, verified send, claim, " +
    "commitment, bank rail). A Payment with no payrollRunId, an unknown run, a run already settled or one with no " +
    "batchRef returns. Otherwise it asks payments' own door `isPayrollBatchSettledInTx` (not linked) whether every Payment " +
    "of the run's own command is found under the run and settled; `payments.payrollRunId` is lineage, not membership. If " +
    "so the run becomes `settled` with settledAt and updatedAt now, schedules payroll_run_transitioned `settled` (batch " +
    "facts through `readOrganizationPaymentBatchFactsInTx`) and the run's payment emails (payroll.runs.notify, " +
    "runAfter 0). A draft run is not refused, only a settled one. A replay finds the run settled and writes nothing.",
  was: [
    `${DOOR}:8`,
    `${B}/runs/writes/progression.ts:51`,
    `${B}/runs/writes/progression.ts:58`,
    `${B}/runs/writes/progression.ts:59`,
    `${B}/runs/writes/progression.ts:61`,
    `${B}/runs/writes/notices.ts:17`,
    `${B}/runs/events.ts:54`,
    `${PAY}/writes/settlements.ts:143`,
    `${PAY}/verifications/writes/sends.ts:226`,
    `${PAY}/verifications/writes/claims.ts:88`,
    `${PAY}/verifications/writes/commitments.ts:171`,
    `${PAY}/writes/rails.ts:59`,
  ],
  concept: concept_payroll,
  input: Schema.Struct({ payment: Schema.Struct({ payrollRunId: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  drives: [machine_payroll_run.t.to_settled],
  invokes: [],
  emits: [event_payroll_run_transitioned],
});

export const procedure_payroll_return_run_to_authorized = defineProcedure({
  id: "payroll.return-run-to-authorized",
  title: "Return a settled payroll run to authorized",
  about:
    "The un-settle flip (P04, indexer SPEC \"Reorgs\"), from payments' drift correction when a Payment lost its indexed " +
    "fact: a settled run goes back to `authorized`, settledAt is cleared (so the run leaves \"Paid This Month\") and " +
    "updatedAt is now. A Payment with no payrollRunId, an unknown run or one not settled returns. No transition event: " +
    "the Payment correction reports itself.",
  was: [
    `${DOOR}:7`,
    `${B}/runs/writes/progression.ts:66`,
    `${B}/runs/writes/progression.ts:72`,
    `${B}/runs/writes/progression.ts:80`,
    `${PAY}/verifications/writes/history.ts:228`,
    `${PAY}/verifications/writes/history.ts:245`,
  ],
  concept: concept_payroll,
  input: Schema.Struct({ payment: Schema.Struct({ payrollRunId: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  drives: [machine_payroll_run.t.to_authorized],
  invokes: [],
  emits: [],
});

// ── departments: what Permissions, Requests and Payments read ───────────────────────────────

export const procedure_payroll_read_department_holder_safes_in_tx = defineProcedure({
  id: "payroll.read-department-holder-safes-in-tx",
  title: "Read every Safe that holds a department or is proposed to",
  about:
    "Every holder Safe of the Organization's departments that are not abandoned (proposed ones included), and every Safe " +
    "a waiting addHolder change names, deduplicated. Permissions refuses Manage Budgets to each of them (ROLE_CONFLICT, " +
    "ADR-0040) through its own readDepartmentHolderSafesInTx, which forwards here.",
  was: [
    `${DOOR}:15`,
    `${B}/departments/reads.ts:196`,
    `${B}/departments/reads.ts:200`,
    `${B}/departments/reads.ts:30`,
    `${B}/departments/reads.ts:42`,
    "packages/backend/src/permissions/reads/departments.ts:12",
  ],
  concept: concept_payroll,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_payroll_departments, table_payroll_department_changes],
  writes: [],
  ...none,
});

export const procedure_payroll_read_department_holder_emails_in_tx = defineProcedure({
  id: "payroll.read-department-holder-emails-in-tx",
  title: "Read the mailboxes of the holders of active departments",
  about:
    "The deduplicated holder emails of the Organization's `active` departments, who can pay from them. Requests mails a " +
    "received Invoice's notice to them (receivables/reads/notices.ts:94).",
  was: [
    `${DOOR}:15`,
    `${B}/departments/reads.ts:213`,
    `${B}/departments/reads.ts:214`,
    "packages/backend/src/requests/receivables/reads/notices.ts:94",
  ],
  concept: concept_payroll,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_payroll_departments],
  writes: [],
  ...none,
});

export const procedure_payroll_read_department_spend_in_tx = defineProcedure({
  id: "payroll.read-department-spend-in-tx",
  title: "Read what a department payment spends",
  about:
    "CAP-1165: for a payment whose permission id is a `dep_` id, the department's v4 top budget and name, or why not as a " +
    "value: `not_found` (not one of the Organization's departments that are not abandoned), `not_holder` (the holder Safe " +
    "is not among its holders, case-insensitive), `not_active` (not active, or no office hat), `budget_unknown` (no " +
    "budgetId kept yet) or `asset_mismatch` (no budget line in the token). Payments' budget guard rides it on its v4 " +
    "budget route.",
  was: [
    `${DOOR}:17`,
    `${B}/departments/reads/spend.ts:20`,
    `${B}/departments/reads/spend.ts:28`,
    `${B}/departments/reads.ts:30`,
    `${PAY}/guards/budgets.ts:43`,
  ],
  concept: concept_payroll,
  input: Schema.Struct({ orgId: S, departmentId: S, holderSafe: S, tokenAddress: S }),
  output: Schema.Union([
    Schema.Struct({ ok: Schema.Literals([true]), budgetId: S, name: S }),
    Schema.Struct({
      ok: Schema.Literals([false]),
      refusal: Schema.Literals(["not_found", "not_holder", "not_active", "budget_unknown", "asset_mismatch"]),
    }),
  ]),
  errors: [],
  reads: [table_payroll_departments],
  writes: [],
  ...none,
});

// ── agreements: what an approval reads ──────────────────────────────────────────────────────

export const procedure_payroll_read_agreement_write_outcome_in_tx = defineProcedure({
  id: "payroll.read-agreement-write-outcome-in-tx",
  title: "Read what became of an approved agreement write",
  about:
    "For accounts' approvals (an approval of an agreement write is done once it is sent): a payee write with this writeId " +
    "answers `waiting` while awaiting approval, `abandoned` (no hash) or `dropped` (sent, never landed), else `sent`; one " +
    "on another agreement is `unknown`. Otherwise the agreement's lastWrite answers the same way, and an earlier write " +
    "its kept outcome (`landed`, `failed`, `abandoned`, `dropped` or `replaced`); none is `unknown`.",
  was: [
    `${DOOR}:20`,
    `${B}/agreements/reads/rows.ts:72`,
    `${B}/agreements/reads/rows.ts:82`,
    `${B}/agreements/reads/rows.ts:60`,
    `${B}/agreements/reads/rows.ts:24`,
    "packages/backend/src/accounts/approvals/reads.ts:284",
  ],
  concept: concept_payroll,
  input: Schema.Struct({ step: Schema.Struct({ agreementId: S, writeId: S }) }),
  output: Schema.Literals(["waiting", "sent", "landed", "failed", "abandoned", "dropped", "replaced", "unknown"]),
  errors: [],
  reads: [table_payroll_agreement_payee_writes, table_payroll_agreements],
  writes: [],
  ...none,
});
