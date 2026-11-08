// Access' assistants area: OAuth 2.1 for MCP clients, so an assistant can act as the person who
// allowed it. The person signs in and allows the client on Capxul's consent page (a web surface,
// ./flows.ts); the client exchanges its code and refreshes at the token route, and revokes at the
// revocation route. Each grant is one durable process (access.assistants.grant, ./processes.ts),
// which these rpcs signal.
//
// Not rpcs: the discovery documents (RFC 8414 and the MCP server's protected-resource metadata) and
// client registration (RFC 7591), which are stateless protocol routes: registration answers a
// client id that is Capxul's MAC over the client's name and redirect URIs, so no client row exists
// to write or sweep (decision access.assistants).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { machine_assistant_grant, table_assistant_grants } from "./data.ts";

const OLD = "packages/backend/src/access";
const ASIS = "books/as-is/access/agents.ts";

const S = Schema.String;

/** The authorization request an assistant's client sent the browser to (RFC 6749 4.1.1, PKCE, RFC 8707). */
const AuthorizationRequest = Schema.Struct({
  clientId: S,
  redirectUri: S,
  codeChallenge: S,
  codeChallengeMethod: S,
  scope: S,
  resource: S,
  state: Schema.optionalKey(S),
});

export const rpc_access_assistants_read_request = defineRpc({
  id: "access.assistants.read-request",
  title: "What an assistant's client asks the person to allow",
  about:
    "For the consent page: checks the authorization request and answers what to show. The client id must carry Capxul's " +
    "MAC (it was registered here), the redirect URI must be one it registered, PKCE must be S256, every scope must be in " +
    "the scope list (`account:read`, `account:write`, `contacts:write`, `payments:draft`, `org:manage`, `media:write`; " +
    "no scope signs or sends money: the person still signs every approval), and the resource must be Capxul's MCP " +
    "server. Any miss is INVALID_INPUT, which the page shows instead of redirecting. It reads no table.",
  was: [`${ASIS}:142`, `${ASIS}:270`, `${OLD}/rules.ts:14`],
  concept: concept_access,
  kind: "query",
  who: "A signed-in person on the consent page, for the request an assistant's client sent their browser.",
  input: AuthorizationRequest,
  output: Schema.Struct({
    clientName: S,
    redirectUri: S,
    resource: S,
    scopes: Schema.Array(Schema.Struct({ scope: S, label: S })),
  }),
  errors: [error_INVALID_INPUT, error_NOT_AUTHENTICATED],
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

export const rpc_access_assistants_consent = defineRpc({
  id: "access.assistants.consent",
  title: "The person allows an assistant's client",
  about:
    "Checks the request again as access.assistants.read-request does, then in one transaction creates the grant for the " +
    "signed-in person: pending, with a one-time code (only its hash kept), the PKCE challenge, the scopes, and 10 minutes " +
    "for the client to exchange it. Answers the redirect to the client's URI with the code and the client's `state`. A " +
    "person who declines never calls it: the page redirects with `access_denied` and nothing is stored.",
  was: [`${ASIS}:294`, `${OLD}/agents/views/pages.ts:149`],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person on the consent page, allowing the client named in the request.",
  input: AuthorizationRequest,
  output: Schema.Struct({ grantId: S, redirectTo: S }),
  errors: [error_INVALID_INPUT, error_NOT_AUTHENTICATED],
  reads: [],
  writes: [table_assistant_grants],
  drives: [machine_assistant_grant.t.consent],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_access_assistants_token = defineRpc({
  id: "access.assistants.token",
  title: "The token route: exchange a code, or refresh",
  about:
    "One transaction, answering RFC 6749's token response. `authorization_code`: the code must be a pending grant's, " +
    "before it lapses, from the same client and redirect URI, with a verifier that matches the PKCE challenge; the grant " +
    "becomes active with a one-hour access token and a refresh token, and its refresh window starts. `refresh_token`: a " +
    "live refresh token rotates both tokens and slides the window 30 days, never past 90 days from consent; the token " +
    "just spent, presented again within 60 seconds, answers the same pair again; presented later, it revokes the grant. " +
    "Every refusal is OAuth's `invalid_grant` or `invalid_request`, which is INVALID_INPUT. It signals the grant's process.",
  was: [`${ASIS}:317`, `${OLD}/agents/operations/exchange.ts:1`, "books/as-is/access/clients.ts:371"],
  concept: concept_access,
  kind: "mutation",
  who: "An assistant's OAuth client at the token route, with its code and PKCE verifier or its refresh token. No Capxul sign-in.",
  input: Schema.Struct({
    grantType: Schema.Literals(["authorization_code", "refresh_token"]),
    clientId: S,
    code: Schema.optionalKey(S),
    codeVerifier: Schema.optionalKey(S),
    redirectUri: Schema.optionalKey(S),
    refreshToken: Schema.optionalKey(S),
  }),
  output: Schema.Struct({
    accessToken: S,
    refreshToken: S,
    tokenType: Schema.Literal("Bearer"),
    expiresIn: Schema.Int,
    scope: S,
  }),
  errors: [error_INVALID_INPUT],
  reads: [table_assistant_grants],
  writes: [table_assistant_grants],
  drives: [machine_assistant_grant.t.exchange, machine_assistant_grant.t.revoke],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_access_assistants_revoke = defineRpc({
  id: "access.assistants.revoke",
  title: "The revocation route: end an assistant's grant",
  about:
    "RFC 7009: the client presents its access or refresh token and the grant it names is revoked in one transaction, so " +
    "every token of it is refused. An unknown or already ended token answers success, as the RFC says, and changes " +
    "nothing; only a malformed request is INVALID_INPUT. It signals the grant's process, which then ends.",
  was: [`${ASIS}:362`, "books/as-is/access/clients.ts:398"],
  concept: concept_access,
  kind: "mutation",
  who: "An assistant's OAuth client at the revocation route, with a token of its own grant.",
  input: Schema.Struct({ token: S, tokenTypeHint: Schema.optionalKey(Schema.Literals(["access_token", "refresh_token"])) }),
  output: Schema.Struct({}),
  errors: [error_INVALID_INPUT],
  reads: [table_assistant_grants],
  writes: [table_assistant_grants],
  drives: [machine_assistant_grant.t.revoke],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
