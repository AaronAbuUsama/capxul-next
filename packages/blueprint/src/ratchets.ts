// The ratchet registry (docs/design/blueprint.md, part 4; roadmap items 3.6 and 3.11): every gap between old work
// and the blueprint, declared once. A ratchet's list holds what has not yet moved to its rule; the list may only
// shrink, and the ratchet closes when it is empty. `pnpm ratchets` (packages/blueprint-tools, src/checks/) counts each
// ratchet named here by its `count`, fails a pull request whose count grew over the committed counts
// (generated/ratchets.json) and prints the rest; `pnpm generate` writes those counts and the scorecard,
// generated/scorecard.md. A ratchet not yet countable says so, with the roadmap item that will count it: no count is
// guessed. A ratchet gated by a command of its own names it in `gate`: `pnpm ratchets` then reports its count, and
// neither commits nor fails on it, so no list has two gates.

import type { FormatName, Ratchet } from "@capxul/blueprint-tools";
import type { OperationName } from "./index.ts";

export type { Counter, Ratchet } from "@capxul/blueprint-tools";

/**
 * Every ratchet: R1 to R14 as agreed on 15 November 2026, R15, the glossary's old words (roadmap item 3.8, #302), and
 * R16 to R19 (roadmap item 3.10): the names that differ from their path, and the operations not yet in the formats it
 * added, each counted from today. New ones take the next number.
 */
export const ratchets: ReadonlyArray<Ratchet> = [
  {
    id: "R1",
    name: "Raw schemas",
    holds: "Raw schemas outside values files, machines and listed edges, as findings of capxul/owned-values.",
    closes: "3.3",
    count: "lint:owned-values",
  },
  {
    id: "R2",
    name: "Names typed as strings",
    holds: "Declared names retyped as strings outside the blueprint, as findings of capxul/declared-names.",
    closes: "3.3",
    count: "lint:declared-names",
  },
  {
    id: "R3",
    name: "Rows not decoded",
    holds: "Stored rows cast to hand-written types instead of decoded, as findings of capxul/decoded-rows.",
    closes: "3.3",
    count: "lint:decoded-rows",
  },
  {
    id: "R4",
    name: "Lifecycles not machines",
    holds: "Things with a lifecycle not yet declared as a machine (site, approval, world, budget among them).",
    closes: "C.1 (was 7.3)",
    count: "not yet counted",
    countedBy: "C.1",
  },
  {
    id: "R5",
    name: "Operations not in the full format",
    holds:
      "Operations on the machine format's unmigrated list: those that start or move no machine, or leave a state's refusal undeclared. Who may call, steps and logs, and promises are R17 to R19.",
    closes: "3.5",
    count: "formats:machine",
  },
  {
    id: "R6",
    name: "Undeclared spans",
    holds:
      "Effectful functions of our own code (Core, the world, the platform client, the runner) with no declared step.",
    closes: "4.1",
    count: "not yet counted",
    countedBy: "4.1",
  },
  {
    id: "R7",
    name: "Operations not in one file",
    holds:
      "Verbs whose declaration still reads its examples from their thing's `examples.ts` (part 13: until stage 2b folds it into the verbs). A thing's refusals and events have their own files by design (part 13, amended), so they are not counted.",
    closes: "Decision 3",
    count: "verbs:examples",
  },
  {
    id: "R8",
    name: "Long or hand-mapped docs",
    holds:
      "READMEs over one screen (60 lines), as the docs' shape lists them (`LONG_READMES`, packages/lint); READMEs and package docs that are hand-written file maps (three or more list items or table rows opening with a file's path); and the docs on this list, not yet folded into a declaration or a generated page.",
    closes: "Decision 3",
    count: "docs:long-or-mapped",
    unmigrated: ["packages/blueprint/docs/build-order.md"],
  },
  // R9 also carries the points the journeys' author could not settle from the promises (folded here on 15 November
  // 2026), each a comment on the declaration it is about: the snapshot's missing block (`Snapshot`, things/
  // snapshot/values.ts); two worlds sharing one naming series (snapshot restore's first promise); a start time with
  // milliseconds (world create's second promise); and the literal readings where a promise is silent (company create's
  // third, member grant's fifth, world create's sixth and approval sign's first promises).
  {
    id: "R9",
    name: "Unreached declarations",
    holds: "Declared moves, refusals and outcomes no journey reaches.",
    closes: "3.7",
    count: "not yet counted",
    countedBy: "3.7",
  },
  {
    id: "R10",
    name: "Non-Effect code",
    holds:
      "Non-Effect constructs outside entry files, as capxul/effect-only finds them in the TypeScript the lint does not reach (Ponder's files; spikes, vendored code and Frappe are exempt), and each package's runtime dependencies that are not Effect nor Capxul's own.",
    closes: "Phase 7",
    count: "effect:non-effect",
  },
  {
    id: "R11",
    name: "Untyped starting worlds",
    holds: "Starting-world steps in prose, and payloads retyped in the runner.",
    closes: "7.2",
    count: "not yet counted",
    countedBy: "7.2",
  },
  {
    id: "R12",
    name: "Proofs by file path",
    holds: "Roadmap proof entries naming files instead of verdicts, for steps not yet Done.",
    closes: "4.5",
    count: "not yet counted",
    countedBy: "4.5",
  },
  {
    id: "R13",
    name: "Provisional budgets",
    holds: "Operations whose budget is not yet set from a measured verdict.",
    closes: "4.1 and the measured runs",
    count: "not yet counted",
    countedBy: "4.1",
  },
  {
    id: "R14",
    name: "Own telemetry tables",
    holds: "Readers of app.spans and the runner's JSON records beside OTLP.",
    closes: "4.4",
    count: "not yet counted",
    countedBy: "4.4",
  },
  {
    id: "R15",
    name: "Old words",
    holds:
      "The glossary's old words still written as names in code, counted per word in distinct names in generated/old-words.json; its count is their total. Distinct names: a lane that uses an existing name adds nothing; only a newly introduced name grows the count (blueprint lead, 15 Nov 2026).",
    closes: "3.8",
    count: "words:old-words",
    gate: "pnpm words",
  },
  {
    id: "R16",
    name: "Names not from their path",
    holds:
      "Verbs whose operation is not named `<thing>.<verb>` from its path (docs/design/blueprint.md, part 13, amended, point 3), each renamed directly as its thing is climbed.",
    closes: "C.1 (the climb), with item 3.8's renames",
    count: "own-list",
    unmigrated: [
      "org.threshold.set",
      "org.budget.create",
      "org.budget.list",
      "org.budget.show",
      "world.clock.warp",
      "org.create",
      "org.director.add",
      "org.director.list",
      "doc.create",
      "doc.submit",
      "record.export",
      "org.member.grant",
      "org.member.list",
      "world.snapshot.delete",
      "world.snapshot.list",
      "world.snapshot.restore",
      "world.snapshot.save",
    ],
  },
  {
    id: "R17",
    name: "Operations without who may call",
    holds:
      "Operations on the `allowed` format's unmigrated list: no roles allowed declared, nor the refusal anyone else gets.",
    closes: "5.1",
    count: "formats:allowed",
  },
  {
    id: "R18",
    name: "Operations without declared steps and logs",
    holds:
      "Operations on the `spans` or `logs` format's unmigrated list: no declared spans, logs, or log where each refusal is decided.",
    closes: "4.1",
    count: "formats:steps",
  },
  {
    id: "R19",
    name: "Promises that do not name every refusal they decide",
    holds:
      "Operations on the `promises` format's unmigrated list: some refusal they decide is named in none of their promises.",
    closes: "C.1",
    count: "formats:promises",
  },
];

/** The operations not yet climbed (docs/design/blueprint.md, part 14): every one but the invitation's four. */
const notClimbed: ReadonlyArray<OperationName> = [
  "org.create",
  "org.member.grant",
  "org.member.list",
  "org.director.list",
  "org.director.add",
  "org.threshold.set",
  "org.budget.create",
  "org.budget.show",
  "org.budget.list",
  "doc.create",
  "doc.submit",
  "approval.sign",
  "report.run",
  "world.create",
  "world.clock.warp",
  "world.snapshot.save",
  "world.snapshot.restore",
  "world.show",
  "world.list",
  "world.snapshot.list",
  "world.snapshot.delete",
  "record.export",
];

/**
 * Each format's `unmigrated` list (ratchet R5): the existing operations allowed to lack that format today, which the
 * delta check (`pnpm delta:check`, the toolkit's `formats(blueprint)`) allows and no other. Each list may only shrink,
 * and a new operation is never added: it is born in every format. The delta check fails a listed operation that now
 * has the format, so it is removed from here when its thing is climbed. The invitation is on none (roadmap item 3.10).
 */
export const unmigrated: { readonly [format in FormatName]?: ReadonlyArray<OperationName> } = {
  machine: [
    "org.create",
    "org.member.grant",
    "org.director.add",
    "org.threshold.set",
    "org.budget.create",
    "doc.create",
    "doc.submit",
    "approval.sign",
    "world.create",
    "world.clock.warp",
    "world.snapshot.save",
    "world.snapshot.restore",
    "world.snapshot.delete",
  ],
  allowed: notClimbed,
  spans: notClimbed,
  logs: notClimbed,
  promises: [
    "org.member.grant",
    "doc.create",
    "doc.submit",
    "approval.sign",
    "report.run",
    "world.snapshot.save",
    "world.snapshot.restore",
    "record.export",
  ],
};
