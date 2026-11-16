// The glossary: one word, one meaning (docs/design/blueprint.md, part 12, decision 7, agreed with Aaron on 15 November
// 2026; docs/roadmap.md, decision "One glossary"). One entry per row of the decision's table, in its order, with the
// agreed word exactly as given. Folders, commands, docs and lint take their words from here. `pnpm generate` writes
// its page (generated/glossary.md) and the count of every old word still in the repository (generated/old-words.json),
// which `pnpm words` allows only to fall (roadmap item 3.8). The format is packages/blueprint-tools,
// src/language/glossary.ts. A plain string among `replaces` is an old word written as words; `code` is one the table
// writes as code.
import { code, type Entry, type Exception, uncounted, words } from "@capxul/blueprint-tools";

/** Why a deployed resource's name is not a writer's choice. */
const DEPLOYED = "a resource already deployed under this name: renaming it replaces the resource";
/** Why a stack's name is not a writer's choice. */
const STACK = "an Alchemy stack already deployed under this name: renaming it replaces every resource in it";
/** Why OpenTelemetry's wire keys are not ours. */
const OTLP = "OpenTelemetry's OTLP wire format names it, not Capxul";

/** A deployed name, by exact text. */
const deployed = (text: string): Exception => ({ text, why: DEPLOYED });

/** `step` is kept for a journey's moves, so its other meanings cannot be counted apart from it. */
const STEP_KEPT = "`step` stays the word for one move of a journey, so a count of it cannot tell this meaning apart";

export const glossary: ReadonlyArray<Entry> = [
  {
    word: "api",
    meaning: "The server that carries out a world's operations.",
    replaces: ["core"],
    scope: "internal",
    lands: "packages/api",
    exceptions: [deployed("core-db"), deployed("core-hyperdrive")],
  },
  {
    word: "endpoint",
    meaning: "The address a world answers at; the CLI takes the world by name instead.",
    replaces: ["door", code("CAPXUL_DOOR_URL"), code("--at")],
    scope: "user-facing",
    lands: "--world <name>",
    exceptions: [deployed("DoorImage"), deployed("DoorRecord"), deployed("cx-platform-door")],
  },
  {
    word: "account",
    meaning: "Calls outside any world, and where a person's sign-in lives.",
    replaces: ["platform", "at the platform"],
    scope: "user-facing",
    exceptions: [
      { text: "CapxulPlatform", why: STACK },
      deployed("cx-platform-bench"),
      deployed("cx-platform-door"),
      deployed("capxul-ci-platform"),
      { text: "platform.yml", why: "an existing workflow file, renamed with the package" },
    ],
  },
  { word: "world", meaning: "One whole, isolated Capxul.", replaces: [], scope: "user-facing" },
  { word: "grade", meaning: "Whether a world is private, shared or real.", replaces: [], scope: "user-facing" },
  {
    word: "realm",
    meaning: "Whether a world is for testing or real.",
    replaces: ["grade group"],
    scope: "user-facing",
  },
  {
    word: "site",
    meaning: "A company's Frappe site, and nothing else.",
    replaces: [],
    scope: "user-facing",
  },
  { word: "cast", meaning: "A test world's people.", replaces: [], scope: "user-facing" },
  {
    word: "operator",
    meaning: "Who owns and runs worlds; the faucet's account is the faucet.",
    replaces: ["owner"],
    scope: "user-facing",
  },
  {
    word: "cluster",
    meaning: "The shared containers worlds run on.",
    replaces: ["hub", "fleet", "fleet hub"],
    scope: "user-facing",
    exceptions: [{ text: "CapxulWorldHub", why: STACK }],
  },
  { word: "gateway", meaning: "The cluster's single address.", replaces: ["hub door"], scope: "internal" },
  {
    word: "sites",
    meaning: "What hosts company sites; bench stays Frappe's word.",
    replaces: ["platform", code("packages/platform")],
    scope: "user-facing",
    lands: "packages/sites",
  },
  {
    word: "site service",
    meaning: "The bench service that makes, takes, saves and resets sites.",
    replaces: ["site door"],
    scope: "internal",
  },
  {
    word: "site API",
    meaning: "The Capxul app's side that accepts signed calls.",
    replaces: [code("door.py")],
    scope: "internal",
  },
  {
    word: "collector",
    meaning: "Where telemetry is sent and routed.",
    replaces: ["telemetry door"],
    scope: "internal",
  },
  { word: "stage", meaning: "A deployed instance of a stack.", replaces: [], scope: "internal" },
  {
    word: "snapshot",
    meaning: "A saved state of a world; a site's part of it is a site snapshot.",
    replaces: ["point", "backup", "chain snapshot"],
    exceptions: [
      { text: "dataPoints", why: OTLP },
      { text: "rejectedDataPoints", why: OTLP },
      { text: "metric_data_point", why: OTLP },
      { text: "data_point", why: OTLP },
    ],
    scope: "user-facing",
  },
  {
    word: "starting point",
    meaning: "A named state a journey begins from.",
    replaces: ["starting world", "template snapshot"],
    scope: "user-facing",
  },
  {
    word: "site template",
    meaning: "A ready copy of a starting point's sites on the bench.",
    replaces: ["template"],
    scope: "internal",
  },
  { word: "take", meaning: "Giving a world sites from the pool.", replaces: ["claim"], scope: "internal" },
  { word: "reserve", meaning: "Holding a world's name.", replaces: ["claim"], scope: "internal" },
  {
    word: "journey",
    meaning: "A written story of operations that must pass.",
    replaces: ["scenario"],
    scope: "user-facing",
    lands: "packages/journeys",
  },
  {
    word: "runner",
    meaning: "What runs and judges journeys; the thing it makes is a run.",
    replaces: [],
    scope: "user-facing",
  },
  {
    word: "shard",
    meaning: "One world of a run's several.",
    replaces: [words("lane", [], ["packages/runner/"])],
    scope: "user-facing",
  },
  { word: "promise", meaning: "A sentence an operation guarantees.", replaces: ["claim"], scope: "user-facing" },
  {
    word: "claim",
    meaning: "Claiming a person's Safe on chain, through Companies House.",
    replaces: [],
    scope: "user-facing",
    keptIn: ["CompaniesHouseClaimer.claim", "claim(string,string,address)", "capxul.claim"],
  },
  { word: "check", meaning: "What judges one call or run, and only that.", replaces: [], scope: "internal" },
  {
    word: "gate",
    meaning: "The pass every pull request clears; its levels are rungs.",
    replaces: [code("pnpm check"), "ladder"],
    scope: "internal",
    lands: "pnpm gate",
  },
  {
    word: "verdict",
    meaning: "What a CI run proved.",
    replaces: ["run record", "proof record"],
    scope: "user-facing",
  },
  {
    // Aaron, 16 November 2026 (docs/decisions.md, "State is not in git"; docs/guides/logbook.md).
    word: "logbook",
    meaning: "The one store of what happened: runs, verdicts, tasks, asks, threads, sitreps and the plan's state.",
    replaces: [],
    scope: "internal",
  },
  {
    word: "history",
    meaning: "A world's ordered history.",
    replaces: ["record", code("record.export")],
    exceptions: [
      { text: "logRecords", why: OTLP },
      { text: "rejectedLogRecords", why: OTLP },
      { text: "log_record", why: OTLP },
      deployed("DoorRecord"),
    ],
    scope: "user-facing",
  },
  {
    word: "span",
    meaning: "A timed piece of work inside an operation.",
    replaces: [uncounted("step", STEP_KEPT)],
    scope: "internal",
  },
  { word: "step", meaning: "One move of a journey, and only that.", replaces: [], scope: "internal" },
  { word: "tap", meaning: "A test world's own telemetry copy.", replaces: [], scope: "internal" },
  {
    word: "registry",
    meaning: "The cluster's list of worlds.",
    replaces: [words("ledger", ["invoice ledger"])],
    scope: "internal",
  },
  {
    word: "index.ts",
    meaning: "The file other packages import from.",
    replaces: [code("door.ts")],
    scope: "internal",
  },
  { word: "generated index", meaning: "The blueprint's gathering files.", replaces: ["hub"], scope: "internal" },
  { word: "item", meaning: "One line of the roadmap.", replaces: [uncounted("step", STEP_KEPT)], scope: "internal" },
  { word: "lane", meaning: "A chain of roadmap items led by one lead.", replaces: [], scope: "internal" },
  { word: "slice", meaning: "An integration branch for one effort.", replaces: [], scope: "internal" },
];
