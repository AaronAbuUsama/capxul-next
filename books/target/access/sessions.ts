// Access' sessions area: what a signed-in caller can ask about its own session, ending it, and the
// one vendor session a browser's embedded wallet needs. Expiry is the daily sweep's
// (./processes.ts); resolving a bearer on every request is the runtime's (./procedures.ts).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { contract_safe, integration_chain_rpc, integration_openfort_shield } from "../shared/external.ts";
import { error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID } from "../shared/vocabulary.ts";
import { machine_session, table_principals, table_sessions } from "./data.ts";

const OLD = "packages/backend/src/access";
const ASIS = "docs/as-is/archive/access/sessions.ts";

const S = Schema.String;
const Time = Schema.DateTimeUtc;

export const rpc_access_sessions_current = defineRpc({
  id: "access.sessions.current",
  title: "The caller's own session, and whether its Safe is set up",
  about:
    "Answers the principal behind the caller's live session (id, kind, email for a person, Safe) and when the session " +
    "expires. A revoked, expired or unknown token is NOT_AUTHENTICATED. For a person it also says whether their Safe is " +
    "set up, read from the chain because access depends on no concept that knows: `ready` when the Safe has code and " +
    "Companies House is no longer among its owners (the claim swapped the person's signer in), otherwise " +
    "`setup-required`. An agent's Safe is ready by its sign-in proof, so it reads nothing for an agent.",
  was: [`${ASIS}:86`, `${ASIS}:266`, "apps/docs/factory/operations/auth.switch.yaml", "packages/contracts/v4/src/interfaces/ICompaniesHouseClaimer.sol:33"],
  concept: concept_access,
  kind: "action",
  who: "A signed-in person or agent, for the session it calls with.",
  input: Schema.Struct({}),
  output: Schema.Struct({
    personId: S,
    kind: Schema.Literals(["person", "agent"]),
    email: Schema.NullOr(S),
    safe: S,
    expiresAt: Time,
    setupState: Schema.Literals(["ready", "setup-required"]),
  }),
  errors: [error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_sessions, table_principals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.getCode, integration_chain_rpc.c.readContract],
  chain: [contract_safe.f.getOwners],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_access_sessions_revoke = defineRpc({
  id: "access.sessions.revoke",
  title: "End the caller's session",
  about:
    "Revokes the session the caller's token names, in one transaction; from then on the token is refused everywhere. A " +
    "token that is already revoked, expired or unknown is NOT_AUTHENTICATED, which the sign-out flow reads as nothing left " +
    "to revoke.",
  was: [`${ASIS}:342`, "packages/sdk/src/access/sign-out-revoke.ts:21"],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person or agent, for the session it calls with.",
  input: Schema.Struct({}),
  output: Schema.Struct({ sessionId: S, endedAt: Time }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_sessions],
  writes: [table_sessions],
  drives: [machine_session.t.revoke],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_access_sessions_wallet_recovery = defineRpc({
  id: "access.sessions.wallet-recovery",
  title: "A recovery session for the person's embedded wallet",
  about:
    "Asks Openfort Shield for one encryption session, with which the person's embedded wallet recovers its key share in " +
    "this browser. The backend holds the Shield secrets, so the browser never does. A person's session only: an agent " +
    "signs with its own key and is refused NOT_AUTHENTICATED. Shield's failures reach the caller as they are.",
  was: [`${ASIS}:365`, "packages/backend/src/integrations/openfort/betterAuthClient.ts:36", "apps/cli/src/signer/bridge-upstream.ts:124"],
  concept: concept_access,
  kind: "action",
  who: "A signed-in person, in a browser, for their own embedded wallet.",
  input: Schema.Struct({}),
  output: Schema.Struct({ encryptionSession: S }),
  errors: [error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_sessions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_openfort_shield.c.createEncryptionSession],
  chain: [],
  spans: [],
  budget: budget("vendor"),
});
