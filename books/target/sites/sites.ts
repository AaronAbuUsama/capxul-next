// The sites' own rpcs: read a site, open it, retry a failed creation, and the feature switches. The switches are the product's "what is on"
// (aaron.one-door: it is programmatic, through the CLI): Core checks the Director hat on the chain, records the request and lets the site
// service apply it; the site's request guard makes an off part answer 403 and keeps its data (FINDINGS, Feature switches: what off is).

import { Schema } from "effect";
import { concept_sites } from "../shared/foundation.ts";
import { error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_site_users } from "../plugs/data.ts";
import { N, Null, S, B, rpc } from "../plugs/kit.ts";
import { Feature, FeatureState, machine_site, machine_site_feature, SiteState, table_site_features, table_sites } from "./data.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const WHO_ADMIN = "The wearer of the Organization's Director hat (the skeleton's admin hat), read from indexing's wearers now.";
const WHO_MEMBER = "Any member of the Organization.";

export const SiteView = Schema.Struct({
  siteId: S, worldId: S, host: S, url: S, state: SiteState, bench: S, appVersion: Null(S), mapVersion: Null(S), failure: Null(S), createdAt: N, readyAt: Null(N),
});
export const FeatureView = Schema.Struct({ feature: Feature, state: FeatureState, defaultOn: B, about: S });

export const rpc_sites_show = rpc({
  id: "sites.show",
  title: "Read an Organization's site",
  about:
    "The site's state, its world, address, bench and the versions it runs, and why a failed creation failed. It reads Capxul's row, not the site, so it answers while the site is down.",
  concept: concept_sites,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: SiteView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_sites, table_org_members],
  was: [`${SPIKE} (Numbers measured)`],
});

export const rpc_sites_open = rpc({
  id: "sites.open",
  title: "Say where to open a company's site, and whether the caller can sign in",
  about:
    "Answers the site's address and whether the caller has a site user there (a hat created it). A person without one is told which hat they need, never given a way around sign-in. " +
    "A person watching a world with a viewer grant (devnet.viewer-grant) opens it read-only; that is the grant's, not this call's.",
  concept: concept_sites,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ url: S, canSignIn: B, needs: Null(S) }),
  errors: [error_NOT_AUTHENTICATED, error_WRONG_STATE],
  reads: [table_sites, table_site_users, table_org_members],
  was: [`${SPIKE} (INTERFACE.md: a company's site in a browser)`],
});

export const rpc_sites_retry = rpc({
  id: "sites.retry",
  title: "Run a failed site creation again",
  about:
    "A failed site moves back to creating and its creation process runs the safe-to-repeat script again (7 s for a slug that already has one). A site not failed is WRONG_STATE. It resends the " +
    "Organization's events from number 1 when the site is new (plugs.history-lives-in-core).",
  concept: concept_sites,
  kind: "mutation",
  who: WHO_ADMIN,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ siteId: S, state: Schema.Literal("creating") }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_sites, table_org_deployments, table_hat_wearers],
  writes: [table_sites],
  drives: [machine_site.t.retry],
  was: [`${SPIKE} (End to end: What broke, 2; Frappe half: new-site.sh again for the same slug)`],
});

export const rpc_sites_features_list = rpc({
  id: "sites.features.list",
  title: "List an Organization's features and whether each is on",
  about:
    "Every feature with its state (on, off or switching), whether it is on by default and what it is. It reads Capxul's rows, so it answers while the site is down; `readSite` is how the " +
    "reconcile process checks the site agrees.",
  concept: concept_sites,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ features: Schema.Array(FeatureView) }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_site_features, table_org_members],
  was: [`${SPIKE} (Feature switches)`],
});

const switchRpc = (to: "on" | "off") =>
  rpc({
    id: `sites.features.${to}`,
    title: to === "on" ? "Ask for a feature to be reachable" : "Ask for a feature to be closed, keeping its data",
    about:
      (to === "on"
        ? "Moves the feature to switching with wanted true; the site service makes it reachable and the people whose hats give a role in it see it. "
        : "Moves the feature to switching with wanted false; the site service closes its screens and API (every request refuses with FEATURE_NOT_AVAILABLE) and keeps every record, so turning it on again shows everything that was there. ") +
      "Only the Director hat may, checked on the chain now. WhatsApp needs CRM: turning WhatsApp on with CRM off, or CRM off with WhatsApp on, is WRONG_STATE and names the reason before anything is changed. " +
      "A feature already in the wanted state changes nothing. An unknown feature is INVALID_INPUT.",
    concept: concept_sites,
    kind: "mutation",
    who: WHO_ADMIN,
    input: Schema.Struct({ orgId: S, feature: Feature }),
    output: Schema.Struct({ feature: Feature, state: Schema.Literals(["switching", "on", "off"]) }),
    errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_INVALID_INPUT],
    reads: [table_site_features, table_org_deployments, table_hat_wearers, table_org_members],
    writes: [table_site_features],
    drives: [machine_site_feature.t.request],
    was: [`${SPIKE} (Feature switches; INTERFACE.md: Turning parts of the product on and off)`],
  });

export const rpc_sites_features_on = switchRpc("on");
export const rpc_sites_features_off = switchRpc("off");

void error_FEATURE_NOT_AVAILABLE;
