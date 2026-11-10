// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/foundation.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import {
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineSystem,
  type Concept,
} from "../../../packages/book/src/index.ts";
import type { FrozenId } from "../../frozen/index.ts";

export const concept_projects = defineConcept({
  id: "projects",
  title: "Projects",
  about:
    "Projects in the shape of ERPNext's Projects module, one of the fundamental apps every Organization starts with " +
    "(aaron.projects, aaron.frappe-shape): projects with their users, tasks with their parents and dependencies, " +
    "timesheets with their time logs, activity types, project types and the Projects Settings, each a Frappe DocType's " +
    "fields with a Capxul id beside the head's name. Its start-up creates the settings and ERPNext's starting activity and " +
    "project types when the Organization begins, whether or not a Frappe head is ever connected; once one is, its sync " +
    "process pushes every change in order from its gap-free change log and applies the head's changes (organizations' " +
    "head-ownership rules). A task's expected end is its own process's timer on the one clock, never a daily sweep. It " +
    "moves no money: billing hours (a request) and paying them (a payslip) sit above it, and its one door, " +
    "`projects.bill-time`, marks the hours an Invoice bills in that request's transaction. Its 35 commands are new " +
    "operations beyond the 215, booked on its accepted pack (projects.commands). New in the rebuild.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_organizations],
});
