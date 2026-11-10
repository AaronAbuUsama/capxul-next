// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision, type Concept } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as v from "./vocabulary.ts";
import * as x from "./external.ts";

export const decision_dependencies_of_projects = dependencies(f.concept_projects, {
  access: "the caller of every rpc, and the principal a head user's edit is matched to.",
  parties: "a project's customer and a member named on a task or timesheet are Parties.",
  organizations: "projects are an Organization's, kept by its members; its setup starts the projects' start-up and its head connection their sync.",
});
