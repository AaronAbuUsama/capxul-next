// The sites' data: each Organization's hosted Frappe site, its feature switches, and the record of the calls the document door made.
// A site belongs to one world (one chain with every company on it and one clock) and one Organization. Its address is
// `<company>-<world>.<base>`, a single label, so one wildcard certificate covers every world (docs/mission/sites-host/ingress.md);
// a world id therefore has no hyphen. Two state machines, each with its one event (P7): a site's life and a feature's switch.
// Frappe holds the site's own data; nothing here copies it. Evidence: spikes/skeleton FINDINGS (Numbers measured; Feature switches).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { B, N, Null, S } from "../plugs/kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const ORG = "The Organization is the tenant (P8): `org_id` leads the key and every index.";

export const SiteState = Schema.Literals(["creating", "ready", "suspended", "archived", "failed"]);
export const FeatureState = Schema.Literals(["off", "on", "switching"]);

/** The features a company can switch. Every supported app is installed on every site; a switch controls only what is reachable (sites.features-reachability). */
export const FEATURES = ["accounts", "people", "projects", "crm", "payroll", "whatsapp", "attendance", "recruitment", "reviews", "stock", "manufacturing"] as const;
export const Feature = Schema.Literals(FEATURES);

export const table_sites = defineTable({
  id: "sites",
  title: "Sites: each Organization's hosted Frappe site",
  about:
    "One row per Organization: its world, its slug and address (`<company>-<world>.<base>`), its state (site), the bench that serves it and the versions it runs " +
    "(the Capxul app and the hat-role map). A site is created because its Organization was set up, never by connecting one from outside. The spike's site took 143 s to create " +
    "cold and 7 s to repeat for the same slug (FINDINGS, Numbers measured). Frappe's own records are not copied here: Frappe holds them.",
  was: [`${SPIKE} (Numbers measured; INTERFACE.md: Creating an org)`],
  concept: concept_sites,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    site_id: S,
    world_id: S,
    slug: S,
    host: S,
    state: SiteState,
    bench: S,
    app_version: Null(S),
    map_version: Null(S),
    failure: Null(S),
    created_at: N,
    ready_at: Null(N),
    updated_at: N,
  }),
  key: ["org_id", "site_id"],
  indexes: [
    { name: "sites-by-host", fields: ["host"], unique: true, crossTenant: true, for: "The site service and the provider find the Organization a hostname belongs to." },
    { name: "sites-by-world", fields: ["org_id", "world_id"], for: "A world lists its companies' sites." },
  ],
  retention: "Kept: an archived site stays listed.",
});

export const table_site_features = defineTable({
  id: "site-features",
  title: "Site features: which parts of a site are reachable",
  about:
    "One row per (Organization, feature): on, off or switching, who asked and when. Off closes the part's screens and API (every request refuses with FEATURE_NOT_AVAILABLE) and keeps its " +
    "data; on makes it reachable again with everything that was there. Every supported app is installed on every site, so a switch never installs or uninstalls anything (sites.features-reachability). " +
    "A new site starts with accounts (with banking), people (staff records, leave and expenses), projects and crm on; payroll installed but off until the UK filing route is chosen; whatsapp, attendance, " +
    "recruitment, reviews, stock and manufacturing off.",
  was: [`${SPIKE} (Feature switches: what off is)`],
  concept: concept_sites,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    feature: Feature,
    state: FeatureState,
    wanted: B,
    requested_by: Null(S),
    failure: Null(S),
    updated_at: N,
  }),
  key: ["org_id", "feature"],
  indexes: [{ name: "site-features-by-state", fields: ["org_id", "state"], for: "The reconcile process finds switches left half-way." }],
  retention: "Kept while the site exists.",
});

export const table_door_calls = defineTable({
  id: "door-calls",
  title: "Door calls: what each call through the document door did",
  about:
    "One row per door call: who, the verb, the document type and name, the outcome (ok, refused, held for the signer, failed) and the refusal code. It makes a retry of the same call id answer what " +
    "the first did, and lets `doc` say a money document is held. It is not the record of everything the system does: that is the world's record, which holds this call as one entry among all (devnet.record-entry). " +
    "No document body or field value is kept here.",
  was: [`${SPIKE} (INTERFACE.md); organizations.doc-log (archived with the head)`],
  concept: concept_sites,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    call_id: S,
    person_id: S,
    verb: S,
    doctype: Null(S),
    docname: Null(S),
    outcome: Schema.Literals(["ok", "refused", "held", "failed"]),
    refusal: Null(S),
    created_at: N,
  }),
  key: ["org_id", "call_id"],
  indexes: [{ name: "door-calls-by-person", fields: ["org_id", "person_id", "created_at"], for: "A person's recent calls, newest first." }],
  retention: "Kept for ever with the world's record.",
});

export const event_site_transitioned = defineEvent({
  id: "site_transitioned",
  about:
    "A site changed state: began creating, became ready, failed to create, was retried, suspended, resumed or archived. Carries the Organization, the world and the new state; never the host or any " +
    "Frappe data. The 'an organisation is one command' journey and the world's record read it.",
  props: Schema.Struct({
    from: Null(SiteState),
    to: SiteState,
    transition: Schema.Literals(["begin", "ready", "fail", "retry", "suspend", "resume", "archive"]),
    org_id: S,
    world_id: S,
  }),
  was: [`${SPIKE} (Numbers measured)`],
});

export const event_site_feature_transitioned = defineEvent({
  id: "site_feature_transitioned",
  about:
    "A feature was seeded with a new site, asked for on or off, settled, or put back because the site did not switch it. Carries the Organization, the feature and the state; never who asked.",
  props: Schema.Struct({
    from: Null(FeatureState),
    to: FeatureState,
    transition: Schema.Literals(["seed_on", "seed_off", "request", "settle_on", "settle_off", "revert_on", "revert_off"]),
    org_id: S,
    feature: Feature,
  }),
  was: [`${SPIKE} (Feature switches)`],
});

const SE = [event_site_transitioned];
export const machine_site = defineMachine({
  id: "site",
  title: "A site: creating, ready, suspended, archived or failed",
  about:
    "sites.state. Born creating when the Organization's setup completes. It becomes ready when the site service has made the site, the sign-in is configured and the first events are delivered. A failed " +
    "creation can be retried (the script is safe to repeat). A suspended site refuses every request until resumed; an archived one is kept listed and never served again.",
  table: table_sites,
  field: "state",
  initial: "creating",
  states: [
    { id: "creating", about: "The service is making the site." },
    { id: "ready", about: "The site answers and people can sign in." },
    { id: "suspended", about: "Switched off by Capxul (unpaid, abuse, a restore in progress); data kept." },
    { id: "archived", about: "Closed for good; the record stays.", terminal: true },
    { id: "failed", about: "Creation did not finish; the failure is kept." },
  ],
  transitions: {
    begin: { from: [], to: "creating", about: "The birth: sites.create, after the Organization's setup completed.", emits: SE },
    ready: { from: ["creating"], to: "ready", about: "The site, its sign-in and its first events are in place.", emits: SE },
    fail: { from: ["creating"], to: "failed", about: "The service or the bench did not finish.", emits: SE },
    retry: { from: ["failed"], to: "creating", about: "`org site retry`: the script runs again.", emits: SE },
    suspend: { from: ["ready"], to: "suspended", about: "Capxul suspends the site.", emits: SE },
    resume: { from: ["suspended"], to: "ready", about: "Capxul resumes it.", emits: SE },
    archive: { from: ["ready", "suspended", "failed"], to: "archived", about: "The Organization is closed.", emits: SE },
  },
  was: [`${SPIKE} (Frappe half: Numbers measured; End to end: What broke, 2)`],
});

const FE = [event_site_feature_transitioned];
export const machine_site_feature = defineMachine({
  id: "site-feature",
  title: "A feature switch: off, on or switching",
  about:
    "site-features.state. Seeded on or off when the site is made. A request moves it to switching with the wanted state; the site service sets the Capxul Feature row, re-saves every user and clears caches " +
    "(4.5 to 6 s measured), and the switch settles. If the site does not switch it, the state goes back. Off never destroys data.",
  table: table_site_features,
  field: "state",
  initial: "off",
  states: [
    { id: "off", about: "Closed: screens and API refuse; data kept." },
    { id: "on", about: "Reachable to the people whose hats give a role in it." },
    { id: "switching", about: "A request is being applied on the site." },
  ],
  transitions: {
    seed_on: { from: [], to: "on", about: "The birth of a default-on feature.", emits: FE },
    seed_off: { from: [], to: "off", about: "The birth of a default-off feature.", emits: FE },
    request: { from: ["on", "off"], to: "switching", about: "`org feature on` or `off` by a Director-hat wearer; `wanted` says which.", emits: FE },
    settle_on: { from: ["switching"], to: "on", about: "The site confirmed it is reachable.", guard: "wanted is true", emits: FE },
    settle_off: { from: ["switching"], to: "off", about: "The site confirmed it is closed.", guard: "wanted is false", emits: FE },
    revert_on: { from: ["switching"], to: "on", about: "The site did not switch it off; it stays on.", guard: "wanted is false", emits: FE },
    revert_off: { from: ["switching"], to: "off", about: "The site did not switch it on; it stays off.", guard: "wanted is true", emits: FE },
  },
  was: [`${SPIKE} (Feature switches: what off is)`],
});
