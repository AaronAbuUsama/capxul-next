import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { table_admissions, table_referrals, table_personal_safes, machine_personal_safe } from "./data.ts";
import { procedure_accounts_admit } from "./procedures.ts";

export const decision_accounts_admission_runtime = defineDecision({
  id: "accounts.admission-runtime",
  title: "Admission and its source events use the caller's transaction",
  question: "How do concurrent invitation and escrow admissions preserve one permanent admission without a fictitious company?",
  options: [
    { label: "mailbox-lock", text: "Serialize the normalized mailbox, guard the waiting/birth transition, and emit through the common runtime outbox on the caller's Sql; use an opaque entity key for source resolution." },
    { label: "separate-job", text: "Queue admission for another transaction after the invitation or escrow commits." },
  ],
  chosen: "mailbox-lock",
  why: "The authority fact and its admission must roll back together. A repeated admission changes no timestamp, provenance or event. Notices reads the committed admission through its opaque source key, including a mailbox with no principal, without placing a mailbox in analytics props or inventing an organization for app.records. The common outbox owns delivery and consumer acknowledgements. The individual waitlist/referral public commands remain parked by cut.individuals-parked; supporting rows and admission transitions are not permission to reopen them.",
  source: "Access/accounts slice-zero implementation, 12 November 2026; procedures.accounts-admit; accounts.mailbox-tenancy; accounts.no-mailbox; rules.outbox; cut.individuals-parked",
  affects: [table_admissions, table_referrals, table_personal_safes, procedure_accounts_admit],
});

export const decision_accounts_indexed_setup = defineDecision({
  id: "accounts.indexed-setup",
  title: "Only the indexed claim occurrence advances setup",
  question: "May current sole ownership advance setup without an indexed claim occurrence?",
  options: [
    { label: "indexed-claim", text: "Use the shared same-Sql claim reader with deployment chain/finality and the recorded transaction hash when present; absent or lagging occurrence stays claiming." },
    { label: "owners-only", text: "Advance on code and getOwners alone, recording the current head and observation time as claim identity." },
  ],
  chosen: "indexed-claim",
  why: "Ownership is necessary but not a claim occurrence. Adoption omits a new send, not indexed event proof. The provider checks readiness, exact occurrence, finality and current sole signer in one snapshot. Setup records that occurrence's transaction hash, block and chain time, never the latest head or worker time. An unavailable or malformed provider refuses without a transition. Deployment code supplies chain/finality; the HTTP caller cannot choose them.",
  source: "integrations.indexed-claim; integrator PR56 source review, 12 November 2026",
  affects: [table_personal_safes, machine_personal_safe],
});
