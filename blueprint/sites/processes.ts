// The sites' durable processes: creating a site when its Organization is set up, applying a feature switch on the site, and a daily
// reconcile that finds a switch or a site the site does not agree with. Each writes only sites' own tables; the site service and the site
// are reached through their integrations, never inside a transaction.

import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { machine_org_setup, table_org_deployments, table_org_members } from "../organizations/data.ts";
import { integration_frappe_site, integration_site_service } from "../plugs/integrations.ts";
import { procedure_plugs_oauth_register_client } from "../plugs/signin.ts";
import { procedure_plugs_events_enqueue } from "../plugs/events.ts";
import { machine_site, machine_site_feature, table_site_features, table_sites } from "./data.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";

export const workflow_sites_create = defineWorkflow({
  id: "sites.create",
  title: "Make an Organization's site when its setup completes, and bring it up to date",
  about:
    "Triggered when the Organization's setup completes (the chain's part is real). One process per site: it begins the site, asks the site service to create it on the world's bench (the site, every supported " +
    "app, the Company, the Safe's bank account, the names, privacy and the hat-role map), registers the sign-in client and configures the site's Social Login Key, seeds the feature rows (accounts, people, " +
    "projects and crm on; payroll installed but off; the rest off), and enqueues `org_created` so the Organization's events are delivered from number 1 (plugs.history-lives-in-core). The script is safe to repeat, so " +
    "a retry after a failure, or a second run for an Organization whose site was dropped, finishes the job. The site is ready only when its first events are applied. Measured: 143 s cold on a laptop, 7 s to repeat; a " +
    "bench in the cloud is not measured (docs/mission/cloud.md). The address is `<company>-<world>.<base>`.",
  concept: concept_sites,
  priority: "critical",
  trigger: { transition: machine_org_setup.t.complete },
  instance: "singleton",
  steps: [
    { name: "begin", about: "Makes the site row creating." },
    { name: "create", about: "Asks the site service to create the site." },
    { name: "sign-in", about: "Registers the OAuth client and configures the Social Login Key." },
    { name: "features", about: "Seeds the feature rows from the defaults." },
    { name: "events", about: "Enqueues org_created; delivery brings the site to the Organization's present." },
    { name: "ready", about: "Marks the site ready once the site answers and the first events are applied." },
  ],
  reads: [table_sites, table_site_features, table_org_members, table_org_deployments],
  writes: [table_sites, table_site_features],
  drives: [machine_site.t.begin, machine_site.t.ready, machine_site.t.fail, machine_site_feature.t.seed_on, machine_site_feature.t.seed_off],
  invokes: [procedure_plugs_oauth_register_client, procedure_plugs_events_enqueue],
  emits: [],
  calls: [integration_site_service.c.createSite, integration_site_service.c.configureSignIn],
  chain: [],
  idempotency: "One site per Organization (the unique key); the service's script is safe to repeat; events are keyed.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "fixed" },
  compensation: "A site that did not finish is failed with the reason; `org site retry` runs it again.",
  budget: budget("background"),
  was: [`${SPIKE} (Numbers measured; End to end: What broke, 2)`],
});

export const workflow_sites_features_apply = defineWorkflow({
  id: "sites.features.apply",
  title: "Apply a feature switch on the site",
  about:
    "Triggered by a request on a feature. It asks the site service to switch the part (set the Capxul Feature row, re-save every user so blocked modules follow, clear caches; 4.5 to 6 s measured) and settles the " +
    "switch on or off by what was wanted; if the site does not switch it, the state goes back to what it was and the reason is kept. WhatsApp needs CRM: the pair is checked before anything is changed. Off never " +
    "destroys data and never uninstalls an app (sites.features-reachability). The scheduled jobs of an off part keep running: not stopped.",
  concept: concept_sites,
  priority: "normal",
  trigger: { transition: machine_site_feature.t.request },
  instance: { per: table_site_features },
  steps: [
    { name: "switch", about: "Asks the site service to switch the part." },
    { name: "settle", about: "Settles the switch by what was wanted, or puts it back with the reason." },
  ],
  reads: [table_site_features, table_sites],
  writes: [table_site_features],
  drives: [machine_site_feature.t.settle_on, machine_site_feature.t.settle_off, machine_site_feature.t.revert_on, machine_site_feature.t.revert_off],
  invokes: [],
  emits: [],
  calls: [integration_site_service.c.switchFeature],
  chain: [],
  idempotency: "One switch in flight per (Organization, feature); the service's script is idempotent.",
  timeoutMs: 120_000,
  retries: { max: 2, backoff: "exponential" },
  budget: budget("background"),
  was: [`${SPIKE} (Feature switches: what off is; Measured)`],
});

export const workflow_sites_reconcile = defineWorkflow({
  id: "sites.reconcile",
  title: "Each day check that every site agrees with Capxul's rows",
  about:
    "Reads each ready site and compares its Capxul Feature rows and app and map versions with Capxul's: a switch left half-way is applied again, a site that does not answer is reported to the Organization's Director, a " +
    "feature the site shows on that Capxul says off is closed. It never changes Frappe's data. Runs at 04:00 on the world's clock.",
  concept: concept_sites,
  priority: "normal",
  trigger: { cron: "0 4 * * *" },
  instance: "singleton",
  steps: [
    { name: "read", about: "Reads each ready site." },
    { name: "compare", about: "Compares its features and versions with Capxul's rows." },
    { name: "repair", about: "Re-requests a switch the site does not show." },
  ],
  reads: [table_sites, table_site_features],
  writes: [table_site_features],
  drives: [machine_site_feature.t.request],
  invokes: [],
  emits: [],
  calls: [integration_frappe_site.c.readSite],
  chain: [],
  idempotency: "One run per world day.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "fixed" },
  budget: budget("background"),
  was: [`${SPIKE} (What the design must now decide, 2 and 3 of the feature switches)`],
});
