// Access' sign-in area: a person proves their email with a six-digit code, an agent proves its key
// owns its Safe by signing a challenge. Each proof opens a session (machine_session.t.open).
//
// accounts' `auth login` and `auth verify` flows step through these rpcs (concept accounts), and so
// do access' own flows for the browser and for an SDK host holding an agent's key (./flows.ts).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { contract_agent_owner, contract_safe, integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_OTP_EXPIRED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
} from "../shared/vocabulary.ts";
import { machine_session, table_principals, table_sessions, table_sign_in_codes } from "./data.ts";

const OLD = "packages/backend/src/access";
const ASIS = "books/as-is/access/sessions.ts";

const S = Schema.String;
const Time = Schema.DateTimeUtc;

/** What a sign-in answers: the session token, once, and who it signs in. */
const SignedIn = {
  /** 32 random bytes, base64url; only its hash is stored. */
  token: S,
  personId: S,
  safe: S,
  expiresAt: Time,
};

export const rpc_access_sign_in_send_code = defineRpc({
  id: "access.sign-in.send-code",
  title: "Email a six-digit sign-in code",
  about:
    "Normalises the email (trimmed, lowercased, ASCII) and refuses one that is not an address. Inside 60 seconds of the " +
    "last send to it, refuses RATE_LIMITED with `retryAfterMs`. Otherwise it mints a code, sends it through Mail with the " +
    "code's hash as the idempotency key, and only after Mail accepted it stores the code's hash, three tries and a " +
    "five-minute expiry in one transaction, replacing any earlier code. A send that fails stores nothing, so the person " +
    "may ask again at once. On a devnet the code lands in devnet's mail sink, where evals read it.",
  was: [`${ASIS}:186`, `${OLD}/sessions/external/otp-delivery.ts:114`, `${OLD}/sessions/rules.ts:165`],
  concept: concept_access,
  kind: "action",
  who: "Anyone with an email address. No sign-in is needed.",
  input: Schema.Struct({ email: S }),
  output: Schema.Struct({ email: S, expiresAt: Time, resendAfter: Time }),
  errors: [error_INVALID_INPUT, error_RATE_LIMITED, error_PROVIDER_ERROR],
  reads: [table_sign_in_codes],
  writes: [table_sign_in_codes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.send],
  chain: [],
  spans: [],
  budget: budget("vendor"),
});

export const rpc_access_sign_in_verify_code = defineRpc({
  id: "access.sign-in.verify-code",
  title: "Sign in with the emailed code",
  about:
    "One transaction. No code waiting for the email, or a code that is not six digits, is INVALID_INPUT. A code past its " +
    "expiry is OTP_EXPIRED. A wrong code spends a try and is INVALID_INPUT (field `otp`, with the tries left); with none " +
    "left the code is refused RATE_LIMITED until a new one is sent. A right code deletes the row, creates the person's " +
    "principal on their first sign-in (kind person, the email, and the Safe address Companies House's pure function gives " +
    "for it), and opens a 30-day session for the host that asked. It answers the token once.",
  was: [`${ASIS}:240`, `${OLD}/sessions/external/auth.ts:197`, "packages/sdk/src/access/auth-client/better-auth-node-session.ts:57"],
  concept: concept_access,
  kind: "mutation",
  who: "Anyone holding the code that was sent to the email.",
  input: Schema.Struct({ email: S, code: S, client: S }),
  output: Schema.Struct({ ...SignedIn, email: S }),
  errors: [error_INVALID_INPUT, error_OTP_EXPIRED, error_RATE_LIMITED],
  reads: [table_sign_in_codes, table_principals],
  writes: [table_sign_in_codes, table_principals, table_sessions],
  drives: [machine_session.t.open],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_access_sign_in_challenge = defineRpc({
  id: "access.sign-in.challenge",
  title: "A challenge for an agent's key to sign",
  about:
    "Answers a sign-in message for the Safe the key says it owns: Capxul's domain, the Safe, a random nonce and the issue " +
    "time, with Capxul's MAC over them (SESSION_SIGNING_KEY). Nothing is stored: access.sign-in.with-key checks the MAC " +
    "and the time (five minutes), and the session it opens keeps the nonce, so a challenge signs in once.",
  was: ["apps/docs/factory/operations/auth.login.yaml (designed W9)", "apps/cli/src/auth/own-key.ts:1"],
  concept: concept_access,
  kind: "query",
  who: "Anyone holding an agent's key. No sign-in is needed.",
  input: Schema.Struct({ safe: S }),
  output: Schema.Struct({ challenge: S, expiresAt: Time }),
  errors: [error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_access_sign_in_with_key = defineRpc({
  id: "access.sign-in.with-key",
  title: "Sign an agent in by its key, proved on chain",
  about:
    "Checks the challenge is Capxul's, under five minutes old and not spent, and recovers the key that signed it (EIP-191). " +
    "Then two reads at `latest` in parallel: AgentOwner's `agentOf(safe)` must name an owner, must not be frozen and must " +
    "name this key as the signer, and the Safe's `getOwners()` must be exactly this key. Any miss is NOT_AUTHENTICATED " +
    "(the key signs for no agent account, or the agent is frozen). Then one transaction: the agent's principal is created " +
    "on its first sign-in (kind agent, the Safe, the key) or its key updated after a rotation, and a 24-hour session opens " +
    "with the challenge's nonce; a nonce already spent is NOT_AUTHENTICATED. It answers the token once, with the agent's " +
    "owner Safe.",
  was: ["apps/docs/factory/operations/auth.login.yaml (designed W9)", `${OLD}/agents/operations/exchange.ts:1`, `${OLD}/agents/writes.ts:10`],
  concept: concept_access,
  kind: "action",
  who: "The holder of an agent's own key, with a challenge from access.sign-in.challenge that the key signed.",
  input: Schema.Struct({ safe: S, challenge: S, signature: S, client: S }),
  output: Schema.Struct({ ...SignedIn, signer: S, owner: S }),
  errors: [error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_principals, table_sessions],
  writes: [table_principals, table_sessions],
  drives: [machine_session.t.open],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_agent_owner.f.agentOf, contract_safe.f.getOwners],
  spans: [],
  budget: budget("chain-read"),
});
