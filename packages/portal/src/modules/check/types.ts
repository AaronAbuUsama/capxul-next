/**
 * The check module: the generated files in, a verdict per part out. It is the portal's own gate, and it knows the
 * site only by its written rules: `<kind>/<id>/index.html` for a record, `<page>.md` and `data/<page>.json` beside
 * it. It imports nothing from the modules that write the site, so a mistake there cannot hide here.
 */

/** What the blueprint says the site must hold. Worked out from the blueprint alone, never from the site. */
export interface Expect {
  /**
   * Every page id: the five fixed pages, `<kind>/<id>` for every record that has a page of its own, `docs/<name>`
   * for every catalogue, `eval`, and `eval/<kind>` for every kind of eval the blueprint derives.
   */
  readonly pages: readonly string[];
  /** The ids of everything that waits on the owner, in the page's order: the decisions the judgments report lists, then the plan's owner needs. */
  readonly waiting: readonly string[];
  /** Every operation id. */
  readonly operations: readonly string[];
  /** How many evals the blueprint derives. */
  readonly evals: number;
  /** The ids in the status document that the blueprint does not derive. Empty when there is no document. */
  readonly unknownStatus: readonly string[];
  readonly plan: PlanExpect;
}

/** What `plan check` says of plan/plan.json (one line per problem), and how many tasks it holds: null when there is no plan file. */
export interface PlanExpect {
  readonly problems: readonly string[];
  readonly tasks: number | null;
  /** The plan's tasks blocked on a need of the owner: they join the waiting decisions on the Questions page. */
  readonly ownerNeeds: readonly string[];
  /** The page ids of the plan's tasks and milestones: `plan/task/<id>` and `plan/milestone/<id>`. */
  readonly pages: readonly string[];
}

/** The verdict on one part of the check. It passed when `failures` is 0. */
export interface Outcome {
  readonly check: string;
  readonly failures: number;
  /** The first few failures, one line each. */
  readonly detail: readonly string[];
}
