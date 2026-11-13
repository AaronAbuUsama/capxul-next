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
