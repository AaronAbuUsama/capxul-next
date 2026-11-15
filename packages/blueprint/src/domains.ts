// Every domain of the blueprint, each a folder under src/ with its door, domain.ts: its operations, its share of the
// two Rpc groups and its claims. The door (../door.ts) gathers them into `operations` and the two groups, and
// claims/all.ts into `allClaims`. A new domain is one import here and one entry in `domains`.
import * as Rec from "effect/Record";
import * as Approvals from "./approvals/domain.ts";
import * as Board from "./board/domain.ts";
import * as Budgets from "./budgets/domain.ts";
import * as Documents from "./documents/domain.ts";
import * as Organizations from "./organizations/domain.ts";
import * as People from "./people/domain.ts";
import * as Record from "./record/domain.ts";
import * as Reports from "./reports/domain.ts";
import * as World from "./world/domain.ts";

/**
 * Every domain, by its folder under src/, where its claims are rendered (`claims.md`) beside its build order
 * (`order.md`). This order is the order of `operations` and of each Rpc group.
 */
export const domains = {
  organizations: Organizations,
  people: People,
  board: Board,
  budgets: Budgets,
  documents: Documents,
  approvals: Approvals,
  reports: Reports,
  world: World,
  record: Record,
} as const;

/** The names of one domain's operations, read the same way whichever domain it is. */
export const namesOf = (domain: { readonly operations: { readonly [name: string]: unknown } }): ReadonlyArray<string> =>
  Rec.keys(domain.operations);

export { Approvals, Board, Budgets, Documents, Organizations, People, Record, Reports, World };
