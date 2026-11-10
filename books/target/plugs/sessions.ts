// Sessions without the site calling the service: a person is reached on a site by a short-lived assertion the service signs and the site checks, nothing stored for the
// person (plugs.door-assertion; shown by the spike's door), and a person who only watches gets a one-time sign-in link the service asks the site to mint. A browser sign-in that needs
// the site to call the service (signin.ts) is marked as needing a reachable service and is outside the current path (plugs.service-calls-site). Assumption, not yet tested: the site's mintViewLink, proved by the viewer eval.

import { Schema } from "effect";
import { concept_plugs } from "../shared/foundation.ts";
import {
  error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { integration_frappe_site } from "./integrations.ts";
import { table_site_links, table_site_users } from "./data.ts";
import { N, S, rpc } from "./kit.ts";

export const rpc_plugs_sessions_link = rpc({
  id: "plugs.sessions.link",
  title: "Mint a one-time, read-only sign-in link for a person who only watches",
  about:
    "A person with a viewer grant (devnet.viewer-grant) asks to open a company's site. The service asks the site to mint a one-time link that signs them in read-only and expires in minutes, and answers it. The site never calls " +
    "the service; the person's browser goes straight to the site with the link. A person with no viewer grant and no site user is ROLE_PERMISSION_DENIED. Core keeps an audit row, never the link. Assumption, not yet tested: the site's mintViewLink; the spike made no viewer link, so the viewer eval (devnet.viewer-grant) proves it.",
  concept: concept_plugs,
  kind: "action",
  who: "A signed-in person with a viewer grant for the Organization's world, or a member of the Organization.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ url: S, expiresAt: N, readOnly: Schema.Boolean }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_site_users],
  writes: [table_site_links],
  calls: [integration_frappe_site.c.mintViewLink],
  budget: { class: "vendor", p50Ms: 1500, p95Ms: 4000 },
  was: ["docs/mission/worlds.md (section 7, decision 7)"],
});

export const rpc_plugs_sessions_mint = rpc({
  id: "plugs.sessions.mint",
  title: "Sign a short-lived assertion for a person on their site",
  about:
    "For a CLI or an agent that reaches the site as a person (every door call does): the service signs {user, site, expiry 60 s, nonce} and sends it as `X-Capxul-Assertion`; the site checks the signature, the site name, the expiry (host time), that the User is enabled and wears at least one hat, " +
    "then runs as that User. A person with no site user is ROLE_PERMISSION_DENIED. Nothing is stored for the person: no password, key or token, and no call to the site of its own and no callback to the service (plugs.door-assertion). Shown by the spike's door.",
  concept: concept_plugs,
  kind: "action",
  who: "A signed-in person or agent, for themselves.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ expiresAt: N }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_site_users],
  writes: [table_site_links],
  calls: [],
  budget: { class: "vendor", p50Ms: 1500, p95Ms: 4000 },
  was: ["spikes/skeleton/FINDINGS.md (The door: how a person is reached without a browser and without a stored password)"],
});
