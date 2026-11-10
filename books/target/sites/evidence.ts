// What the spike's CRM, feature-switch, names and follow-up sections decided for the sites. Coordinator's decisions on Aaron's delegation of the book; each says what the
// spike showed and what waits on a test, a lawyer or a later design. None is on the owner's list. Evidence: spikes/skeleton/FINDINGS.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY } from "../plugs/kit.ts";

const SW = "spikes/skeleton/FINDINGS.md, CRM, WhatsApp and feature switches";
const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; evidence: string }) =>
  defineDecision({ ...spec, source: BY(spec.evidence), affects: [f.system_capxul, f.concept_sites, f.component_frappe_app] as never });

export const decision_sites_feature_switch_authority = dec({
  id: "sites.feature-switch-authority",
  title: "A feature switch is a Core setting checked on the chain, not a chain event",
  question: "Is turning a part on or off chain authority, as a hat is, or a setting Core owns?",
  options: [
    { label: "core-setting", text: "Core checks that the caller wears the admin hat on the chain, then asks the site service to switch; the site keeps one `Capxul Feature` row per feature that a hand edit cannot change, Administrator included. A site operator with the bench can still flip a row with no chain event, so the drift check (plugs.roles-follow-hats) lists feature rows that differ from Core's setting. Making a switch a chain event is open, not on the owner's list: it waits on the contracts' next change." },
    { label: "chain-event", text: "A switch is a chain event that the site mirrors, as a hat is." },
  ],
  chosen: "core-setting",
  why: "Spike: the switch worked through Core with a hat check on the chain stand-in; `feature on|off` took 4.5 to 6 s, `on whatsapp` with its install 7.6 s (FINDINGS, CRM: Measured). The bench operator's reach is the same as for roles (FINDINGS, Frappe half: Roles follow hats, Cannot be locked).",
  evidence: SW,
});

export const decision_sites_what_off_closes = dec({
  id: "sites.what-off-closes",
  title: "What 'off' closes: a request guard, the module block, two backstops",
  question: "What does a switched-off part promise, and which of six candidate closings ships?",
  options: [
    {
      label: "four-layers",
      text:
        "Tried on a site against seven ways to reach Project (REST list, read, create, frappe.client.get_list, reportview.get, get_count, getdoctype), as the admin-hat person and as Administrator: hiding the Workspace and removing roles close " +
        "nothing for the admin hat (Project is readable by Desk User); blocking the module removes the desk entry and leaves REST open; the has_permission hook refuses a document, not a list, and Administrator skips it; the " +
        "permission_query_conditions hook returns an empty list (off looks like empty); only a before_request guard answers 403 on all seven routes for everyone. Ships: the module block (A), the guard (D3) and both hooks (D1, D2) as backstops. " +
        "Data is kept; on again shows it all. NOT closed, stated: bench console, bench execute, raw SQL, a patch, a Server Script, a scheduled job (an off app's scheduler keeps running), a whitelisted method that names no DocType " +
        "(the guard recognises doctype in the path and in `doctype`, `dt`, `reference_doctype`, `parent` or a JSON `doc`; app-wide method prefixes are guarded for crm, whatsapp, projects, manufacturing and payroll, not for accounts, people or stock, which share methods), a page already open. " +
        "ERPNext's parts are not separable: Item, UOM, Price List and Item Group live in Stock but an invoice needs them, so `stock` off means no stock features, not no Stock module, and a short list of shared masters stays reachable. `accounts` off would close the payment flow and is never switched in tests.",
    },
    { label: "module-block-only", text: "Only Frappe's own module block: it leaves REST and RPC open." },
  ],
  chosen: "four-layers",
  why: "FINDINGS, CRM, WhatsApp and feature switches: Feature switches: what off is, and what each candidate closed; What 'off' does not close. Refinement of sites.features-reachability, which says what a switch is; this says what it does and does not stop.",
  evidence: SW,
});

export const decision_sites_apps_and_upgrades = dec({
  id: "sites.apps-and-upgrades",
  title: "All sites of a bench share app versions; upgrades roll by cohort, staging first",
  question: "Where do apps live, and what is the upgrade policy?",
  options: [
    { label: "bench-cohort", text: "Every app Capxul supports is on the bench once and installed on every site, so a CRM upgrade is every company's upgrade. Adding CRM took 145 s on the bench once and 8 to 9 s per site, WhatsApp 8 s and 4 s, `bench migrate` 6 to 7 s per site, and the bench container must restart (6 s) when an app or a hook is added. Policy: a staging bench takes the new pin first, the scan and the time tests run on it (devnet.time-is-right), then each cohort of companies rolls; the company template is rebuilt when an app is upgraded (a restore of an older schema needs a migrate). `bench get-app` rewrites sites/apps.txt and drops the Capxul app: the add-app script puts it back after every get-app." },
    { label: "site-by-site", text: "Each company pins its own app versions." },
  ],
  chosen: "bench-cohort",
  why: "FINDINGS, CRM: Measured and Things the bench did that were not expected; The company template. The cohort size and the date of each roll are open and not on the owner's list: they are set when there is more than one paying company.",
  evidence: SW,
});

export const decision_sites_whatsapp_ownership = dec({
  id: "sites.whatsapp-ownership",
  title: "WhatsApp: the company's own Meta account; the tab rests on a one-person app",
  question: "Who holds each company's WhatsApp account, and which app does the CRM tab use?",
  options: [
    { label: "company-owns-account", text: "OPEN, not on the owner's list: it waits on the first company that wants WhatsApp. What is known: the app is installed and unconfigured on every site; nothing was sent, received or synced (it needs credentials). Each company brings its own Meta Business portfolio, WhatsApp Business Account, registered number with an approved display name and a permanent access token of a system user; the token is a stored password on that company's site in `WhatsApp Account`; the webhook must be reachable over https from the internet, which `<slug>.localhost` is not and the hosted address is. CRM v16 reads the third-party app frappe_whatsapp (one maintainer); CRM develop has moved to the official frappe/whatsapp. Capxul pins v16 and plans the migration for CRM v2 (sites.crm)." },
  ],
  chosen: "company-owns-account",
  why: "FINDINGS, CRM, WhatsApp and feature switches: What is installed; WhatsApp: what it needs from the owner. Not tested: sending, receiving, template sync, the webhook.",
  evidence: SW,
});

export const decision_sites_deal_to_customer = dec({
  id: "sites.deal-to-customer",
  title: "A Won deal becomes a Customer by configuration; what more it must become is open",
  question: "What must a Won CRM deal turn into?",
  options: [
    { label: "customer-only-open", text: "Configuration only, no code of ours: a Customer named after the deal's organisation (or the contact, as an Individual), its currency, territory and industry when present and known, its website, and a back reference both ways. It does not carry the deal value, products, notes, emails, calls, tasks or the owner, and makes no Opportunity, Quotation or Sales Order; a Quotation is made from the deal's button. It fires once, on Won, finds a Customer by name (two deals for one organisation share it) and, when the person lacks Customer create permission, saves the deal with no customer and a line in the Error Log. Whether a Won deal must also become a Quotation, a Sales Order or a budget, and whether a customer's Safe address appears from the deal, is OPEN and not on the owner's list: it waits on the first sales eval (the `sales` hat)." },
  ],
  chosen: "customer-only-open",
  why: "FINDINGS, CRM: The link from a won deal to an ERPNext Customer (checked end to end in the spike's run). Addresses and contacts carrying across were not tested.",
  evidence: SW,
});

export const decision_sites_rename_limits = dec({
  id: "sites.rename-limits",
  title: "What cannot be renamed without rebuilding the CRM's front end",
  question: "After the names-only work, what still says Frappe or ERPNext, and is it worth a fork?",
  options: [
    { label: "keep-and-ask-lawyer", text: "Counted by a crawl of the pages, the CRM's front-end files and the desk's bundles: of 76 places a person read that said Frappe or ERPNext, 3 distinct strings remain (`Frappe CRM` in the manifest, the About dialog and the setup footer; `ERPNext CRM Settings` in the CRM settings sidebar; `No synced ERPNext Items`), 46 are replaced through translations, 2 are the copyright notice kept on purpose, 7 are third-party product names counted apart (Frappe Mail, Frappe Cloud), and 250 are identifiers a person does not read as text. The manifest is a static file served from /assets where no hook runs: it and the three strings are hard-coded in the CRM's Vue source and only a rebuild can rename them. A rebuild is a modification of an AGPL-3.0 app, so it waits on a lawyer (sites.agpl); a proxy rewrite of the manifest in production is the cheap alternative, not tried. Logos are images, a design job. Not checked: printed PDFs, emails other than the footer, the About version list, text built at run time or in lazily loaded chunks." },
  ],
  chosen: "keep-and-ask-lawyer",
  why: "FINDINGS, Names only; Follow-up: a more honest name count. Refinement of sites.names-only.",
  evidence: "spikes/skeleton/FINDINGS.md, Names only; Follow-up: what phones home, and a more honest name count",
});

export const decision_sites_agpl = dec({
  id: "sites.agpl",
  title: "AGPL: whether hosting the CRM obliges a source offer waits on a lawyer",
  question: "Does hosting Frappe CRM for customers as part of a product oblige a source offer, and where is it published?",
  options: [
    { label: "lawyer-first", text: "OPEN, not on the owner's list: a lawyer's question. Read from the licence files on the bench: Frappe MIT, ERPNext and Frappe HR GPL-3.0, Frappe CRM AGPL-3.0 (its crm/www/crm.py header says GPLv3, which disagrees with the repository licence), frappe_whatsapp MIT. AGPL section 13 bites a hosted product: users who interact with the CRM over a network must be offered its corresponding source, including any change Capxul makes. The Capxul app is not a modified CRM (it uses hooks), which the no-fork rule keeps simple; the lawyer should say whether the translation rows and the title rewrite count as modifying it, and whether hiding 'Frappe' from the interface fits GPL-3.0 section 7(e) on trademarks. Until then: no fork of any app, and the copyright notice and About dialog stay." },
  ],
  chosen: "lawyer-first",
  why: "FINDINGS, Names only: What a lawyer should look at (a list of where to look, not an opinion). Joins the lawyer's other questions in payroll.route.",
  evidence: "spikes/skeleton/FINDINGS.md, Names only: What a lawyer should look at",
});

export const decision_sites_outward_calls = dec({
  id: "sites.outward-calls",
  title: "What a site sends outward and how it is switched off, and what no setting stops",
  question: "What did the sites report outward by default, and how is each held off?",
  options: [
    { label: "held-off-by-hooks", text: "Found by reading the apps and each site's settings: the weekly update check asked GitHub (it was on in all three sites; now forced off); Pulse telemetry needs a conf key and a setting (no key ships; the setting is forced to 0 by a validate hook so the CRM's pre-ticked consent box cannot enable it); the CRM first-run screen (skipped, setup_completed 1); CRM domain enrichment (off, forced); Sentry (not set; a deployment must not set a DSN). One command applies it to new and existing sites after every migrate. NOT stoppable by configuration: a pulse key in a site or common config (the hook stops the setting, not the key), so a deployment rule: no vendor keys in config; and outbound calls made on use: exchange-rate lookups, Exotel and Twilio when configured, enrichment if enabled, the Frappe Cloud dialogs on a site marked as one. This is from the code, not a packet capture: the packet capture is a gap, settled by an egress test on the first hosted site (m3b-first-shared-world)." },
  ],
  chosen: "held-off-by-hooks",
  why: "FINDINGS, Follow-up: what phones home. Refinement of sites.privacy.",
  evidence: "spikes/skeleton/FINDINGS.md, Follow-up: what phones home",
});
