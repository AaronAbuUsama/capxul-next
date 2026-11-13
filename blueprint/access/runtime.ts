import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { table_principals, table_sessions, table_feature_flags } from "./data.ts";
import { rpc_access_sign_in_verify_code } from "./sign-in.ts";

export const decision_access_runtime_authority = defineDecision({
  id: "access.runtime-authority",
  title: "Resolve the bearer before setting personal transaction authority",
  question: "How can the restricted Core role find a session before it knows the person without exposing every principal?",
  options: [
    { label: "bearer-lookup", text: "One closed pre-tenant SQL lookup by opaque token hash; then transaction-local verified person and mailbox, with read-only self RLS and worker-only identity writes." },
    { label: "directory-read", text: "Allow the tenant role to read every session and principal before setting the owner." },
  ],
  chosen: "bearer-lookup",
  why: "A request's body or chosen owner is not identity. The runtime clears stale actor settings, resolves only an active unexpired bearer, and sets person/email on the same connection. The lookup uses qualified SQL and a closed search path. Principals remain immutable except an agent's proved signer rotation; no other concept creates a second identity store. Deployment code supplies gate targets and money classification, never a request or provider flag. Unsupported definitions fail closed and only a successful sync changes checked_at.",
  source: "Access/accounts slice-zero implementation, 12 November 2026; access.no-procedures; access.own-sign-in; access.gates",
  affects: [table_principals, table_sessions, table_feature_flags, rpc_access_sign_in_verify_code],
});

export const decision_access_gate_catalogue = defineDecision({
  id: "access.gate-catalogue",
  title: "Core's gate catalogue names the blueprint's six gates; held sends read it",
  question:
    "Access' evaluator reads a gate only through a catalogue that deployment code supplies (target and money class), and " +
    "approvals.gate makes a held send wait while its gate is off. Which gates does Core's catalogue name, and how does the " +
    "carrier read one?",
  options: [
    {
      label: "blueprint-gates",
      text:
        "The six gates the blueprint names: `beta-access` (person), and for an Organization `owner-safe-proposals`, " +
        "`payment-agreements` and `equity` (money) and `books` and `payslip-preview` (not money). Core's carrier reads an " +
        "approval's gate through this catalogue on the world clock, for the approval's signer and Organization, before it " +
        "checks the needs.",
    },
    { label: "fail-closed", text: "Compose no catalogue: every gated approval waits and lapses." },
  ],
  chosen: "blueprint-gates",
  why:
    "The catalogue is what turns a PostHog flag into an answer, so without it the Director proposals that approvals.gate " +
    "names can never send. Targets are the blueprint's (devnet.scripted-gates lists the Organization gates). Money classes " +
    "follow the old catalogue (Xelmar-tech/infrastructure packages/protocol/src/features/catalog.ts): owner proposals and " +
    "payment agreements move an Organization's money, so a sync older than 10 minutes closes them; Books, the payslip " +
    "preview and the beta gate move none and keep their last synced value. The old catalogue had no equity gate; equity " +
    "issues ownership, so it is classed money and fails closed. A key the catalogue does not name reads off at the " +
    "carrier rather than failing it, so its held send waits and lapses. Old gates no booked operation reads (departments, " +
    "bank payouts, scheduled payments, production access) are not named: a gate with no reader is a flag nobody checks.",
  source: "Integrator, 13 November 2026: compose Access' gate catalogue for the approval carrier (PR140); access.gates; approvals.gate; devnet.scripted-gates",
  affects: [table_feature_flags],
});
