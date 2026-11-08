// The project-types area: Frappe's Project Type, named by its title. Start-up writes ERPNext's three
// (Internal, External, Other; projects.startup). Any member lists them; People or a Director adds one
// (projects.permissions). A project names its type by that title.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_project_types } from "./data.ts";
import {
  FRAPPE,
  HAT_CALLS,
  HAT_CHAIN,
  HAT_GUARD,
  HAT_READS,
  LOG_LINE,
  LOGGED,
  MANAGE_ERRORS,
  MEMBER_GUARD,
  MEMBER_READS,
  READ_ERRORS,
  WHO_MANAGER,
  WHO_MEMBER,
} from "./guards.ts";
import { OrgInput, Page, ProjectType } from "./shapes.ts";

const S = Schema.String;
const WAS = [`${FRAPPE}/project_type/project_type.json`];

export const rpc_projects_project_types_add = defineRpc({
  id: "projects.project-types.add",
  title: "Add a project type",
  about:
    HAT_GUARD +
    "A name is 1 to 140 characters and is no project type's of the Organization's already, compared without case " +
    "(INVALID_INPUT otherwise: a type is named by its title); a description is optional. It writes the type. " +
    LOG_LINE,
  was: WAS,
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: Schema.Struct({ ...OrgInput, name: S, description: Schema.optionalKey(S) }),
  output: ProjectType,
  errors: MANAGE_ERRORS,
  reads: [...HAT_READS, table_project_types],
  writes: [table_project_types, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_projects_project_types_list = defineRpc({
  id: "projects.project-types.list",
  title: "List the project types",
  about:
    MEMBER_GUARD +
    "Every project type of the Organization, by name, with its description. The Organization has a handful, so the " +
    "list has no pages.",
  was: WAS,
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct(OrgInput),
  output: Page(ProjectType),
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, table_project_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
