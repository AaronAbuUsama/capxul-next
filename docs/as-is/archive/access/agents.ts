// The as-is book of the old access concept: the agents area, OAuth for agents (MCP clients), and
// the OIDC provider routes it rides on.
//
// What the old code has:
// - Three httpActions `convex/http.ts` routes directly (convex/access/agents.ts): the discovery
//   document at both /.well-known paths, and the login and consent pages the OIDC provider sends a
//   browser to. Each is wrapped in `observedRoute` under its catalog name.
// - Two BetterAuth plugin pieces (`agentExchange`, sessions/external/plugins.ts:65): the endpoint
//   POST /api/auth/agent/exchange, and an after-hook on POST /api/auth/oauth2/register. The hook
//   runs inside the register request and rewrites its reply; it is not scheduled or durable, so it
//   is booked as an rpc (`who: internal`), not a workflow.
// - BetterAuth 1.6.18's `oidcProvider` (sessions/external/auth.ts:142), configured by Capxul: the
//   agent scope grammar, one-hour access and 90-day refresh tokens, dynamic registration, tokens
//   signed with the jwt plugin (RS256). Its /oauth2/* routes are booked under `access.auth.oauth2-*`
//   (the code's operation group for BetterAuth routes, as in sessions.ts). Their behaviour is
//   BetterAuth's; only what Capxul configures and the tables the code names are recorded.
//
// The agent scope grammar (access/rules.ts:15): account:read, account:write, contacts:write,
// payments:draft, org:manage, media:write. `payments:send` is reserved and not issuable. oidcProvider
// prepends openid, profile, email and offline_access to every list.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { error_ENV_MISSING, error_UNKNOWN } from "../shared/vocabulary.ts";
import {
  table_better_auth_jwks,
  table_better_auth_oauth_access_token,
  table_better_auth_oauth_application,
  table_better_auth_oauth_consent,
  table_better_auth_session,
  table_better_auth_user,
} from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/agents.ts`;
const HTTP = `${BACKEND}/convex/http.ts`;
const AG = `${BACKEND}/src/access/agents`;
const OPS = `${AG}/operations`;
const AUTH = `${BACKEND}/src/access/sessions/external/auth.ts`;
const PLUGINS = `${BACKEND}/src/access/sessions/external/plugins.ts`;
const RULES = `${BACKEND}/src/access/rules.ts`;
const ROUTES = `${BACKEND}/src/platform/observation/routes.ts`;

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

const DEFECT = [error_UNKNOWN];
/** Every /api/auth route builds createAuth per request: its configuration, and a defect. */
const FACTORY_ERRORS = [error_ENV_MISSING, error_UNKNOWN];
const OIDC_WAS = [
  `${AUTH}:142`,
  `${AUTH}:143`,
  `${AUTH}:144`,
  `${AUTH}:149`,
  `${AUTH}:156`,
  `${AUTH}:160`,
  `${AUTH}:161`,
  `${AUTH}:162`,
  `${AUTH}:163`,
  `${RULES}:15`,
  `${RULES}:31`,
  `${HTTP}:74`,
  `${ROUTES}:32`,
];

// ── the pages and the discovery document ────────────────────────────────────────────────────

export const rpc_access_agents_discovery = defineRpc({
  id: "access.agents.discovery",
  title: "The authorization server's discovery document",
  about:
    "httpAction `access/agents:discovery`, served at GET /.well-known/oauth-authorization-server (RFC 8414) and " +
    "/.well-known/openid-configuration, registered before the BetterAuth routes so the Convex plugin does not mount its " +
    "own OIDC-only document at the root. A pure body over SITE_URL (issuer SITE_URL itself): the /api/auth/oauth2/* " +
    "endpoints, jwks_uri /api/auth/convex/jwks, scopes_supported the OIDC scopes plus the agent grammar, code with S256, " +
    "authorization_code and refresh_token, auth methods none, client_secret_basic and client_secret_post, RS256. " +
    "Cache-Control no-store. No SITE_URL throws ENV_MISSING.",
  was: [`${CONVEX}:5`, `${OPS}/discovery.ts:12`, `${AG}/views/discovery.ts:41`, `${HTTP}:54`, `${HTTP}:61`, `${HTTP}:67`, `${RULES}:24`, `${RULES}:31`],
  concept: concept_access,
  kind: "action",
  who: "Anyone: an MCP client (Claude fetches oauth-authorization-server first, then openid-configuration).",
  input: Schema.Struct({}),
  output: Schema.Struct({
    issuer: S,
    authorization_endpoint: S,
    token_endpoint: S,
    userinfo_endpoint: S,
    registration_endpoint: S,
    end_session_endpoint: S,
    jwks_uri: S,
    scopes_supported: Schema.Array(S),
    response_types_supported: Schema.Array(S),
    response_modes_supported: Schema.Array(S),
    grant_types_supported: Schema.Array(S),
    subject_types_supported: Schema.Array(S),
    id_token_signing_alg_values_supported: Schema.Array(S),
    token_endpoint_auth_methods_supported: Schema.Array(S),
    code_challenge_methods_supported: Schema.Array(S),
    claims_supported: Schema.Array(S),
  }),
  errors: [error_ENV_MISSING],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_agents_login_page = defineRpc({
  id: "access.agents.login-page",
  title: "The OAuth sign-in page (GET /login)",
  about:
    "httpAction `access/agents:loginPage`: oidcProvider sends a browser with no session here. A static HTML page (no-store) " +
    "carrying the authorize query: it posts the email to /api/auth/email-otp/send-verification-otp (type sign-in), then the " +
    "code to /api/auth/sign-in/email-otp with redirect manual (the Convex plugin's own OIDC instance would redirect with " +
    "invalid_scope for every agent scope), then resumes /api/auth/oauth2/authorize with the original query. A failed step " +
    "shows the server's code and message and beacons the code to /v1/client/observe under access.agents.loginPage. The " +
    "page's own request reads nothing.",
  was: [`${CONVEX}:6`, `${OPS}/login-page.ts:10`, `${AG}/views/pages.ts:91`, `${AG}/views/pages.ts:113`, `${AG}/views/pages.ts:128`, `${AG}/views/pages.ts:36`, `${AG}/views/pages.ts:59`, `${HTTP}:82`],
  concept: concept_access,
  kind: "action",
  who: "Any browser the authorization server redirects.",
  input: Schema.Struct({ search: S }),
  output: Schema.Struct({ html: S }),
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_agents_consent_page = defineRpc({
  id: "access.agents.consent-page",
  title: "The OAuth consent page (GET /consent)",
  about:
    "httpAction `access/agents:consentPage`: oidcProvider sends a signed-in browser here with `consent_code` and `scope`. " +
    "Each requested scope in words (an unknown scope as itself; none listed reads 'Access your Capxul account'), the note " +
    "that the person still signs every payment, and Allow or Deny, which post `{accept, consent_code}` to " +
    "/api/auth/oauth2/consent and follow the redirect it answers. A failure is shown and beaconed under " +
    "access.agents.consentPage. The page's own request reads nothing and checks no session.",
  was: [`${CONVEX}:4`, `${OPS}/consent-page.ts:9`, `${AG}/views/pages.ts:139`, `${AG}/views/pages.ts:152`, `${AG}/views/pages.ts:50`, `${HTTP}:87`],
  concept: concept_access,
  kind: "action",
  who: "Any browser the authorization server redirects.",
  input: Schema.Struct({ consent_code: S, scope: S }),
  output: Schema.Struct({ html: S }),
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── the agent exchange and the registration repair ──────────────────────────────────────────

export const rpc_access_agents_exchange = defineRpc({
  id: "access.agents.exchange",
  title: "Trade an agent's access token for a Convex token (POST /api/auth/agent/exchange)",
  about:
    "BetterAuth endpoint of the `agent-exchange` plugin, for the MCP server. It authenticates the resource server: " +
    "`Authorization: Bearer <CAPXUL_MCP_EXCHANGE_SECRET>`, compared in constant time; an unset secret or CONVEX_SITE_URL " +
    "answers 503 `exchange_unconfigured`, a wrong one 401 `invalid_token`. Then the stored access token: unknown, expired, or " +
    "naming no user or client is 401 `invalid_token`; no agent-grammar scope is 403 `insufficient_scope`. It reuses this " +
    "agent client's session (userAgent `capxul-agent/<clientId>`) when it outlasts five minutes, else creates a one-hour one " +
    "(a null create is the defect UNKNOWN), and signs a five-minute Convex JWT (aud convex, iss CONVEX_SITE_URL) with the " +
    "user's fields but id and image, `sessionId`, `sub`, `agent` (the client id) and `scope`. Answers token, expiresAt, " +
    "authUserId, email, scope and clientId. Convex then treats it as that person's session; no backend check reads `scope`.",
  was: [
    `${OPS}/exchange.ts:23`,
    `${OPS}/exchange.ts:28`,
    `${OPS}/exchange.ts:32`,
    `${OPS}/exchange.ts:40`,
    `${OPS}/exchange.ts:42`,
    `${OPS}/exchange.ts:43`,
    `${AG}/guards.ts:10`,
    `${AG}/guards.ts:19`,
    `${AG}/reads.ts:18`,
    `${AG}/reads.ts:31`,
    `${AG}/writes.ts:15`,
    `${AG}/writes.ts:10`,
    `${AG}/external.ts:11`,
    `${AG}/external.ts:20`,
    `${AG}/errors.ts:21`,
    `${AG}/errors.ts:33`,
    `${RULES}:38`,
    `${PLUGINS}:69`,
    `${BACKEND}/src/access/external.ts:34`,
  ],
  concept: concept_access,
  kind: "action",
  who: "The MCP server, holding CAPXUL_MCP_EXCHANGE_SECRET, on behalf of an agent holding an access token.",
  input: Schema.Struct({ accessToken: S }),
  output: Schema.Struct({ token: S, expiresAt: N, authUserId: S, email: S, scope: S, clientId: S }),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_oauth_access_token, table_better_auth_user, table_better_auth_session, table_better_auth_jwks],
  writes: [table_better_auth_session, table_better_auth_jwks],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_agents_complete_registration = defineRpc({
  id: "access.agents.complete-registration",
  title: "Repair a public client's dynamic registration",
  about:
    "BetterAuth after-hook on POST /api/auth/oauth2/register, in the same request. When the registration's reply names a " +
    "client with token_endpoint_auth_method `none`, it updates the stored application's `type` to `public` and removes " +
    "client_secret and client_secret_expires_at from the reply, so the pinned BetterAuth shape treats it as public. Any other " +
    "registration is left as BetterAuth made it.",
  was: [`${OPS}/complete-registration.ts:23`, `${OPS}/complete-registration.ts:12`, `${AG}/writes.ts:36`, `${PLUGINS}:74`, `${PLUGINS}:75`],
  concept: concept_access,
  kind: "action",
  who: "internal: BetterAuth's after-hook on POST /api/auth/oauth2/register.",
  input: Schema.Struct({ returned: U }),
  output: U,
  errors: DEFECT,
  reads: [],
  writes: [table_better_auth_oauth_application],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── the OIDC provider's routes (/api/auth/oauth2/*) ─────────────────────────────────────────

export const rpc_access_auth_oauth2_register = defineRpc({
  id: "access.auth.oauth2-register",
  title: "Register an agent client (POST /api/auth/oauth2/register)",
  about:
    "oidcProvider's dynamic client registration (allowDynamicClientRegistration: true): anyone may register a client, " +
    "which BetterAuth stores. Capxul's after-hook (access.agents.complete-registration) then marks a public client public " +
    "and strips its secret from the reply.",
  was: [`${AUTH}:162`, `${PLUGINS}:74`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone: an MCP client registering itself.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [],
  writes: [table_better_auth_oauth_application],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_authorize = defineRpc({
  id: "access.auth.oauth2-authorize",
  title: "Authorize an agent (GET /api/auth/oauth2/authorize)",
  about:
    "oidcProvider's authorization endpoint. Without a session it redirects the browser to SITE_URL/login with the query; " +
    "without consent to SITE_URL/consent with a consent_code and the scopes; otherwise it redirects to the client with a code. " +
    "Scopes outside the configured list are refused. The login page resumes here after the email-code sign-in.",
  was: [`${AUTH}:143`, `${AUTH}:144`, `${AG}/views/pages.ts:129`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "A browser, on behalf of a registered agent client.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session, table_better_auth_user, table_better_auth_oauth_application, table_better_auth_oauth_consent],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_consent = defineRpc({
  id: "access.auth.oauth2-consent",
  title: "Record a person's consent to an agent (POST /api/auth/oauth2/consent)",
  about:
    "oidcProvider's consent endpoint, posted by the consent page with `{accept, consent_code}`: an accept records the consent " +
    "and answers the redirect to the client with a code; a deny answers the client's error redirect.",
  was: [`${AG}/views/pages.ts:152`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "A signed-in browser holding a consent_code.",
  input: Schema.Struct({ accept: Schema.Boolean, consent_code: S }),
  output: Schema.Struct({ redirectURI: opt(S) }),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session, table_better_auth_oauth_application],
  writes: [table_better_auth_oauth_consent],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_token = defineRpc({
  id: "access.auth.oauth2-token",
  title: "Exchange a code or refresh token for agent tokens (POST /api/auth/oauth2/token)",
  about:
    "oidcProvider's token endpoint: authorization_code (with PKCE S256) and refresh_token grants. It stores an access token " +
    "(3600 s) and a refresh token (90 days) with the granted scopes and, with useJWTPlugin, signs with the jwt plugin's RS256 " +
    "keys. The MCP server later trades the access token at the agent exchange.",
  was: [`${AUTH}:141`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "A registered agent client.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_oauth_application, table_better_auth_oauth_access_token, table_better_auth_user, table_better_auth_jwks],
  writes: [table_better_auth_oauth_access_token, table_better_auth_jwks],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_userinfo = defineRpc({
  id: "access.auth.oauth2-userinfo",
  title: "The person behind an agent access token (GET /api/auth/oauth2/userinfo)",
  about: "oidcProvider's userinfo endpoint, unchanged by Capxul: the OIDC claims of the access token's user.",
  was: [`${AG}/views/discovery.ts:46`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "A holder of an agent access token.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_oauth_access_token, table_better_auth_user],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_endsession = defineRpc({
  id: "access.auth.oauth2-endsession",
  title: "End an OIDC session (GET /api/auth/oauth2/endsession)",
  about: "oidcProvider's end-session endpoint, unchanged by Capxul and advertised by the discovery document.",
  was: [`${AG}/views/discovery.ts:48`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "A browser or agent client.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session],
  writes: [table_better_auth_session],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_oauth2_client = defineRpc({
  id: "access.auth.oauth2-client",
  title: "A registered client's public details (GET /api/auth/oauth2/client/:id)",
  about: "oidcProvider's client read, unchanged by Capxul; no Capxul code calls it.",
  was: [`${ROUTES}:69`, ...OIDC_WAS],
  concept: concept_access,
  kind: "action",
  who: "Whoever BetterAuth admits for the route.",
  input: Schema.Struct({ id: S }),
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_oauth_application],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
