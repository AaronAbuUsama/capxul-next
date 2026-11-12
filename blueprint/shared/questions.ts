// Aaron's open questions of 11 November 2026, as decision records so the book's Questions page shows each one with a
// button per option. Five come from docs/mission/decisions-2026-11-11.md (written while binding the thin line and
// moving the spike into packages); the sixth, who owns the chart of accounts, comes from the blueprint audit of the
// same night. `chosen` is the recommendation, not his answer: each stays "for Aaron" (waiting.ts FLAGGED) until his
// answer is applied, when its id moves to ACCEPTED in rulings.ts or a ruling of his replaces it.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";

const SOURCE = "Cloud thread \"Validate the blueprint audit findings\", 11 November 2026, from docs/mission/decisions-2026-11-11.md";

export const decision_thin_line_bundler = defineDecision({
  id: "thin-line.bundler",
  title: "Does the test payment go through the real payment pipeline?",
  question:
    "Step 6 of the thin line (the one end-to-end test of the product) signs a held payment. The test says the money must move " +
    "the way it will in production: through the account-abstraction pipeline (a bundler and the EntryPoint contract). Today the " +
    "test world skips that pipeline to stay small, and the payer's key calls the contract directly, so step 6 cannot pass as " +
    "written. Should the thin line run in a world that has the real pipeline?",
  options: [
    { label: "canary-world", text: "Yes, in one special world. Only the thin line's test world gets the real bundler (with a test sponsor that pays gas); every other test world stays small. Step 6 stays as written and proves the real money path. Cost: the bundler has to be added to the test setup." },
    { label: "key-signed-is-enough", text: "No. Step 6 accepts the key-signed contract call. Cheapest, but the pipeline money really moves through is not tested until the staging server." },
    { label: "bundler-everywhere", text: "Yes, in every test world. Step 6 as written everywhere, but each world costs about four times the memory (about 0.6 GB instead of 0.15)." },
  ],
  chosen: "canary-world",
  why:
    "Recommended because it keeps the money path real on the one test that proves the product, and the decision that made test worlds small " +
    "(devnet.lean-world, point 3) already planned exactly one such 'canary' world. Nothing here is hard to undo. Detail for agents: row 6 of " +
    "evals/thin-line.md (acc:payment.send/1); component bundler-paymaster (alto behind the mock paymaster) in packages/devnet, used by the thin line's world only.",
  source: SOURCE,
  affects: [f.system_capxul, f.component_bundler_paymaster, f.component_devnet],
});

export const decision_books_founder_funding = defineDecision({
  id: "books.founder-funding",
  title: "How the money that first funds a company's account enters its books",
  question:
    "Step 7 of the thin line checks that the company's books agree with what its on-chain account (its Safe) really holds. A test " +
    "company's Safe is funded by a transfer in from outside that the books never record, so the two always differ by that first " +
    "deposit. How should that first deposit be booked?",
  options: [
    { label: "founder-capital", text: "As the founder putting money into the company: the first transfer that funds a new company's Safe is booked as the founder's capital. Any other unknown money coming in stays unmatched and visible, as today." },
    { label: "every-inflow-posts", text: "Every incoming transfer is booked, unknown ones to a visible 'waiting to be sorted' account. The books always match the chain, but this brings back the waiting account that was retired." },
    { label: "compare-known-only", text: "Keep the books as they are and change the test: compare only what the books know, and show the unmatched transfers next to the total. This changes what 'agree' means." },
  ],
  chosen: "founder-capital",
  why:
    "Recommended because it is how a founder's first deposit is really booked, it leaves the rule for unknown money (books.party-lines) as it is, " +
    "and it makes the check true without a suspense account. Detail for agents: row 7 of evals/thin-line.md (acc:report.run/1); a Journal Entry " +
    "debiting the Safe account and crediting share capital, the founder as the party.",
  source: SOURCE,
  affects: [f.system_capxul, f.concept_books],
});

export const decision_devnet_core_service_home = defineDecision({
  id: "devnet.core-service-home",
  title: "Where the working prototype of Capxul's own service goes",
  question:
    "The service that holds Capxul's own part (who may pay, budgets, payments) runs today as a prototype in spikes/ and saves to plain " +
    "files. The blueprint has two homes for it that do not match: one large service on Postgres, and a small service per test world on " +
    "a single SQLite file (the cheap test worlds already chosen). Where should the prototype be rebuilt?",
  options: [
    { label: "lean-service-in-devnet", text: "As the small per-world service, on SQLite, in the test-world package, using the prototype as its reference and keeping every check that passes today. The large production service is built separately when the staging server is next on the path." },
    { label: "one-service-two-storages", text: "One service for both: the same code runs on SQLite in test worlds and Postgres in staging. One service to build, but the Postgres design has to bend to fit." },
    { label: "move-then-convert", text: "Move the prototype as it is, then convert it to SQLite. Fastest move, but it carries the plain-file design into a real package." },
  ],
  chosen: "lean-service-in-devnet",
  why:
    "Recommended because the small world is what the thin line runs on, and building it on SQLite from the start avoids porting the storage twice. " +
    "It also settles which storage each environment uses: the devnet and shared-world environments run the lean service (devnet.lean-world); staging " +
    "keeps the Postgres design (component backend). Detail for agents: plan task m2-graduate-spike; spikes/skeleton/core.",
  source: SOURCE,
  affects: [f.system_capxul, f.component_backend, f.component_devnet, f.environment_devnet, f.environment_shared_world],
});

export const decision_devnet_cli_split = defineDecision({
  id: "devnet.cli-split",
  title: "Where the prototype's command-line tool goes",
  question:
    "The prototype's command-line tool mixes two jobs: product commands (company, hats, documents, approvals) and test-world commands " +
    "(make a world, move its clock, take a snapshot, export its record). The blueprint says each product command calls the Capxul " +
    "library exactly once and holds no other logic. How should it move?",
  options: [
    { label: "split", text: "Split it: the world, clock, snapshot and record commands become the test-world tool; the product commands move into the real CLI one at a time, as the library gains each method." },
    { label: "move-whole", text: "Move it all into the real CLI now and tidy it through the library later. Quicker, but it breaks the one-call rule until then." },
    { label: "leave-for-now", text: "Leave it in the prototype until the library has every method the thin line needs." },
  ],
  chosen: "split",
  why:
    "Recommended because it keeps the product CLI's rule (A4: one SDK call per command) true from the first command moved, and the world commands " +
    "already belong to the test-world supervisor. Detail for agents: component cli; packages/devnet; spikes/skeleton/cli.",
  source: SOURCE,
  affects: [f.system_capxul, f.component_cli, f.component_devnet],
});

export const decision_devnet_record_home = defineDecision({
  id: "devnet.record-home",
  title: "Where a test world keeps its record of what happened",
  question:
    "Each test world keeps a tamper-evident record of what happened in it (used for evidence and replay). The prototype writes it to a " +
    "file per world; the blueprint says a table. Where should it live?",
  options: [
    { label: "table-in-world-db", text: "A table in the world's own SQLite file. A snapshot of the world then copies one file, and the record's hash chain and redaction rules move unchanged." },
    { label: "file-per-world", text: "Keep a file per world, as the prototype does. Simple, but a second store beside the world's database." },
  ],
  chosen: "table-in-world-db",
  why:
    "Recommended because it fits the small-world design (devnet.lean-world): one file per world. It settles devnet.record-readers, which left " +
    "'file versus table' open. Detail for agents: devnet.record-entry in blueprint/devnet/world-decisions.ts.",
  source: SOURCE,
  affects: [f.system_capxul, f.component_devnet],
});

export const decision_books_chart_owner = defineDecision({
  id: "books.chart-owner",
  title: "Does Capxul keep its own copy of each company's chart of accounts?",
  question:
    "Each company's accounting runs in its own Frappe site (ERPNext), which already has the chart of accounts, reports and exports. The " +
    "cut ruled that ERPNext owns the books. But the blueprint's books records still describe Capxul's service holding its own copy of " +
    "the chart (accounts, cost centres, the company's accounting settings) and pushing finished vouchers into the site. Should Capxul's " +
    "service keep that copy?",
  options: [
    { label: "frappe-owns-chart", text: "No. ERPNext alone holds the chart. Capxul's service keeps only what it alone knows: the on-chain money facts, their notes (annotations) and the tokens it watches. The Capxul app inside the site turns each money fact into the right ERPNext entry. The books records are redrawn to that." },
    { label: "core-keeps-copy", text: "Yes. Capxul's service keeps its copy of the chart, works out every entry itself and pushes it to the site, as the records say today. The site never computes Capxul's posting rules, at the cost of two copies of the chart that must agree." },
    { label: "decide-at-breadth", text: "Not now. Leave the records as they are, marked as conflicting, and decide when the first books journey is built." },
  ],
  chosen: "frappe-owns-chart",
  why:
    "Recommended because it is what the cut already ruled (cut.books: 'ERPNext Accounts owns the books') and it removes a second copy that could " +
    "drift. The concept's description has been corrected to the cut's wording already; what remains is the tables. Detail for agents: tables " +
    "book-companies and book-accounts (blueprint/books/data.ts), the head feed and sync (blueprint/books/frappe.ts; books.sync, books.vouchers, " +
    "books.chart-tree, books.head-setup) still model the copy.",
  source: "Cloud thread \"Validate the blueprint audit findings\", 11 November 2026, from the blueprint audit (finding H3)",
  affects: [f.system_capxul, f.concept_books],
});

export const decision_plan_cloud_sandbox_moot = defineDecision({
  id: "plan.cloud-sandbox-moot",
  title: "Drop the plan's \"agents in a cloud sandbox\" task, now that Amp runs the agents",
  question:
    "The plan still has a task to make our own agents start in a home-made cloud sandbox instead of on your Mac (m1-cloud-sandbox), " +
    "and it sits on the current critical path. Tonight you moved agent work to Amp, whose sandboxes ('orbs') do this already, and the " +
    "home-made sandbox code was deleted. Should the task be dropped from the plan and the critical path?",
  options: [
    { label: "drop", text: "Drop it. The task leaves the plan and the critical path; the coordinator redraws the path around Amp. Nothing else changes." },
    { label: "keep-as-amp-proof", text: "Keep it, reworded: it is done when one plan task runs start to finish in an Amp orb and its pull request is mergeable. This turns it into the 'prove an orb runs the stack' check the handoff already lists first." },
  ],
  chosen: "drop",
  why:
    "Recommended because the thing it was building no longer exists (packages/sandbox was deleted in PR #10) and Amp already gives each agent its " +
    "own sandbox; proving an orb runs our stack is already the handoff's first task (docs/handoff-amp.md, section 6, task 0), so keeping this one " +
    "would track the same work twice. Detail for agents: plan task m1-cloud-sandbox; plan path; milestone m1 exit g9.",
  source: "Cloud thread \"Validate the blueprint audit findings\", 11 November 2026, from the blueprint audit's plan findings",
  affects: [f.system_capxul],
});
