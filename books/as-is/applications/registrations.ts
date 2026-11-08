// The as-is book of the old applications concept: the registrations area.
//
// Every operation registered at `applications/registrations:*` (packages/backend/convex/applications/
// registrations.ts). `list` and `create` implement the public rows `registrations`
// (packages/protocol/src/applications/operations.ts:63); `register` is an internal mutation the
// quickstart mint and the devnet seed run through `ctx.runMutation`, and operator scripts run with
// `convex run`. Nothing here is scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_developer_applications } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/applications/registrations.ts`;
const A = `${BACKEND}/src/applications`;
const R = `${A}/registrations`;
const ROWS = "packages/protocol/src/applications/operations.ts";

/** `Application` (operations.ts:22): a registered application as its owner sees it. */
const Application = Schema.Struct({
  id: Schema.String,
  authUserId: Schema.String,
  name: Schema.String,
  allowedOrigins: Schema.Array(Schema.String),
  createdAt: Schema.Number,
  archivedAt: Schema.NullOr(Schema.Number),
});

/** `requireCaller` (guards.ts:14): the session's person, who must be the authUserId the call names. */
const CALLER_WAS = [`${A}/guards.ts:14`, `${A}/errors.ts:8`, `${A}/errors.ts:10`, `${BACKEND}/src/platform/session.ts:17`];

/** CALL plus DEFECTS (operations.ts:19, protocol operation.ts:54). */
const ROW_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

export const rpc_applications_registrations_list = defineRpc({
  id: "applications.registrations.list",
  title: "The caller's active applications",
  about:
    "Row `applications.registrations.list`, registered as the public query `applications/registrations:list`. " +
    "`requireCaller` refuses no session or a claimed `authUserId` that is not the session's (NOT_AUTHENTICATED), and an " +
    "empty one (INVALID_INPUT). Reads the person's applications by `ownerAuthUserId`, drops archived ones and answers " +
    "them in one page with no cursor (`onePage`), in index order (owner, then name). An Organization's applications " +
    "are not listed here: they carry no `ownerAuthUserId`. There is no page limit.",
  was: [`${CONVEX}:3`, `${R}/operations/list.ts:11`, `${R}/reads.ts:8`, `${R}/views.ts:11`, `${ROWS}:65`, ...CALLER_WAS],
  concept: concept_applications,
  kind: "query",
  who: "A signed-in person, for themselves only (`requireCaller`).",
  input: Schema.Struct({ authUserId: Schema.String }),
  output: Schema.Struct({ items: Schema.Array(Application), nextCursor: Schema.Null }),
  errors: ROW_ERRORS,
  reads: [table_developer_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_registrations_create = defineRpc({
  id: "applications.registrations.create",
  title: "Register an application, or replace the origins of the caller's one",
  about:
    "Row `applications.registrations.create`, registered as the public mutation `applications/registrations:create`. " +
    "`requireCaller` as for list; the name is trimmed to 1..64 characters and each origin must be an http(s) origin " +
    "without a wildcard host, normalized to `protocol//host` (INVALID_INPUT otherwise). The caller's active application " +
    "with that name has its origins replaced (and `updatedAt`); none: a new application is inserted " +
    "with `ownerAuthUserId` and placeholder routing and vendor keys (`https://auth.capxul.local`, `pk_test_platform`, " +
    "registrations/writes.ts:16). An empty origin list is accepted here (keys.create refuses one). Writes no key and " +
    "emits nothing.",
  was: [
    `${CONVEX}:3`,
    `${R}/operations/create.ts:12`,
    `${R}/reads.ts:21`,
    `${R}/writes.ts:24`,
    `${R}/writes.ts:59`,
    `${R}/writes.ts:16`,
    `${A}/rules.ts:72`,
    `${A}/rules.ts:80`,
    `${ROWS}:72`,
    ...CALLER_WAS,
  ],
  concept: concept_applications,
  kind: "mutation",
  who: "A signed-in person, for themselves only (`requireCaller`).",
  input: Schema.Struct({
    authUserId: Schema.String,
    name: Schema.String,
    allowedOrigins: Schema.Array(Schema.String),
  }),
  output: Application,
  errors: ROW_ERRORS,
  reads: [table_developer_applications],
  writes: [table_developer_applications],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_registrations_register = defineRpc({
  id: "applications.registrations.register",
  title: "Register an unowned application, or return the identical one",
  about:
    "The internal mutation `applications/registrations:register`. Reads every application with the name and keeps " +
    "the active, unowned ones (no `ownerAuthUserId`, no `ownerOrgId`) with exactly this routing, vendor keys and origin " +
    "set (`isSameRegistration`). Two such matches refuse WRONG_STATE (`multiple-active-matches`); one is returned; none: " +
    "a new unowned application is inserted with a fresh `app_` id. An archived match is never reused, so a retired " +
    "proof's name registers again as a new row. Origins are stored as given: no normalization or wildcard check.",
  was: [
    `${CONVEX}:5`,
    `${R}/operations/register.ts:17`,
    `${R}/operations/register.ts:32`,
    `${R}/rules.ts:13`,
    `${R}/errors.ts:7`,
    `${R}/writes.ts:37`,
    `${A}/reads.ts:61`,
    `${A}/writes.ts:27`,
  ],
  concept: concept_applications,
  kind: "mutation",
  who:
    "internal: run by applications.quickstarts.mint (`registerQuickstart`, quickstarts/writes.ts:44), operator.fixtures.seed " +
    "(`registerDevnetApplication`, operator/fixtures/writes.ts:137), and operator scripts with `convex run` " +
    "(packages/backend/scripts/publishable-keys/).",
  input: Schema.Struct({
    name: Schema.String,
    allowedOrigins: Schema.Array(Schema.String),
    authBaseUrl: Schema.String,
    convexUrl: Schema.String,
    siteBaseUrl: Schema.String,
    openfortPublishableKey: Schema.String,
    shieldPublishableKey: Schema.String,
  }),
  output: Schema.Struct({ applicationId: Schema.String }),
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_developer_applications],
  writes: [table_developer_applications],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
