/** The check module's door: what the blueprint expects of the site, and the verdict on a generated one. */
import { unknownEvals, type AnyRecord, type Blueprint, type StatusDocument } from "@capxul/blueprint-engine";

import { coverage } from "./internal/coverage.ts";
import { climb, evals, guide, identical, questions, stands } from "./internal/data.ts";
import { links } from "./internal/links.ts";
import type { Expect, Outcome } from "./types.ts";

const FIXED = ["index", "review", "design", "build", "docs"];
/** The catalogues under Docs: one page each at `docs/<name>`, whatever the blueprint holds. */
const CATALOGUES = [
  "commands", "events", "errors", "spans", "tables", "machines", "rpcs", "flows", "procedures", "workflows", "contracts",
  "integrations", "journeys", "invariants", "components", "environments", "doctypes", "hats", "features", "screens", "logs",
  "metrics", "insights", "alerts", "dashboards", "decisions",
];
/** The kind of an eval: what its id says before the colon. Each kind the blueprint derives has a page at `eval/<kind>`. */
const evalKind = (id: string): string => (id.includes(":") ? id.slice(0, id.indexOf(":")) : "eval");
/** Kinds with no page of their own: a child is an anchor on its parent's page, and the system is the Overview. */
const NO_PAGE = new Set(["transition", "call", "function", "chainEvent", "system"]);
const SHOWN = 10;

const outcome = (check: string, failures: readonly string[]): Outcome =>
  ({ check, failures: failures.length, detail: failures.slice(0, SHOWN) });

/** What the blueprint says the site must hold. `waits` is the one predicate the judgments report uses. */
export const expect = (
  blueprint: Blueprint, waits: (decision: AnyRecord) => boolean, status: StatusDocument | null = null, ownerNeeds: readonly string[] = [],
  extraPages: readonly string[] = [],
): Expect => {
  const records = [...blueprint.records.values()];
  return {
    pages: [
      ...FIXED, ...extraPages, ...records.filter((r) => !NO_PAGE.has(r._kind)).map((r) => `${r._kind}/${r.id}`),
      ...CATALOGUES.map((name) => `docs/${name}`), "eval", ...[...new Set(blueprint.evals.map((e) => evalKind(e.id)))].map((kind) => `eval/${kind}`),
    ],
    evals: blueprint.evals.length,
    unknownStatus: status === null ? [] : unknownEvals(blueprint, status),
    waiting: [...records.filter((r) => r._kind === "decision" && waits(r)).map((r) => r.id), ...ownerNeeds],
    operations: records.filter((r) => r._kind === "operation").map((r) => r.id),
  };
};

/** Every part of the check on one generation. `again` is a second generation of the same blueprint. */
export const check = (files: ReadonlyMap<string, string>, again: ReadonlyMap<string, string>, expected: Expect): readonly Outcome[] => [
  outcome("every record has a page and both twins, and every page belongs to a record", coverage(files, expected.pages)),
  outcome("every internal link and anchor resolves", links(files)),
  outcome("two generations are byte-identical", identical(files, again)),
  outcome("the Questions list equals the judgments list plus the plan's needs of the owner", questions(files, expected.waiting)),
  outcome("the Overview climb statuses agree with their counts", climb(files)),
  outcome("every operation has a stand", stands(files, expected.operations)),
  outcome("the eval catalogue lists every eval the blueprint derives", evals(files, expected.evals)),
  outcome("the Blueprint page fills every table its guide marks, and follows a real record", expected.pages.includes("blueprint") ? guide(files) : []),
  outcome("every status entry names an eval the blueprint derives", expected.unknownStatus.map((id) => `${id}: in status/status.json, and the blueprint derives no such eval`)),
];

export const passed = (outcomes: readonly Outcome[]): boolean => outcomes.every((o) => o.failures === 0);
