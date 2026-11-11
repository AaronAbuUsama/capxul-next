// The sites' decisions, sourced as the coordinator's on Aaron's delegation, each with the spike evidence it rests on or marked as an
// assumption to be tested. Rulings they serve: aaron.one-door and aaron.frappe-native (aaron.one-product for the names).

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY, FIND } from "../plugs/kit.ts";
import * as d from "./data.ts";
import * as door from "./door.ts";
import * as ops from "./operations.ts";
import * as pr from "./processes.ts";
import * as sr from "./sites.ts";
import { integration_frappe_site, integration_site_service } from "../plugs/integrations.ts";

const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; evidence: string; affects: readonly object[] }) =>
  defineDecision({ id: spec.id, title: spec.title, question: spec.question, options: spec.options, chosen: spec.chosen, why: spec.why, source: BY(spec.evidence), affects: spec.affects as never });
const R = "aaron.one-door and aaron.frappe-native";
const DOOR_OPS = [ops.operation_doc_types, ops.operation_doc_schema, ops.operation_doc_list, ops.operation_doc_get, ops.operation_doc_create, ops.operation_doc_update, ops.operation_doc_delete, ops.operation_doc_submit, ops.operation_doc_cancel, ops.operation_doc_amend, ops.operation_doc_call, ops.operation_doc_next, ops.operation_report_list, ops.operation_report_run];
const FEATURE_OPS = [ops.operation_org_feature_list, ops.operation_org_feature_on, ops.operation_org_feature_off];
const SITE_OPS = [ops.operation_org_site_show, ops.operation_org_site_open, ops.operation_org_site_retry];

export const decision_sites_lifecycle = dec({
  id: "sites.lifecycle",
  title: "A site is made when its Organization is set up, never connected from outside",
  question: "When and how does a company get its Frappe site?",
  options: [
    { label: "created-with-the-org", text: "Every Organization gets a site on its world's bench when its setup completes: the site, every supported app, the Company, the Safe's bank account, the names, privacy and the hat-role map, then the sign-in and the first events. The script is safe to repeat; a failed creation is retried with `org site retry`. Nothing is connected from outside: the old `org head connect` is gone (cut.organizations)." },
    { label: "connect-a-head", text: "A company connects a Frappe site it runs (the old optional head)." },
  ],
  chosen: "created-with-the-org",
  why: `${R}: Capxul hosts its own skinned Frappe for every Organization. The spike did it in 143 s cold and 7 s to repeat, with no fork (FINDINGS, Numbers measured). Re-creating a site for an Organization that already had events left it empty until the outbox resent from 1 (plugs.history-lives-in-core).`,
  evidence: FIND.e2e,
  affects: [f.system_capxul, f.concept_sites, d.table_sites, d.machine_site, pr.workflow_sites_create, sr.rpc_sites_show, sr.rpc_sites_retry, ...SITE_OPS, integration_site_service],
});

export const decision_sites_features_reachability = dec({
  id: "sites.features-reachability",
  title: "Every app is installed on every site; a switch controls only reachability",
  question: "What does turning a feature on or off do on a site?",
  options: [
    { label: "reachability", text: "Every app Capxul supports is installed on every site. `org feature off` closes the part's screens and API (every request answers FEATURE_NOT_AVAILABLE) and keeps the data; `on` makes it reachable with everything that was there. A switch never installs or uninstalls. On by default: accounts with banking, people (staff records, leave and expenses), projects and CRM. Payroll is installed but not in the base set until the first jurisdiction and its payroll support are chosen (aaron.jurisdiction-open). Off by default: WhatsApp sending, attendance, recruitment, reviews, stock, manufacturing. The Director hat switches, checked on the chain now; the switch is a Core setting, not a chain event (sites.feature-switch-authority; what off closes is sites.what-off-closes)." },
    { label: "install-on-demand", text: "Install an app when a feature is turned on, as the spike's first version did." },
  ],
  chosen: "reachability",
  why: "The spike tried six ways to close a part. The request guard (D3) is the only one that refuses outright, for every person and for Administrator; the module block, the permission hooks and the query condition cover desk, documents and lists (FINDINGS, Feature switches: what off is). Installing took 145 s once per bench and 9 s per site, and an app upgrade is every company's upgrade, so installing everywhere once is simpler. What off does not close, stated: the bench console, raw SQL, a patch, a Server Script, a scheduled job; whitelisted methods that name no DocType; ERPNext's shared masters (Item, UOM) with stock off; a page already open. Roles for a part that is off are still given; the guard closes the part.",
  evidence: FIND.features,
  affects: [f.system_capxul, d.table_site_features, d.machine_site_feature, pr.workflow_sites_features_apply, pr.workflow_sites_reconcile, sr.rpc_sites_features_list, sr.rpc_sites_features_on, sr.rpc_sites_features_off, ...FEATURE_OPS],
});

export const decision_sites_door = dec({
  id: "sites.door",
  title: "The CLI and SDK reach Frappe through one door, as the calling person",
  question: "How do people and agents work with Frappe's documents, actions and reports?",
  options: [
    { label: "one-door", text: "Twelve `doc` verbs (types, schema, list, get, create, update, delete, submit, cancel, amend, call, next) and `report list|run`, each one rpc, each run as the calling person: the Capxul app sets the session user to the Frappe user a hat created, so Frappe's permissions, workflows and validations decide. A part that is off refuses with FEATURE_NOT_AVAILABLE. Money documents go through the signer: a Payment Entry from the Safe is held, never posted by the door. Nothing the door does is a Capxul table of the document." },
    { label: "frappe-api-direct", text: "Agents and UIs call each site's Frappe API directly." },
    { label: "refuse-money", text: "The door refuses money documents (the old document family)." },
  ],
  chosen: "one-door",
  why: `${R}: 'the whole purpose of the SDK and CLI is to have one unified API source' and the money refusal is replaced by the signer. These verbs replace the twelve of the old 'org head doc' family; the reports, the next-document mapper and printing were the three additions the old surface.head-methods proposed and are now required. The spike has since built the door and the book is checked against it (sites.door-awaits-spike).`,
  evidence: FIND.path,
  affects: [f.system_capxul, f.concept_sites, integration_frappe_site, ...DOOR_OPS, door.rpc_sites_door_submit, door.rpc_sites_door_cancel, door.rpc_sites_door_call],
});

export const decision_sites_door_awaits_spike = dec({
  id: "sites.door-awaits-spike",
  title: "The door's verbs were checked against the spike; what it did not show",
  question: "What does the book claim about how the door behaves on a real site?",
  options: [
    { label: "checked-against-the-spike", text: "The spike's door section (FINDINGS, The door, the recorder and the clock) showed: a person is reached without a browser by a short-lived assertion the service signs and the site checks (signature, site name, 60-second expiry in host time, an enabled User that wears at least one hat), with nothing stored for the person, then Frappe's own roles, user permissions and feature switches decide; the door reaches documents, actions and reports as the calling person (527 document types for an admin-hat person, 225 for a salesperson; errors as values); `doc submit` of a Safe Payment Entry comes back `Waiting for signature` with an approval id and the entry posts when the chain's event lands; a closed accounting period and a switched-off part are refused. Names of the spike's own error codes and of its methods are the spike's, not the book's. NOT shown, so still to prove by the first door evals: idempotency by call id, the exact `held` answer, and the timing of a report run. `doc next` is a guide, not a complete one: the form's Create buttons are client script, so the next-document list is Frappe's connections and its `make_*` mappers by name (FINDINGS, What the door reaches)." },
  ],
  chosen: "checked-against-the-spike",
  why: "Where a record states how Frappe behaves and only the spike has shown it, the record cites the section; where nobody has tried it, it says so. The door is now tried, so the marks are struck except the three named.",
  evidence: FIND.path,
  affects: [f.system_capxul, ...DOOR_OPS, integration_frappe_site],
});

export const decision_sites_names_only = dec({
  id: "sites.names-only",
  title: "The site says Capxul, not Frappe or ERPNext, by configuration, never a fork",
  question: "How does the site read as one product (aaron.one-product)?",
  options: [
    { label: "names-only", text: "The site language is English (UK) with Capxul's own translation rows, the app and 'Powered by' names are set, the page title and the email footer say Capxul, and the support link is gone. The copyright notice and the About dialog stay (the licences ask for them). What only a rebuild of the CRM front end could rename (its manifest, three strings) stays, and whether to rebuild it is a lawyer's question first." },
    { label: "fork", text: "Fork the apps and rename them." },
  ],
  chosen: "names-only",
  why: "76 distinct places a person reads said Frappe or ERPNext before; 2 after by the first count, 3 by the honest one; 46 are replaced through translations, 2 are the copyright notice, 7 are third-party names (Frappe Mail, Frappe Cloud) counted apart (FINDINGS, Names only; Follow-up: a more honest name count). Licences: Frappe MIT, ERPNext and HRMS GPL-3.0, CRM AGPL-3.0 (section 13 bites a hosted product), WhatsApp MIT: a lawyer's list, not an opinion.",
  evidence: FIND.names,
  affects: [f.system_capxul, f.component_frappe_app, f.concept_sites],
});

export const decision_sites_privacy = dec({
  id: "sites.privacy",
  title: "No site reports usage outward",
  question: "What may a hosted site send to anyone outside?",
  options: [
    { label: "nothing-outward", text: "The update check is off, telemetry is held off by a validate hook (the CRM's consent box cannot switch it on), the CRM's first-run screen is skipped, enrichment is off and no vendor key is set; a deployment must not set a Sentry DSN or a pulse key. What a company configures on purpose (email, social login, WhatsApp, exchange rates) is the product, not telemetry. Not measured on the wire: from the code, not a packet capture." },
    { label: "defaults", text: "Leave the apps' defaults." },
  ],
  chosen: "nothing-outward",
  why: "The update check was on (0) on all three sites: it was phoning home. The hook stops the setting, not a key in config, so the deployment rule matters (FINDINGS, Follow-up: what phones home).",
  evidence: FIND.phone,
  affects: [f.system_capxul, f.component_frappe_app, d.table_sites],
});

export const decision_sites_crm = dec({
  id: "sites.crm",
  title: "Frappe CRM is the CRM; the official WhatsApp app is the one to plan on",
  question: "Which CRM and which WhatsApp integration does the product build on?",
  options: [
    { label: "frappe-crm-official-whatsapp", text: "Frappe CRM (version-16) is the CRM and ships on every site. For WhatsApp, plan on the official Frappe app (`frappe/whatsapp`, MIT, Frappe Technologies), which CRM's next major already uses. Today CRM v16 reads the third-party app `frappe_whatsapp` (one maintainer), which is what the spike installed; Capxul pins that for now and migrates when CRM v2 lands. A Won deal becomes an ERPNext Customer by configuration; what else it must become is not decided (open, sites.deal-to-customer; the CRM's own licence question is sites.agpl)." },
    { label: "twenty", text: "Keep Twenty or another CRM beside Frappe." },
  ],
  chosen: "frappe-crm-official-whatsapp",
  why: "Frappe CRM ran on the bench with no patching, installed in 8 to 9 s per site after 145 s once per bench; the WhatsApp tab depends on the app CRM v16 names, and `develop` moved to the official one (FINDINGS, CRM, WhatsApp and feature switches: What is installed). Sending, receiving and the webhook need a Meta account and token and a public address, and are not tested.",
  evidence: FIND.crm,
  affects: [f.system_capxul, f.concept_sites, d.table_site_features],
});

export const decision_sites_machine = dec({
  id: "sites.machine-and-route",
  title: "One dedicated machine for company sites on the cloud, with one catch-all route",
  question: "Where do the sites of simulated worlds run, and how does a hostname reach one?",
  options: [
    { label: "one-machine-wildcard", text: "One dedicated machine on the existing cloud (16 GiB, about $84 a month by the tools worker's price) runs the bench (Frappe, its workers and scheduler, MariaDB, Redis), the site service, the backend and the chain of each world. One wildcard route reaches it: a site's address is `<company>-<world>.<base>`, a single label, so one wildcard certificate covers every world and a world id has no hyphen. Frappe picks the site from the hostname, so a new company needs no proxy change. MariaDB dumps and the sites folder join the nightly backup. Simulated worlds come first; a real-time environment for a real company is a second machine with the same images, later." },
    { label: "route-per-site", text: "A route and a certificate per hostname, as the existing proxy does." },
  ],
  chosen: "one-machine-wildcard",
  why: "Aaron approved the machine on 10 November (docs/mission/cloud.md, Needs Aaron). The existing front door holds one route and one certificate per exact hostname, which would put a proxy change and a certificate on every new company; nothing covers simulated time or an append-only record. Assumption, not yet tested: that OpenShip can register a wildcard route, memory on the machine, Let's Encrypt limits (cloud.md: Not determined from the repository); the first request through the route and the first loaded world settle them (m3b-create-machine, m3b-first-shared-world). The spike's naming alternative, `<company>.<world>`, needs one wildcard certificate per world, which is why the address is a single label. docs/mission/sites-host/ingress.md carries the address.",
  evidence: FIND.cloud,
  affects: [f.system_capxul, f.component_site_service, d.table_sites, integration_site_service],
});

export const decision_sites_one_bench = dec({
  id: "sites.one-bench",
  title: "One bench serves the sites of every world; a bench per world is the fallback",
  question: "Do worlds at different speeds share a bench?",
  options: [
    { label: "shared-bench", text: "One bench serves every company of every world; the clock a site reads is set per site from its world (the book's design puts the world in each site's config, so one bench can serve sites of different worlds if the patch keys on the site). All sites of a bench share the app versions, so an app upgrade is every company's upgrade; the policy is a staging bench first, then roll. The clock spike showed it can: two worlds ran at different times on one bench, the offset keyed by the site's world (devnet.clock-follows-what). A bench per world with a clock beneath it stays the option for a world that must be exact (devnet.site-follows-world 9)." },
    { label: "bench-per-world", text: "A bench per world from the start; about twice the memory." },
  ],
  chosen: "shared-bench",
  why: "docs/mission/worlds.md section 7, decision 4, accepted by the coordinator on Aaron's delegation. The clock spike now shows it (FINDINGS, The clock; Behaviour 9). One worker serving two sites of different worlds is not yet tested under load: devnet.time-is-right, test 5.",
  evidence: FIND.cloud,
  affects: [f.system_capxul, f.component_site_service, f.component_frappe_app, integration_site_service],
});

export const decision_sites_worlds = dec({
  id: "sites.worlds",
  title: "The templates the sites' refusals and claims are reached from",
  question: "Which named templates (snapshots of a world) do the site, feature and door operations start from?",
  options: [
    { label: "templates", text: "org-with-site (a company with its site ready), org-with-site-features (some parts switched off, with data in them), org-with-site-creating (a creation in progress or failed), org-with-site-down (the bench stopped), org-with-hats-on-site, org-with-held-payment, org-with-member and signed-out. Each is built from a world template by running operations and saved as a snapshot (plugs.worlds, devnet.worlds). Per docs/mission/worlds.md these are templates, not worlds." },
  ],
  chosen: "templates",
  why: "A refusal is only provable from a state that produces it.",
  evidence: FIND.path,
  affects: [f.system_capxul, ...SITE_OPS, ...FEATURE_OPS, ops.operation_doc_submit],
});

export const decision_sites_bench_image = defineDecision({
  id: "sites.bench-image",
  title: "How the company sites are packaged to run on our server",
  question:
    "Every company on Capxul gets its own Frappe site (its books, CRM and HR). To run those sites on our server for real, " +
    "rather than in the test setup, they need to be packaged: which software, at which exact versions, run in which way. " +
    "Should we package them as one locked, production-ready bundle that we test before it goes anywhere?",
  options: [
    { label: "one-locked-bundle", text: "One bundle, built from this repository, with every piece locked to an exact version: Frappe, ERPNext, Frappe HR, Frappe CRM, the WhatsApp add-on and our own Capxul app. The same bundle is tested here and then runs on the server, so what we tested is exactly what people use. It runs the way a live service should: each part separate and restarted on its own, no developer tools, nothing reporting usage to outside companies, and only one door open to the outside. A built-in check proves a company site comes up on it before it goes anywhere (22 checks, all passing today)." },
    { label: "follow-latest-versions", text: "Use Frappe's standard packaging, which picks up whatever each app's latest weekly release is at build time. Less to maintain, but two builds a week apart are not the same software, so a test no longer proves what will run." },
    { label: "reuse-test-setup", text: "Run the test sites' development setup on the server. Quickest, but it is a developer tool: everything restarts together, it is slower and less safe, and the first start takes 10 to 25 minutes." },
  ],
  chosen: "one-locked-bundle",
  why:
    "Recommended because it is the only option where the thing we tested is the thing that runs, and it is already built and passing its check. " +
    "Nothing here is hard to undo: a later bundle can change any version or any part, and nothing has been put on the server yet. " +
    "Detail for agents: packages/bench-image builds the image from apps.lock.json, which pins the frappe/build and frappe/base images by digest and each app by commit; the build refuses a checkout whose commit differs. " +
    "The capxul app is copied from this repository, so no token is needed to build. Assets are built for production and linked into the sites folder at every start. " +
    "It runs as gunicorn, two workers (short, long), the scheduler, the socket server and nginx, one container each, with MariaDB 11.8 and two Redis (cache without persistence, queue append-only); never bench start or bench serve. " +
    "Only nginx is published, on loopback, with the origin proxy in front on the machine. Secrets are generated once into an env folder (mode 0600), and only the site-admin container, which creates sites, holds the database root password. " +
    "The image carries capxul-image.json (bases and commits) for receipts and run manifests. bin/check.sh is the proof. " +
    "Frappe published v16.52 to v16.56 in four weeks, which is why branches are not pinned. WhatsApp is in the bundle because every supported app is installed on every site (sites.features-reachability); it stays off by default. " +
    "Proposed by a cloud thread on 11 November 2026 while Aaron was away (task m3b-bench-image), following the unbuilt draft docs/mission/sites-host/compose.md; Aaron's to confirm.",
  source: "packages/bench-image (README, apps.lock.json, bin/check.sh); docs/mission/sites-host/compose.md and bench-image.md; plan task m3b-bench-image",
  affects: [f.system_capxul, f.concept_sites, f.component_frappe_app, f.component_site_service, integration_site_service] as never,
});
