// The activity-types area: Frappe's Activity Type, the kinds of work time is logged against, named by
// their title, with default hourly rates. Start-up writes ERPNext's five (projects.startup). Any
// member lists them; People or a Director adds them, changes their rates, and disables and enables
// them (projects.permissions). A log takes its type's rates when it is made and keeps them.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_activity_types } from "./data.ts";
import {
  FRAPPE,
  HAT_CALLS,
  HAT_CHAIN,
  HAT_ERRORS,
  HAT_GUARD,
  HAT_READS,
  LOG_LINE,
  LOGGED,
  MANAGE_ERRORS,
  MEMBER_GUARD,
  MEMBER_READS,
  GUARD_ERRORS,
  WHO_MANAGER,
  WHO_MEMBER,
} from "./guards.ts";
import { ActivityType, OrgInput, Page } from "./shapes.ts";

const S = Schema.String;
const Opt = Schema.optionalKey;
/** An exact decimal string (projects.amounts). */
const Decimal = S;
const OneType = Schema.Struct({ ...OrgInput, name: S });
const Rates = { costingRate: Opt(Decimal), billingRate: Opt(Decimal) };
const RATES = "A rate is an hourly decimal of at least zero in the Organization's currency (INVALID_INPUT otherwise). ";
const WAS = [`${FRAPPE}/activity_type/activity_type.json`, `${FRAPPE}/timesheet_detail/timesheet_detail.py:128`];

/** A write to one activity type, behind the hat guard. */
const write = (verb: "add" | "change" | "disable" | "enable", title: string, what: string, input: Schema.Top, moves: boolean) =>
  defineRpc({
    id: `projects.activity-types.${verb}`,
    title,
    about: HAT_GUARD + what + " " + LOG_LINE,
    was: WAS,
    concept: concept_projects,
    kind: "action",
    who: WHO_MANAGER,
    input,
    output: ActivityType,
    errors: moves ? HAT_ERRORS : MANAGE_ERRORS,
    reads: [...HAT_READS, table_activity_types],
    writes: [table_activity_types, ...LOGGED],
    drives: [],
    invokes: [],
    emits: [],
    calls: HAT_CALLS,
    chain: HAT_CHAIN,
    spans: [],
    budget: budget("chain-read"),
  });

export const rpc_projects_activity_types_add = write(
  "add",
  "Add an activity type with default rates",
  "A name is 1 to 140 characters and is no activity type's of the Organization's already, compared as Frappe compares " +
    "names, without case (INVALID_INPUT otherwise: a type is named by its title). " +
    RATES +
    "It writes the type enabled, its rates zero when not given.",
  Schema.Struct({ ...OneType.fields, ...Rates }),
  false,
);

export const rpc_projects_activity_types_change = write(
  "change",
  "Change an activity type's default rates",
  "The type by its name, without regard to case (INVALID_INPUT otherwise), enabled or not, with at least one rate given (INVALID_INPUT " +
    "otherwise). " +
    RATES +
    "It sets the rates given and keeps the other. Logs already made keep their own rates; the next log takes the new.",
  Schema.Struct({ ...OneType.fields, ...Rates }),
  false,
);

export const rpc_projects_activity_types_disable = write(
  "disable",
  "Disable an activity type: it takes no new logs",
  "The type by its name, without regard to case (INVALID_INPUT otherwise). An enabled type is disabled, so no new log names it (ERPNext's " +
    "`validate_activity_type`); the logs that name it are kept. One already disabled is WRONG_STATE.",
  OneType,
  true,
);

export const rpc_projects_activity_types_enable = write(
  "enable",
  "Enable an activity type again",
  "The type by its name, without regard to case (INVALID_INPUT otherwise). A disabled type is enabled and takes logs again. One already " +
    "enabled is WRONG_STATE.",
  OneType,
  true,
);

export const rpc_projects_activity_types_list = defineRpc({
  id: "projects.activity-types.list",
  title: "List the activity types, enabled first",
  about:
    MEMBER_GUARD +
    "Every activity type of the Organization with its rates, enabled first, then by name. The Organization has a few " +
    "dozen at most, so the list has no pages.",
  was: WAS,
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct(OrgInput),
  output: Page(ActivityType),
  errors: GUARD_ERRORS,
  reads: [...MEMBER_READS, table_activity_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
