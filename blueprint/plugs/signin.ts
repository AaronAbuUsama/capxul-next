// The sign-in plug: Capxul is the OAuth 2 and OpenID provider each hosted site signs in through. The site's Social Login Key points at
// it; sign-up is denied on the site, so the only people who can sign in are those a hat created (a row in site-users). THIS BROWSER FLOW NEEDS A REACHABLE SERVICE (the site's server exchanges the
// code with the service), so under plugs.service-calls-site it is outside the current path; the path's sign-in is sessions.ts (the service calls the site). The person
// proves themselves to Capxul as they already do (access); this plug only hands a signed identity to the site. Stand-in in the spike: a
// list of test people to pick from. Assumption, not yet tested: the real provider's session check and exact redirect matching (the stand-in accepts any redirect_uri, FINDINGS, Core half); the first sign-in eval against the real provider proves them.

import { Schema } from "effect";
import { concept_plugs } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_oauth_clients, table_oauth_codes, table_site_users } from "./data.ts";
import { N, S, FIND, procedure, rpc } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";

export const procedure_plugs_oauth_register_client = procedure({
  id: "plugs.oauth.register-client",
  title: "Register the OAuth client a new site signs in with",
  about:
    "Called by the site's creation process in its own transaction: makes the client id and a random secret, stores the secret's hash and the exact " +
    "redirect addresses (the site's `/api/method/frappe.integrations.oauth2_logins.login_via_oauth2/capxul`), and answers both once, for the site " +
    "service to write into the Social Login Key. An address that is not https on the site's own host (http on a devnet's loopback) is INVALID_INPUT. " +
    "Rotating replaces the hash and stops the old secret at once.",
  concept: concept_plugs,
  input: Schema.Struct({ org_id: S, site_host: S, redirect_uris: Schema.Array(S), rotate: Schema.Boolean }),
  output: Schema.Struct({ client_id: S, client_secret: S }),
  errors: [error_INVALID_INPUT],
  reads: [table_oauth_clients],
  writes: [table_oauth_clients],
  was: [`${SPIKE} (Frappe half: Social Login Key)`],
});

export const rpc_plugs_oauth_authorize = rpc({
  id: "plugs.oauth.authorize",
  title: "Hand a signed-in person's identity to their company's site",
  about:
    "The browser arrives from the site's login button with the client id, an exact redirect address and a state. The person must be signed in to Capxul " +
    "(NOT_AUTHENTICATED otherwise) and must have a site user in that Organization, which only a hat creates (ROLE_PERMISSION_DENIED otherwise, with no code " +
    "made). It writes a single-use code, good for ten minutes, and answers the redirect with the code and the state. A redirect that is not exactly " +
    "registered is INVALID_INPUT and the browser is never sent to it.",
  concept: concept_plugs,
  kind: "mutation",
  who: "A person signed in to Capxul in this browser, who has a site user in the Organization the client belongs to.",
  input: Schema.Struct({ client_id: S, redirect_uri: S, state: S }),
  output: Schema.Struct({ redirect: S }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_oauth_clients, table_site_users],
  writes: [table_oauth_codes],
  was: [`${SPIKE} (Frappe half: Sign-in verified end to end)`],
});

export const rpc_plugs_oauth_token = rpc({
  id: "plugs.oauth.token",
  title: "Exchange a sign-in code for an access token, once",
  about:
    "The site's server presents the code with its client id and secret. The secret must match the stored hash, the code must be unused, unexpired and the " +
    "client's own; the code is then marked used and an access token for that person is answered. A second use of a code, an expired one, another client's, " +
    "or a wrong secret is NOT_AUTHENTICATED and uses nothing up.",
  concept: concept_plugs,
  kind: "mutation",
  who: "A site's server, with its client secret.",
  input: Schema.Struct({ client_id: S, client_secret: S, code: S, redirect_uri: S }),
  output: Schema.Struct({ access_token: S, token_type: Schema.Literal("bearer"), expires_in: N }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_oauth_clients],
  writes: [table_oauth_codes],
  was: [`${SPIKE} (Core half: the OAuth stand-in)`],
});

export const rpc_plugs_oauth_userinfo = rpc({
  id: "plugs.oauth.userinfo",
  title: "Say who an access token belongs to",
  about:
    "Answers the OpenID claims the site's login reads: `sub` (the person's id), the email, the name, the given and family names and the person's Capxul " +
    "account address, which the site stores on the Frappe user (FINDINGS, End to end: What the design must now decide, 1). A person with no site user in " +
    "the token's Organization, or one whose user is disabled, is NOT_AUTHENTICATED: a hat's revoke ends sign-in at the next call.",
  concept: concept_plugs,
  kind: "query",
  who: "A site's server, with a token its client was given.",
  input: Schema.Struct({ access_token: S }),
  output: Schema.Struct({ sub: S, email: S, name: S, given_name: S, family_name: S, address: S }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_site_users],
  was: [`${SPIKE} (INTERFACE.md: Sign-in)`],
});

void FIND;
