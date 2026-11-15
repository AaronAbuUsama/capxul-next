// Every domain's scenarios, each a file of domains/ (domain.ts): its operations' checks, its journeys and its claims'
// places. checks/all.ts, registry.ts and coverage.ts gather them from here. A new domain of the blueprint is one import
// here and one entry in `domains`, and the compiler asks for it: every domain of the blueprint has its entry.
//
// The list is typed, not found by walking the disk: a domain, a journey or a check that is not listed does not run,
// and the compiler sees every one and holds that every operation has its checks and its claims' places. Discovery
// would need the disk at run time and a dynamic import, and would find only files, not whether each operation has its
// checks. Every list is kept per domain so that several slices can add journeys and operations at once without
// editing the same file; checks/all.ts, registry.ts and coverage.ts name no journey and no operation.
//
// A journey's file never imports an operation's checks: a step's tries read them from `OperationChecks`, which the
// registry provides to each journey it registers. So a domain's file lists both its checks and its journeys without
// the two importing each other.
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
