// The settings area: Frappe's single Projects Settings, one row per Organization, which start-up
// writes when the Organization begins (projects.startup). Any member reads it; People or a Director
// sets it. It is Capxul's own, not pushed to a head: every change a head sends is checked against it
// as a command's is (projects.settings-here).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_project_settings } from "./data.ts";
import {
  FRAPPE,
  HAT_CALLS,
  HAT_CHAIN,
  MANAGE_ERRORS,
  HAT_GUARD,
  HAT_READS,
  MEMBER_GUARD,
  MEMBER_READS,
  GUARD_ERRORS,
  WHO_MANAGER,
  WHO_MEMBER,
} from "./guards.ts";
import { OrgInput, Settings } from "./shapes.ts";

const B = Schema.Boolean;
const Opt = Schema.optionalKey;

export const rpc_projects_settings_show = defineRpc({
  id: "projects.settings.show",
  title: "Read the Organization's Projects Settings",
  about:
    MEMBER_GUARD +
    "The Organization's Projects Settings: whether one worker's time logs may overlap, whether one employee's may, and " +
    "whether an invoice fetches timesheets. Start-up wrote them false when the Organization began.",
  was: [`${FRAPPE}/projects_settings/projects_settings.json`],
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct(OrgInput),
  output: Settings,
  errors: GUARD_ERRORS,
  reads: [...MEMBER_READS, table_project_settings],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_projects_settings_set = defineRpc({
  id: "projects.settings.set",
  title: "Set the Organization's Projects Settings",
  about:
    HAT_GUARD +
    "It sets the values given and keeps the rest, under the settings row's lock, so a time log checked in the same " +
    "instant sees either the old values or the new. No value given is INVALID_INPUT. A submitted timesheet's logs are " +
    "not checked again; a draft's are checked against the new values when it next takes a log or is submitted, as " +
    "ERPNext checks every log of a draft each time it is saved. It is not a projects record a head receives, so it " +
    "appends no change (projects.settings-here).",
  was: [`${FRAPPE}/projects_settings/projects_settings.json`, `${FRAPPE}/timesheet/timesheet.py:225`],
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: Schema.Struct({
    ...OrgInput,
    allowUserOverlap: Opt(B),
    allowEmployeeOverlap: Opt(B),
    fetchTimesheets: Opt(B),
  }),
  output: Settings,
  errors: MANAGE_ERRORS,
  reads: [...HAT_READS, table_project_settings],
  writes: [table_project_settings],
  drives: [],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});
