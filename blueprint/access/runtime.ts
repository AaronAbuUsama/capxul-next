import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { table_principals, table_sessions, table_feature_flags } from "./data.ts";
import { rpc_access_sign_in_challenge, rpc_access_sign_in_send_code, rpc_access_sign_in_verify_code, rpc_access_sign_in_with_key } from "./sign-in.ts";
import { rpc_access_sessions_current } from "./sessions.ts";

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

export const decision_access_actor_sign_in = defineDecision({
  id: "access.actor-sign-in",
  title: "The SDK's actor sign-in helpers compose the public sign-in rpcs and nothing else",
  question: "Receipt-first preparation must sign real people and agents in through the public doors, before and after a restore. Which SDK surface does it use?",
  options: [
    { label: "public-helpers", text: "Two Core SDK helpers over the existing rpcs: `signInByCode` (send-code, the one new sink message by id, verify-code, current) and `signInByKey` (challenge, an EIP-191 signature of the exact challenge, with-key, current); plus the `MailInbox` type a sink's list satisfies." },
    { label: "harness-only", text: "Keep the composition inside the eval harness, out of the SDK." },
  ],
  chosen: "public-helpers",
  why: "They add no rpc, field, error or authority: each call opens a fresh session through the booked doors and checks `current` agrees, so a session that merely survived a restore is never reused. The code is taken from the one message new since the call, by its id, because a stopped world clock gives several messages one `sentAt`; more than one new message is PROVIDER_RESPONSE_INVALID rather than a guess. A runtime, a CLI and the harness share one tested path instead of each re-deriving it. They do not prove Seat, hat or agent bootstrap authority, which belong to their concepts.",
  source: "Access/accounts slice-zero implementation, 13 November 2026; integrator review of PR103; access.own-sign-in",
  affects: [rpc_access_sign_in_send_code, rpc_access_sign_in_verify_code, rpc_access_sign_in_challenge, rpc_access_sign_in_with_key, rpc_access_sessions_current],
});
