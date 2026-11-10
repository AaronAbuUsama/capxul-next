// The plugs' Core SDK flows: the sign-in a site's login drives over HTTP, the status of a held payment a site polls, and the roles
// command that reads a person's grants and, with `--map`, the map beside them. The rest of the plugs' operations are one rpc each.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { rpc_plugs_oauth_authorize, rpc_plugs_oauth_token, rpc_plugs_oauth_userinfo } from "./signin.ts";
import { rpc_plugs_payments_get, PaymentRequestView } from "./signer.ts";
import { rpc_plugs_roles_map, rpc_plugs_roles_show, MapRow } from "./roles.ts";
import { N, Null, S } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";

export const flow_client_site_sign_in = defineFlow({
  id: "client.site.sign-in",
  title: "Sign a person in to their company's site through Capxul",
  about:
    "Surface: the site's login page, over HTTP, not a command. The person clicks the login button; the site sends the browser to Capxul with the client id, an exact redirect and a state; " +
    "a person already signed in to Capxul has a code made for them (a hat must have created their site user), the browser returns to the site, the site's server exchanges the code with its secret for " +
    "a token, and reads who the token belongs to. Sign-up is denied on the site, so a person with no hat ends at a refusal and no session.",
  was: [`${SPIKE} (Frappe half: Sign-in verified end to end against the real Core stub)`],
  component: component_core_sdk,
  sdk: "client.site.signIn",
  surfaces: ["http"],
  input: Schema.Struct({ client_id: S, redirect_uri: S, state: S }),
  output: Schema.Struct({ sub: S, email: S, address: S }),
  steps: [
    { name: "authorize", rpc: rpc_plugs_oauth_authorize, about: "Makes the single-use code for the signed-in person." },
    { name: "token", rpc: rpc_plugs_oauth_token, about: "The site's server exchanges the code with its secret." },
    { name: "userinfo", rpc: rpc_plugs_oauth_userinfo, about: "The site reads who the token is for." },
  ],
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_site_payment_status = defineFlow({
  id: "client.site.payment-status",
  title: "Read where a held payment stands, for the site and the SDK",
  about:
    "Surface: the Frappe form while a payment waits (it polls this to show 'waiting for Hannah's signature', then the result), and an agent's SDK. One read of the request by id or by document.",
  was: [`${SPIKE} (Frappe half: Paying a document, route 2)`],
  component: component_core_sdk,
  sdk: "client.payments.documentStatus",
  surfaces: ["sdk", "http"],
  input: Schema.Struct({ orgId: S, requestId: Null(S), doctype: Null(S), docname: Null(S) }),
  output: PaymentRequestView,
  steps: [{ name: "get", rpc: rpc_plugs_payments_get, about: "Reads the request and its state." }],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_org_roles_show = defineFlow({
  id: "client.org.roles.show",
  title: "Show a person's roles, and with --map the map they come from",
  about: "`org roles show [--map]`: the person's grants and resulting roles, then, when asked, the hat-to-role map by job, so one command answers 'why do I have this role'.",
  was: [`${SPIKE} (What the design must now decide, 6 and 7)`],
  component: component_core_sdk,
  sdk: "client.org(orgId).roles.show",
  input: Schema.Struct({ orgId: S, person: Null(S), map: Schema.Boolean }),
  output: Schema.Struct({ person: S, roles: Schema.Array(S), grants: N, map: Null(Schema.Struct({ mapVersion: S, rows: Schema.Array(MapRow) })) }),
  steps: [
    { name: "show", rpc: rpc_plugs_roles_show, about: "Reads the person's grants and resulting roles." },
    { name: "map", rpc: rpc_plugs_roles_map, about: "With --map: reads the shipped map." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});
