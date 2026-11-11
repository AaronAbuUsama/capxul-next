// The as-is book of the old payroll concept: the groups area (PAYROLL #1626), a saved roster the
// employer pays again.
//
// Every operation registered at `payroll/groups:*` (packages/backend/convex/payroll/groups.ts). Three
// are public rows of `groups` (packages/protocol/src/payroll/operations.ts); emitChanged is telemetry
// plumbing a committed group write schedules. Who may shape a roster is ruling Q5: a member who holds a
// Budget in the Organization (requireSpender, packages/backend/src/payroll/guards.ts:22).

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  event_payroll_group_changed,
} from "../shared/vocabulary.ts";
import { table_payroll_groups } from "./data.ts";
import { procedure_access_require_feature } from "../access/procedures.ts";
import { procedure_permissions_list_spend_authorities } from "../permissions/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payroll/groups.ts`;
const SRC = `${BACKEND}/src/payroll`;
const GROUPS = `${SRC}/groups`;
const OPS = `${GROUPS}/operations`;
const ROWS = "packages/protocol/src/payroll/operations.ts";
const SCHEMA = "packages/protocol/src/payroll/schema.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** `CALL`, `DEFECTS` and `DENIED` (operations.ts:101, :109; protocol/src/operation.ts:54). */
const GROUP_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED];

/** `PayrollGroupMemberSchema` (schema.ts:181): a Party id, the employer's typed amount, a currency code. */
const Member = Schema.Struct({ partyId: S, amount: S, currency: S });
/** `PayrollGroupSchema` (schema.ts:196). */
const Group = Schema.Struct({ id: S, name: S, tone: S, members: Schema.Array(Member) });

/** requireSpender: a Budget in the Organization, from Permissions' listSpendAuthorities (guards.ts:22). */
const SPENDER = [procedure_permissions_list_spend_authorities];
const SPENDER_WAS = [`${SRC}/guards.ts:22`, `${SRC}/guards.ts:26`, `${SRC}/guards.ts:28`, `${SRC}/errors.ts:7`];

const WHO =
  "A signed-in member who holds a Budget (a spending allowance) in the Organization (ruling Q5, requireSpender); " +
  "anyone else is ROLE_PERMISSION_DENIED condition_violation naming the operation.";

export const rpc_payroll_groups_list = defineRpc({
  id: "payroll.groups.list",
  title: "List an Organization's saved payroll groups",
  about:
    "Row `payroll.groups.list`, registered as the public query `payroll/groups:list`. Signed in; requireSpender (Permissions' " +
    "listSpendAuthorities must name at least one Budget; telemetry may then name the Organization). Every group of the " +
    "Organization, oldest first, as one page with no cursor. Annotates row_count.",
  was: [`${CONVEX}:4`, `${OPS}/list.ts:13`, `${GROUPS}/reads.ts:9`, `${GROUPS}/views.ts:8`, `${GROUPS}/events.ts:39`, `${ROWS}:114`, ...SPENDER_WAS],
  concept: concept_payroll,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ items: Schema.Array(Group), nextCursor: Schema.NullOr(S) }),
  errors: GROUP_ERRORS,
  reads: [table_payroll_groups],
  writes: [],
  drives: [],
  invokes: SPENDER,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_groups_save = defineRpc({
  id: "payroll.groups.save",
  title: "Create a payroll group, or replace one in place",
  about:
    "Row `payroll.groups.save`, registered as the public mutation `payroll/groups:save`. Signed in; the `payroll-runs` gate " +
    "(requireFeature, in the transaction); requireSpender. admitGroup trims the name (empty: INVALID_INPUT name) and drops " +
    "repeated Parties, keeping the first (none left: INVALID_INPUT members); amounts are not checked. Without an id a group " +
    "`payroll_group_<ULID>` is inserted; with one, the Organization's group of that id is replaced in place (keeping its id " +
    "and createdAt); an id this Organization has no group for is INVALID_INPUT `group not found`. Then it schedules " +
    "payroll_group_changed (created or updated, member count) in the same transaction and answers the group.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/save.ts:15`,
    `${OPS}/save.ts:18`,
    `${OPS}/save.ts:24`,
    `${GROUPS}/rules.ts:17`,
    `${GROUPS}/reads.ts:21`,
    `${GROUPS}/writes.ts:29`,
    `${GROUPS}/writes.ts:54`,
    `${GROUPS}/events.ts:45`,
    `${GROUPS}/errors.ts:5`,
    `${GROUPS}/errors.ts:10`,
    `${ROWS}:121`,
    `${SCHEMA}:208`,
    ...SPENDER_WAS,
  ],
  concept: concept_payroll,
  kind: "mutation",
  who: `${WHO} The \`payroll-runs\` gate must be on for the Organization.`,
  input: Schema.Struct({ orgId: S, id: opt(S), name: S, tone: S, members: Schema.Array(Member) }),
  output: Group,
  errors: [...GROUP_ERRORS, error_FEATURE_NOT_AVAILABLE],
  reads: [table_payroll_groups],
  writes: [table_payroll_groups],
  drives: [],
  invokes: [procedure_access_require_feature, ...SPENDER],
  emits: [event_payroll_group_changed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_groups_remove = defineRpc({
  id: "payroll.groups.remove",
  title: "Delete a payroll group",
  about:
    "Row `payroll.groups.remove`, registered as the public mutation `payroll/groups:remove`. Signed in; the `payroll-runs` " +
    "gate; requireSpender. A group already gone is not a refusal: two members deleting the same card both see it gone and " +
    "only the first reports it. Otherwise the row is deleted and payroll_group_changed `deleted` is scheduled with the " +
    "member count the row held. Answers null.",
  was: [`${CONVEX}:5`, `${OPS}/remove.ts:17`, `${OPS}/remove.ts:23`, `${GROUPS}/writes.ts:77`, `${GROUPS}/events.ts:45`, `${ROWS}:128`, ...SPENDER_WAS],
  concept: concept_payroll,
  kind: "mutation",
  who: `${WHO} The \`payroll-runs\` gate must be on for the Organization.`,
  input: Schema.Struct({ orgId: S, id: S }),
  output: Schema.Null,
  errors: [...GROUP_ERRORS, error_FEATURE_NOT_AVAILABLE],
  reads: [table_payroll_groups],
  writes: [table_payroll_groups],
  drives: [],
  invokes: [procedure_access_require_feature, ...SPENDER],
  emits: [event_payroll_group_changed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_groups_emit_changed = defineRpc({
  id: "payroll.groups.emit-changed",
  title: "Deliver one payroll group change event after its write commits",
  about:
    "Telemetry plumbing: registered as the internal action `payroll/groups:emitChanged`. groupChanged schedules it through " +
    "scheduleTelemetryEmit from the save or remove transaction, so a failed delivery never rolls back or repeats the " +
    "write. Only the durable group id, the Organization and a member count travel, never a group's name or amounts. It " +
    "attributes the event to the person, marks the Organization verified and posts payroll_group_changed (change, group, " +
    "member count, occurredAt) awaited, continuing the trace. It reads and writes no table.",
  was: [`${CONVEX}:3`, `${OPS}/emit-changed.ts:12`, `${GROUPS}/events.ts:28`, `${GROUPS}/events.ts:45`, `${GROUPS}/events.ts:65`],
  concept: concept_payroll,
  kind: "action",
  who: "internal: scheduled by groupChanged from the payroll.groups.save or payroll.groups.remove transaction.",
  input: Schema.Struct({
    authUserId: S,
    organizationId: S,
    change: Schema.Literals(["created", "updated", "deleted"]),
    groupId: S,
    memberCount: N,
    occurredAt: N,
    observationContext: opt(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_payroll_group_changed],
  calls: [],
  chain: [],
  spans: [],
});
