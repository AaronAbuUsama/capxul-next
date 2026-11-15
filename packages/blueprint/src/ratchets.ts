// The ratchet registry (docs/design/blueprint.md, part 4; roadmap items 3.6 and 3.11): every gap between old work
// and the blueprint, declared once. A ratchet's list holds what has not yet moved to its rule; the list may only
// shrink, and the ratchet closes when it is empty. `pnpm ratchets` (packages/blueprint-tools, src/checks/) counts each
// ratchet named here by its `count`, fails a pull request whose count grew over the committed counts
// (generated/ratchets.json) and prints the rest; `pnpm generate` writes those counts and the scorecard,
// generated/scorecard.md. A ratchet not yet countable says so, with the roadmap item that will count it: no count is
// guessed. A ratchet gated by a command of its own names it in `gate`: `pnpm ratchets` then reports its count, and
// neither commits nor fails on it, so no list has two gates.

/**
 * How a ratchet is counted, by the toolkit's counter of that name: a typed-once lint rule's unmigrated list
 * (packages/lint/src/unmigrated.ts, its findings in all), the delta check's formats' unmigrated lists
 * (packages/blueprint-tools/src/checks/formats.ts, their operations in all), or the glossary's old words
 * (generated/old-words.json, which `pnpm generate` writes: every old word's count, in all).
 */
export type Counter = "lint:owned-values" | "lint:declared-names" | "lint:decoded-rows" | "formats" | "words:old-words";

/** One ratchet. */
export interface Ratchet {
  readonly id: string;
  readonly name: string;
  /** What its list holds, in one sentence. */
  readonly holds: string;
  /** The roadmap item (or decision) that empties the list and closes it. */
  readonly closes: string;
  /** How it is counted, or "not yet counted". */
  readonly count: Counter | "not yet counted";
  /** For a ratchet not yet counted: the roadmap item that will count it. */
  readonly countedBy?: string;
  /**
   * For a ratchet gated by a command of its own, not by `pnpm ratchets`: that command. `pnpm ratchets` reports its
   * count and leaves it out of generated/ratchets.json, so only that command fails when its list grows.
   */
  readonly gate?: string;
}

/**
 * Every ratchet: R1 to R14 as agreed on 15 November 2026, and R15, the glossary's old words (roadmap item 3.8, #302);
 * new ones take the next number.
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
    holds: "Operations on a format's unmigrated list: missing machine moves, and later allowed, steps, logs, budget.",
    closes: "3.5, 4.1, 5.1",
    count: "formats",
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
    holds: "Operations whose declaration is still split across files beside their verb's own file.",
    closes: "Decision 3",
    count: "not yet counted",
    countedBy: "3.6",
  },
  {
    id: "R8",
    name: "Long or hand-mapped docs",
    holds: "READMEs over one screen (60 lines), hand-written file maps, and docs not yet folded.",
    closes: "Decision 3",
    count: "not yet counted",
    countedBy: "3.6",
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
    holds: "Non-Effect constructs outside entry files, and non-Effect runtime dependencies.",
    closes: "Phase 7",
    count: "not yet counted",
    countedBy: "3.6",
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
];
