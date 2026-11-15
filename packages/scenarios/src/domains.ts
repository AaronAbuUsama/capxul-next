// Every domain's scenarios, each a file of domains/ (domain.ts): its operations' checks, its journeys and its claims'
// places. checks/all.ts, registry.ts and coverage.ts gather them from here. A new domain of the blueprint is one import
// here and one entry in `domains`, and the compiler asks for it: every domain of the blueprint has its entry.
//
// The list is typed, not found by walking the disk: a domain, a journey or a check that is not listed does not run,
// and the compiler sees every one.
import type { domains as blueprint } from "@capxul/blueprint";
import type { Domain } from "./domain.ts";
import * as Approvals from "./domains/approvals.ts";
import * as Board from "./domains/board.ts";
import * as Budgets from "./domains/budgets.ts";
import * as Documents from "./domains/documents.ts";
import * as Organizations from "./domains/organizations.ts";
import * as People from "./domains/people.ts";
import * as Record from "./domains/record.ts";
import * as Reports from "./domains/reports.ts";
import * as World from "./domains/world.ts";

/** Every domain's scenarios, by the blueprint's name for it. The journeys run in this order, domain by domain. */
export const domains: { readonly [D in keyof typeof blueprint]: Domain<(typeof blueprint)[D]> } = {
  world: World,
  organizations: Organizations,
  people: People,
  board: Board,
  budgets: Budgets,
  documents: Documents,
  approvals: Approvals,
  reports: Reports,
  record: Record,
};
