/**
 * The site module: a built Blueprint in, typed page models out. A page model is plain data: the renderer draws it,
 * the twins print it as Markdown and JSON, and the check reads it back. Nothing here knows about HTML.
 */
import type { AnyRecord, Blueprint, Stand, StandOf, StatusDocument, EvalStatus, Verdict as EvalVerdict } from "@capxul/blueprint-engine";
import type { GuideInput, GuidePage } from "./guide-types.ts";
import type { Diagram, Direction, Step, Verdict } from "#content/shape.ts";
import type { PlanInput, TaskState } from "@capxul/plan";
export type { BindingFile, GuideInput, GuidePage, GuidePart, GuideSection } from "./guide-types.ts";
/** The plan the Plan page is drawn from: the coordinator's file, its log and the plan check (packages/plan). */
export type { PlanInput };
export type { Diagram, DiagramEdge, DiagramNode, Direction, Step, Verdict } from "#content/shape.ts";

// ── shared pieces ───────────────────────────────────────────────────────────────────────────────

/** Where an operation stands on the climb, and the rule that placed it: `standOf` in `@capxul/blueprint-engine`. */
export type { EvalVerdict, Stand, StandOf };
/** How many of some evals pass, of how many there are. */
export interface Count { readonly passing: number; readonly total: number }
/** A link to a page of this site. `anchor` is "" for the page itself. */
export interface Ref { readonly label: string; readonly page: string; readonly anchor: string }
export interface Brief { readonly ref: Ref; readonly text: string }
/** One field of a schema: `transfer.state`, its type in words, and its limits. */
export interface FieldRow { readonly path: string; readonly type: string; readonly required: boolean; readonly note: string }
/** One shape a schema admits, and that shape as a JSON skeleton of placeholders: never a recorded value. */
export interface Variant { readonly label: string; readonly rows: readonly FieldRow[]; readonly skeleton: string }
/** Any value a record holds, ready to draw. */
export type Value =
  | { readonly t: "text"; readonly text: string }
  | { readonly t: "ref"; readonly ref: Ref }
  | { readonly t: "list"; readonly items: readonly Value[] }
  | { readonly t: "map"; readonly entries: readonly (readonly [string, Value])[] }
  | { readonly t: "schema"; readonly variants: readonly Variant[] };
/** An eval as a page shows it: `kind` is its id's prefix, and `anchor` is unique on its page. */
export interface EvalRow {
  readonly id: string; readonly kind: string; readonly anchor: string; readonly level: string; readonly claim: string; readonly decider: string;
  /** From the status document; `not_run` when it has no entry. */
  readonly verdict: EvalVerdict; readonly provenance: { readonly result: EvalStatus; readonly builtCommit: string; readonly repo: string } | null;
}
/** What one kind of eval claims, in the words of docs/spec/30-capxul-evals.md. */
export interface EvalKind { readonly kind: string; readonly name: string; readonly claims: string }
export interface FindingRow { readonly record: string; readonly rule: string; readonly detail: string }
export interface LinkGroup { readonly field: string; readonly refs: readonly Ref[] }
export interface OperationRow {
  readonly ref: Ref; readonly title: string; readonly priority: string; readonly isNew: boolean;
  /** Its own evals, and the evals under it, with how many of each pass. */
  readonly evals: number; readonly own: Count; readonly under: Count; readonly stand: StandOf;
}
/** A count and the list it counts. `to` is null when there is nothing to list. */
export interface Tile { readonly big: string; readonly name: string; readonly to: Ref | null }

/** One cell of a table: words, code, a link with a line under it, several links, or a stand. */
export type Cell =
  | { readonly t: "text"; readonly text: string }
  | { readonly t: "code"; readonly text: string }
  | { readonly t: "ref"; readonly ref: Ref; readonly sub: string }
  | { readonly t: "refs"; readonly refs: readonly Ref[] }
  | { readonly t: "stand"; readonly stand: StandOf };
/** A row, and the group it sits under ("" for none): a table draws a group's name once, above its first row. */
export interface TableRow { readonly group: string; readonly cells: readonly Cell[] }
/** A titled table. With no rows it shows `empty`: what the blueprint is silent on, said out loud. */
export interface TableSection {
  readonly anchor: string; readonly title: string; readonly caption: string;
  readonly heads: readonly string[]; readonly rows: readonly TableRow[]; readonly empty: string;
}

/** One step of a run: what it is, and everything the blueprint says happens under it. */
export interface TraceStep {
  readonly name: string; readonly about: string;
  /** `rpc`, or the work the SDK does itself: `sign`, `build`, `wait`. */
  readonly does: string; readonly rpc: Ref | null;
  readonly chain: readonly Ref[]; readonly calls: readonly Ref[]; readonly invokes: readonly Ref[];
  readonly drives: readonly Ref[]; readonly events: readonly Ref[]; readonly writes: readonly Ref[]; readonly spans: readonly string[];
}
/** An event an operation sends, the transition that sends it (null: sent by a record itself) and who drives it. */
export interface EventRow { readonly event: Ref; readonly transition: Ref | null; readonly by: Ref }
/** A span an operation names, and the record that names it. */
export interface SpanRow { readonly span: string; readonly by: Ref }
/** What happens when an operation runs: the record that implements it, and its steps in order. `sends` and `named`
 * are derived from the whole implementation, so they hold what no single step shows. */
export interface Trace {
  readonly by: Ref | null; readonly kind: string; readonly spans: readonly string[]; readonly calls: readonly Ref[];
  readonly steps: readonly TraceStep[]; readonly sends: readonly EventRow[]; readonly named: readonly SpanRow[];
}

/** One record that depends on the page's record: how far, and by which field of its own. */
export interface ImpactRow { readonly ref: Ref; readonly kind: string; readonly field: string; readonly via: Ref; readonly distance: number }
/** "If this changes": what depends on a record. `all` is the full list, which the twins carry; a page draws `all`'s first few. */
export interface ImpactBlock {
  readonly total: number; readonly byKind: readonly { readonly kind: string; readonly count: number }[];
  readonly all: readonly ImpactRow[];
  /** False when `all` is cut: to the nearest 500, or for a decision to what it names directly. `packages/blueprint-engine/scripts/impact.ts` has the rest. */
  readonly complete: boolean;
  /** Decisions that name the record itself (listed on the page), and how many name something that depends on it. */
  readonly decisions: number; readonly decisionsOnDependents: number; readonly evals: number;
}

export interface PageHead {
  readonly id: string; readonly title: string; readonly source: string;
  readonly recordKey: string; readonly recordHash: string; readonly record: unknown;
}

// ── the pages ───────────────────────────────────────────────────────────────────────────────────

export interface ClimbCard {
  readonly step: string; readonly status: string; readonly tone: "blue" | "orange" | "grey";
  readonly big: string; readonly sub: string; readonly bar: "full" | "split" | "empty";
}
/** A task of the plan that an inbox entry holds up. */
export interface HeldUp { readonly id: string; readonly title: string; readonly milestone: string }
/**
 * One thing that waits on the owner: a decision the blueprint holds for him, or a task of the plan blocked on a need of his.
 * A need has no options and no recommendation; its `question` is what is needed and `concept` is its milestone.
 */
export interface Question {
  /** `decision` or `need`; `key` is the page's anchor name, `q-<key>`. */
  readonly kind: "decision" | "need"; readonly key: string;
  /** The plan tasks blocked on this decision (a need holds up its own task). */
  readonly holdsUp: readonly HeldUp[];
  /** A need's whole task file (plan/tasks/<id>.md, Markdown): what exactly is asked, why, and when it is done. Empty for a decision. */
  readonly details: string;
  readonly id: string; readonly ref: Ref; readonly title: string; readonly question: string; readonly concept: string;
  readonly holds: number; readonly chosen: string; readonly why: string; readonly source: string;
  readonly options: readonly { readonly label: string; readonly text: string; readonly recommended: boolean }[];
  readonly affects: readonly Ref[];
}
export interface ConceptCard {
  readonly ref: Ref; readonly title: string; readonly verdict: Verdict; readonly operations: number; readonly decisions: number;
}
export interface OverviewPage extends PageHead {
  /** How many things wait on the owner: the Questions page's count. */
  readonly inbox: number;
  readonly type: "overview"; readonly commit: string;
  readonly hero: Direction["hero"]; readonly needsYou: string; readonly banner: Direction["banner"];
  readonly climb: readonly ClimbCard[]; readonly verdicts: { readonly given: number; readonly of: number };
  readonly waiting: readonly Question[]; readonly holds: readonly Tile[];
  readonly concepts: readonly ConceptCard[]; readonly counts: Readonly<Record<string, number>>; readonly evals: number;
  readonly problems: readonly FindingRow[]; readonly gaps: readonly FindingRow[];
  readonly nav: readonly Ref[]; readonly sitemap: Readonly<Record<string, readonly string[]>>;
}
export interface QuestionsPage extends PageHead {
  readonly type: "questions"; readonly commit: string; readonly lead: string;
  readonly repo: string; readonly reviewer: string; readonly issueLabel: string;
  readonly questions: readonly Question[]; readonly steps: readonly Step[];
}
export interface ArchitecturePage extends PageHead {
  readonly type: "architecture"; readonly lead: string; readonly diagram: Diagram;
  /** What runs where: one row per component, one column per environment. */
  readonly runs: TableSection; readonly deployment: TableSection;
  /** What must be up before what: each layer depends only on layers before it. */
  readonly layers: readonly (readonly Ref[])[];
  readonly depends: TableSection;
  /** One request, end to end; null when the blueprint does not hold the operation the direction names. */
  readonly traced: { readonly operation: Ref; readonly title: string; readonly trace: Trace } | null;
  /** What crosses the Frappe boundary: the records that link to it, then the records that name it in words. */
  readonly boundary: readonly TableSection[];
  /** What the blueprint does not say, found by counting. */
  readonly silent: readonly string[];
  readonly portal: readonly Brief[]; readonly steps: readonly Step[];
}
export interface MachineCard {
  readonly ref: Ref; readonly title: string; readonly transitions: number;
  readonly states: readonly { readonly id: string; readonly initial: boolean; readonly terminal: boolean }[];
}
export interface ConceptPage extends PageHead {
  readonly impact: ImpactBlock;
  readonly type: "concept"; readonly about: string; readonly verdict: Verdict; readonly verdictNote: string;
  readonly rail: readonly { readonly ref: Ref; readonly title: string; readonly operations: number; readonly active: boolean }[];
  readonly counts: readonly Tile[];
  readonly dependsOn: readonly Ref[]; readonly operations: readonly OperationRow[]; readonly machines: readonly MachineCard[];
  readonly tables: readonly Brief[]; readonly events: readonly Brief[]; readonly errors: readonly Ref[];
  readonly more: readonly { readonly title: string; readonly anchor: string; readonly items: readonly Brief[] }[];
  readonly evals: readonly EvalRow[];
}
export interface ArgRow { readonly name: string; readonly kind: string; readonly text: string }
export interface Refusal {
  readonly error: Ref; readonly title: string; readonly message: string; readonly exit: string; readonly class: string;
  readonly given: string; readonly when: string;
}
/** An example as a terminal shows it. `refusal` links the declared error when the example is a refusal. */
export interface ExampleView {
  readonly title: string; readonly input: string; readonly output: string; readonly exit: number; readonly refusal: Ref | null;
}
export interface OperationPage extends PageHead {
  readonly impact: ImpactBlock; readonly examples: readonly ExampleView[];
  /** Its own evals passing, and those of the records under it. */
  readonly passing: { readonly own: Count; readonly under: Count };
  readonly type: "operation"; readonly concept: Ref | null; readonly command: string; readonly about: string;
  readonly priority: string; readonly isNew: boolean; readonly synopsis: string;
  /** Null when the old CLI never had the command. */
  readonly oldCli: { readonly arguments: readonly ArgRow[]; readonly flags: readonly ArgRow[] } | null;
  readonly returns: readonly Variant[]; readonly who: string; readonly changes: string; readonly notes: readonly string[];
  readonly mistakes: readonly { readonly what: string; readonly fix: string }[];
  /** `n` is the claim's number in the blueprint; a retired line keeps its number and is not listed. */
  readonly acceptance: readonly { readonly n: number; readonly claim: string; readonly observes: string }[];
  readonly evals: readonly EvalRow[]; readonly evalKinds: readonly EvalKind[];
  readonly refusals: readonly Refusal[]; readonly stand: StandOf;
  readonly implementedBy: Brief | null; readonly implementedKind: string; readonly sdk: string;
  /** The SDK call as TypeScript, its types generated from the implementing record's schemas. */
  readonly sdkCall: string; readonly trace: Trace;
  readonly budget: string; readonly waiting: readonly Brief[]; readonly decisions: readonly Brief[];
  readonly settledInConcept: number; readonly gaps: readonly FindingRow[]; readonly usedBy: readonly LinkGroup[];
}
export interface ChildSection {
  readonly kind: string; readonly name: string; readonly anchor: string; readonly value: Value;
  readonly evals: readonly EvalRow[]; readonly gaps: readonly FindingRow[]; readonly linkedBy: readonly LinkGroup[];
}
export interface RecordPage extends PageHead {
  readonly impact: ImpactBlock;
  readonly type: "record"; readonly kind: string; readonly concept: Ref | null; readonly about: string;
  /** For a decision that waits: the link to its question. */
  readonly waits: Ref | null;
  readonly fields: readonly (readonly [string, Value])[]; readonly children: readonly ChildSection[];
  readonly linksOut: readonly LinkGroup[]; readonly linkedBy: readonly LinkGroup[];
  readonly evals: readonly EvalRow[]; readonly gaps: readonly FindingRow[]; readonly decisions: readonly Brief[];
}
/** What the build is still missing, counted by the gap rules that name it. */
export interface BuildGaps {
  readonly total: number; readonly telemetry: readonly { readonly rule: string; readonly count: number }[];
  readonly examples: number; readonly other: number;
}
export interface BuildPage extends PageHead {
  readonly type: "build"; readonly operations: number; readonly evals: number;
  /** The evals passing in the status document; `recorded` is false when there is no document. */
  readonly passing: Count; readonly recorded: boolean; readonly gapCounts: BuildGaps;
  readonly stands: Readonly<Record<Stand, number>>; readonly tiles: readonly Tile[];
  /** The operations at each stand: what a tile above counts. */
  readonly byStand: readonly { readonly stand: Stand; readonly title: string; readonly anchor: string; readonly rows: readonly OperationRow[] }[];
  readonly concepts: readonly { readonly ref: Ref; readonly title: string; readonly rows: readonly OperationRow[]; readonly passing: Count }[];
}
/** A page of tables: Docs, each of its catalogues, and the eval catalogue. `nav` is the top-bar entry it lights. */
export interface CataloguePage extends PageHead {
  readonly type: "catalogue"; readonly nav: string; readonly eyebrow: string; readonly lead: string;
  readonly crumbs: readonly Ref[]; readonly tiles: readonly Tile[]; readonly sections: readonly TableSection[];
}
/** A `##` section of a Markdown document; `body` is Markdown, which the renderer draws and the twins print as written. */
export interface Section { readonly heading: string; readonly body: string }
// ── the Worlds page ─────────────────────────────────────────────────────────────────────────────

/** What the Worlds page is made from: the readable document and the ids of the records that are the worlds design (devnet/platform-index.ts). */
export interface WorldsInput {
  readonly document: string; readonly text: string;
  readonly operations: readonly string[]; readonly journeys: readonly string[]; readonly decisions: readonly string[]; readonly tables: readonly string[];
}
/** The Worlds page: the document's sections first, then the operations, journeys, decisions and tables of the worlds design. */
export interface WorldsPage extends PageHead {
  readonly type: "worlds"; readonly commit: string; readonly present: boolean;
  readonly intro: string; readonly sections: readonly Section[];
  readonly operations: readonly OperationRow[]; readonly journeys: readonly Brief[]; readonly decisions: readonly Brief[]; readonly tables: readonly Brief[];
}
export type Page =
  | GuidePage | WorldsPage | OverviewPage | QuestionsPage | ArchitecturePage | ConceptPage | OperationPage | RecordPage | BuildPage | CataloguePage;

export interface Site {
  readonly commit: string;
  /** How many things wait for an answer, decisions and the plan's needs of the owner: the count beside Questions in the top bar. */
  readonly waiting: number;
  readonly problems: number;
  readonly pages: readonly Page[];
}

// ── what the site is built from ─────────────────────────────────────────────────────────────────

/** An argument of a command in the old CLI: reference only (decision system.frozen-behaviour). */
export interface FrozenArgument {
  readonly name: string; readonly type: string; readonly required: boolean; readonly variadic: boolean; readonly description: string;
}
/** A flag of a command in the old CLI: reference only. `default` is the old default in words, or null. */
export interface FrozenFlag {
  readonly flag: string; readonly alias: string | null; readonly takesValue: boolean; readonly type: string;
  readonly metavar: string | null; readonly required: boolean; readonly repeatable: boolean; readonly description: string;
  readonly default: string | null;
}
/** `inCli` is false for a command the old system designed but never shipped: it has no arguments and no flags. */
export interface FrozenCommand {
  readonly command: string; readonly inCli: boolean;
  readonly arguments: readonly FrozenArgument[]; readonly flags: readonly FrozenFlag[];
}

/** Everything the site is built from. The composition root loads it; this module reads nothing else. */
/** One commit, as the History page reads it: who is the author, or Claude when an agent made it. */
export interface Commit {
  readonly sha: string; readonly at: string; readonly who: string;
  /** `task <id>`, `cloud session`, or empty when a person committed it directly. */
  readonly via: string; readonly subject: string; readonly files: readonly string[];
}
export interface SiteInput {
  readonly blueprint: Blueprint;
  /** The commit the blueprint was read at. */
  readonly commit: string;
  /** Concept ids in the blueprint's own order. */
  readonly concepts: readonly string[];
  /** Record key to the concept whose folder exports it. A record with no entry is shared. */
  readonly conceptOf: ReadonlyMap<string, string>;
  /** True when a decision waits for Aaron: the one predicate in blueprint/shared/waiting.ts. */
  readonly waits: (decision: AnyRecord) => boolean;
  /** Old CLI arguments and flags, by operation id. */
  readonly frozen: ReadonlyMap<string, FrozenCommand>;
  /** Operation ids the old system had. An operation outside the set is new. */
  readonly frozenOperations: ReadonlySet<string>;
  readonly direction: Direction;
  /** `status/status.json`: what has run. Null when the file is absent, which means nothing has run. */
  readonly status: StatusDocument | null;
  /** `plan/plan.json` with the last lines of its log: null when the file is absent. */
  readonly plan: PlanInput | null;
  /** The repository's commits, newest first: the History page. Absent or empty, there is no History page. */
  readonly history?: readonly Commit[];
  /** The worlds design: null (or absent) when the document is not in the repository. */
  readonly worlds?: WorldsInput | null;
  /** The guide to the blueprint and what its tables need: null (or absent) without the document. */ readonly guide?: GuideInput | null;
}
