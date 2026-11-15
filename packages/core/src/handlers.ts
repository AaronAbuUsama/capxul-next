// The handlers of every blueprint operation, gathered from Core's handlers of each blueprint domain (src/domains/,
// one file per domain, each with its share of the groups it serves). A new domain is one import here and one entry in
// each group it serves.
//
// `toLayer` takes exactly one handler per operation of its group: leave a domain out and this file no longer compiles.
import { PlatformRpcs, WorldRpcs } from "@capxul/blueprint";
import * as Approvals from "./domains/approvals.ts";
import * as Budgets from "./domains/budgets.ts";
import * as Documents from "./domains/documents.ts";
import * as Organizations from "./domains/organizations.ts";
import * as People from "./domains/people.ts";
import * as Record from "./domains/record.ts";
import * as Reports from "./domains/reports.ts";
import * as World from "./domains/world.ts";

/** The platform group: what `packages/world` serves. Core serves it, empty, until its platform door goes. */
export const PlatformHandlers = PlatformRpcs.toLayer({ ...World.platform });

/** The world group: everything that acts inside one running world, served through its door. */
export const WorldHandlers = WorldRpcs.toLayer({
  ...Organizations.world,
  ...People.world,
  ...Budgets.world,
  ...Documents.world,
  ...Approvals.world,
  ...Reports.world,
  ...World.world,
  ...Record.world,
});
