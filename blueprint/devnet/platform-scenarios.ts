// Scenarios: what a world is created from and run under. `scenario save|list|show|check`. The two worked examples come from the old product's scenario companies (a plain-data list of their seats and
// outside events is the script; the companies' generated histories are the template). No country is assumed: each company's jurisdiction is a property of its template, left open by aaron.jurisdiction-open.
// Every seat can be played by an agent now; a human seat is specified and waits on Capxul Core's sign-in (aaron.sign-in-is-core).

import { Schema } from "effect";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { ScenarioManifest, table_scenarios } from "./platform-data.ts";
import { ADDR, make, ms, N, S, ScenarioView, B, CheckLine } from "./platform-kit.ts";

const ORGANISER = "An organiser (a key the worlds service admits as an organiser).";
const W = { out: "signed-out", empty: "empty-devnet", member: "org-with-member", town: "town-of-four-m3" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "Not an organiser; nothing changes." } as const;
const BAD = { error: error_INVALID_INPUT, given: W.empty, when: "The manifest does not read, names a template snapshot that is not saved, a seat in a company the template lacks, or an eval the book does not have." } as const;

/** The first worked example: four old companies at month three, with the seats a tester or agent fills and the scoring from the book's evals. Plain data, not a record. */
export const TOWN_OF_FOUR = {
  name: "town-of-four", version: 1, summary: "Four companies on one chain at month three of their histories. Run to the end of month four; keep the books agreeing with the chain.", profile: "full",
  template: { snapshot: "town-of-four@m3", companies: [
    { slug: "bit-connect", name: "Bit Connect Studio", dateShift: null }, { slug: "quillmesh", name: "Quillmesh", dateShift: null },
    { slug: "kobina-ridge", name: "Kobina Ridge Gold", dateShift: null }, { slug: "tamu-orchards", name: "Tamu Orchards", dateShift: "+9 months" } ] },
  seats: [
    { seat: "bc-director", company: "bit-connect", hat: "admin", filledBy: "either", reads: "own company's books and every payment of the world", agentPolicy: "ledger-agent@1" },
    { seat: "bc-finance", company: "bit-connect", hat: "budget-holder", filledBy: "either", reads: "own company's books", agentPolicy: "ledger-agent@1" },
    { seat: "qm-sales", company: "quillmesh", hat: "sales", filledBy: "either", reads: "own company's CRM and invoices", agentPolicy: "sales-agent@1" },
    { seat: "kr-ops", company: "kobina-ridge", hat: "budget-holder", filledBy: "either", reads: "own company's books", agentPolicy: "ledger-agent@1" },
  ],
  script: { ref: "scenarios/town-of-four/script.jsonl", standIns: ["prices", "bank", "customers", "suppliers", "calendar"], events: 1900 },
  clock: { mode: "stepped", rate: 1, start: "2026-03-01", step: "1d", warps: [{ after: "each agent turn batch", by: "1d" }] },
  scoring: { evals: ["books-agree-with-chain", "no-unauthorised-payment"], measures: [
    { id: "invoices-collected", about: "Value of invoices paid by customers, in the books' currency", direction: "up", weight: 1 },
    { id: "bills-late", about: "Supplier bills paid after their due date", direction: "down", weight: 0.5 } ] },
  ends: { afterWorldTime: "2026-05-01", orWhen: "every seat has finished its turn on the last day" },
  onDrop: "agent",
} as const;

/** The second: one company, one quarter, one seat: the cheapest `core`-able scenario to learn the loop on. */
export const SOLO = {
  name: "solo-bit-connect", version: 1, summary: "One company for one month. A single seat pays the month's bills and collects its invoices.", profile: "core",
  template: { snapshot: "bit-connect@m3", companies: [{ slug: "bit-connect", name: "Bit Connect Studio", dateShift: null }] },
  seats: [{ seat: "bc-finance", company: "bit-connect", hat: "budget-holder", filledBy: "either", reads: "own company's payments and budgets", agentPolicy: "ledger-agent@1" }],
  script: { ref: "scenarios/solo-bit-connect/script.jsonl", standIns: ["prices", "bank", "customers"], events: 300 },
  clock: { mode: "stepped", rate: 1, start: "2026-03-01", step: "1d", warps: [{ after: "each step", by: "1d" }] },
  scoring: { evals: ["no-unauthorised-payment"], measures: [{ id: "bills-paid-on-time", about: "Share of the month's bills paid by their due date", direction: "up", weight: 1 }] },
  ends: { afterWorldTime: "2026-04-01", orWhen: null },
  onDrop: "pause",
} as const;

const view = (o: Record<string, unknown> = {}) => ({ scenario: "town-of-four@1", name: "town-of-four", version: 1, profile: "full", template: "town-of-four@m3", companies: 4, seats: 4, manifestHash: "sha256:9f2c1b7e", publishedAt: ms("2026-11-20T10:00:00Z"), ...o });

const save = make({
  id: "scenario.save", command: "scenario save", title: "Publish a scenario version", rpc: "devnet.scenarios.save", kind: "mutation", priority: "critical",
  about: "Publishes a scenario version from a manifest file (`--manifest`): the template snapshot, the companies, the seats and which are filled by people and which by agents, the script of outside events, the clock plan, what is scored (the book's evals, plus measures stated as deltas) and when the run ends. A version never changes: a change is `version + 1`, so a run names exactly what it ran. The manifest is checked as `scenario check` checks it.",
  who: ORGANISER, changes: "One scenario version.", input: Schema.Struct({ manifest: ScenarioManifest }), output: ScenarioViewOut(),
  reads: [table_scenarios], writes: [table_scenarios],
  claims: [{ claim: "A published version is fixed, and a changed manifest is a new version.", observes: `cli: \`scenario save --manifest town.json\` twice with an edit between prints version 1 then 2; \`scenario show town-of-four@1\` still prints the first manifest's hash.` }],
  refusals: [OUT, NOT_ORG, BAD], examples: [ok("Publish the town of four", "capxul scenario save --manifest scenarios/town-of-four.json --json", view()), refused("The template snapshot is not saved here", "capxul scenario save --manifest scenarios/town-of-four.json --json", error_INVALID_INPUT, { field: "template.snapshot", name: "town-of-four@m3" })],
});
function ScenarioViewOut() { return ScenarioView; }
export const rpc_devnet_scenarios_save = save.rpc;
export const operation_scenario_save = save.op;

const list = make({
  id: "scenario.list", command: "scenario list", title: "List scenarios", rpc: "devnet.scenarios.list", kind: "query",
  about: "The published scenarios, the latest version of each, with the profile each needs and how many companies and seats it has.", who: "Any signed-in key.", changes: "Nothing: it only reads.",
  input: Schema.Struct({ all: B }), output: Schema.Struct({ scenarios: Schema.Array(ScenarioView) }), reads: [table_scenarios],
  claims: [{ claim: "The latest version of each scenario is listed, and every version with `--all`.", observes: `cli: with two versions of town-of-four, \`scenario list --json\` lists version 2 only; with \`--all\` both.` }],
  refusals: [OUT], examples: [ok("The scenarios", "capxul scenario list --json", { scenarios: [view(), view({ scenario: "solo-bit-connect@1", name: "solo-bit-connect", profile: "core", template: "bit-connect@m3", companies: 1, seats: 1, manifestHash: "sha256:41ad0c92" })] })],
});
export const rpc_devnet_scenarios_list = list.rpc;
export const operation_scenario_list = list.op;

const show = make({
  id: "scenario.show", command: "scenario show", title: "Show a scenario's manifest", rpc: "devnet.scenarios.show", kind: "query",
  about: "One scenario version's whole manifest: template, seats, script, clock plan, scoring and end.", who: "Any signed-in key.", changes: "Nothing: it only reads.",
  input: Schema.Struct({ scenario: S }), output: Schema.Struct({ view: ScenarioView, manifest: ScenarioManifest }), reads: [table_scenarios],
  claims: [{ claim: "A scenario shows exactly what a run of it will do.", observes: `cli: \`scenario show town-of-four@1 --json\` prints the manifest whose hash equals the manifestHash that \`run show\` prints for a run made from it.` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.empty, when: "No such scenario or version." }],
  examples: [ok("Show the solo scenario", "capxul scenario show solo-bit-connect@1 --json", { view: view({ scenario: "solo-bit-connect@1", name: "solo-bit-connect", profile: "core", template: "bit-connect@m3", companies: 1, seats: 1, manifestHash: "sha256:41ad0c92" }), manifest: SOLO }),
    refused("No such scenario", "capxul scenario show solo@1 --json", error_INVALID_INPUT, { field: "scenario", name: "solo@1" })],
});
export const rpc_devnet_scenarios_show = show.rpc;
export const operation_scenario_show = show.op;

const check = make({
  id: "scenario.check", command: "scenario check", title: "Check a scenario before publishing it", rpc: "devnet.scenarios.check", kind: "query", priority: "normal", cls: "write", p95Ms: 60_000,
  about: "Reads a manifest and says whether it can run: the template snapshot exists and its companies match, every seat is in a company and wears a hat the site knows, the evals named are in the book, the script reads and its seed draws the same events twice, the clock plan's warps fit the end, and the profile can hold it. With `--dry-run` it makes the run's world, plays the script's first day and destroys it.",
  who: ORGANISER, changes: "Nothing; with `--dry-run` a world is made and removed.", input: Schema.Struct({ manifest: ScenarioManifest, dryRun: B }), output: Schema.Struct({ ok: B, checks: Schema.Array(CheckLine), estimatedMinutes: N }),
  reads: [table_scenarios], claims: [{ claim: "A manifest naming a missing snapshot or an unknown eval is refused with the reason, before anything is made.", observes: `cli: \`scenario check --manifest bad.json --json\` with an eval id the book lacks prints ok false and a check naming it.` }],
  refusals: [OUT, NOT_ORG], examples: [ok("A good manifest", "capxul scenario check --manifest scenarios/town-of-four.json --json", { ok: true, checks: [{ id: "template-exists", passed: true, detail: "town-of-four@m3" }, { id: "evals-in-book", passed: true, detail: "2 of 2" }, { id: "script-seeded", passed: true, detail: "two draws equal" }], estimatedMinutes: 95 }), refused("Not an organiser", "capxul scenario check --manifest scenarios/town-of-four.json --json", error_ROLE_PERMISSION_DENIED)],
});
export const rpc_devnet_scenarios_check = check.rpc;
export const operation_scenario_check = check.op;

void ADDR; void error_WRONG_STATE;
