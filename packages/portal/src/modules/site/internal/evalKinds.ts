/**
 * What each kind of eval claims, and what each level is, in the words of docs/spec/30-capxul-evals.md. Where the
 * spec has no line for a kind (the records below an operation), the words are the claims `@capxul/book` derives.
 */
import type { EvalKind } from "../types.ts";

/** Kinds in the spec's order. A kind the book derives and this list does not name is shown by its id alone. */
const KINDS: readonly EvalKind[] = [
  { kind: "acc", name: "Acceptance", claims: "The operation's acceptance line holds: the claim, checked by what a black-box run observes." },
  { kind: "ret", name: "Return shape", claims: "A success returns exactly the record's `returns` schema, and `--json` prints it." },
  { kind: "ref", name: "Refusal", claims: "The declared refusal is reachable from its `given`; it returns that code, the declared exit code and the failure shape; nothing changes." },
  { kind: "evt", name: "Event", claims: "The operation sends the declared event, valid against its catalogue schema, carrying `trace_id`, once per state change." },
  { kind: "spn", name: "Span tree", claims: "The trace has the declared span tree: an operation span, the declared child spans, the required attributes, and `outcome` and failure fields on a refusal." },
  { kind: "bud", name: "Time budget", claims: "Over N runs from a warm world, the system-time p95 stays within budget (p50 likewise); chain confirmation and a person's wait are excluded through span names." },
  { kind: "doc", name: "Docs agree", claims: "The CLI help, the reference page and the record agree: generated surfaces are unedited." },
  { kind: "des", name: "Design review", claims: "The record is complete and consistent with the book and the old behaviour. An agent decides it, not a machine." },
  { kind: "rpc", name: "RPC", claims: "Its server span has the declared child spans and attributes, it fails only with its declared errors, and its server time stays within budget." },
  { kind: "flw", name: "Flow", claims: "Each step is a span, wait steps are marked as waits, and client time stays within budget." },
  { kind: "prc", name: "Procedure", claims: "Its writes commit with its invoker's transaction or not at all." },
  { kind: "tbl", name: "Table", claims: "The migration creates exactly its fields, key and indexes; only its declared writers change it; a second tenant reads and writes none of the first's rows." },
  { kind: "trn", name: "Transition", claims: "An eval run observes this transition, with its events." },
  { kind: "wfl", name: "Workflow", claims: "A second run with the same key changes nothing; killed mid-run, it resumes and finishes with the same result; each wait is woken only by its key." },
  { kind: "int", name: "Integration", claims: "The devnet fake and the real service pass the same conformance suite, and each failure reaches callers as its declared error." },
  { kind: "jrn", name: "Journey", claims: "The journey's scenario runs end to end on a devnet: every step's operation succeeds in order for the scenario's people." },
  { kind: "fun", name: "Funnel", claims: "Every step has a proving event, sent once and in order, so the funnel can be derived." },
  { kind: "sys", name: "System", claims: "A rule of the whole system holds: a line budget, the import rules, generated files equal what the generator produces." },
  { kind: "inv", name: "Invariant", claims: "The invariant's statement holds over its tables and machines." },
  { kind: "env", name: "Environment", claims: "The environment boots within its time, and a smoke journey passes on it." },
  { kind: "live", name: "Live traffic", claims: "On real traffic over days, a budget, a defect rate or a funnel stays within its bound." },
];

/** The four levels, one line each. */
export const LEVELS: readonly { readonly level: string; readonly title: string; readonly about: string }[] = [
  { level: "L1", title: "Level 1: one operation", about: "One operation, and the records below it. Every machine eval runs through the CLI on a devnet, as a black box." },
  { level: "L2", title: "Level 2: a journey", about: "A journey's scenario runs end to end on a devnet, and each step sends the event that proves it." },
  { level: "L3", title: "Level 3: the system", about: "What must hold of the whole system: size budgets, import rules, generated files, invariants and environments." },
  { level: "L4", title: "Level 4: live traffic", about: "A machine reads real traffic over days: budgets, defect rates and funnels on staging and production." },
];

/** The kind of an eval: what its id says before the colon. */
export const kindOf = (evalId: string): string => (evalId.includes(":") ? evalId.slice(0, evalId.indexOf(":")) : "eval");

const ORDER = new Map(KINDS.map((k, i) => [k.kind, i] as const));
/** What a kind claims; a kind this file does not name is shown by its id, with no claim put in its mouth. */
export const evalKind = (kind: string): EvalKind => KINDS[ORDER.get(kind) ?? -1] ?? { kind, name: kind, claims: "" };
/** Kinds in the spec's order, unknown ones last by name. */
export const inOrder = (kinds: readonly string[]): readonly string[] =>
  [...new Set(kinds)].toSorted((a, b) => (ORDER.get(a) ?? KINDS.length) - (ORDER.get(b) ?? KINDS.length) || a.localeCompare(b, "en"));
