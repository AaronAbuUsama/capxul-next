// The as-is book of the old payroll concept: the terms area (#1638), the rate in force for each open
// engagement, which the run composer may prefill from.
//
// One operation, registered at `payroll/terms:list` (packages/backend/convex/payroll/terms.ts). Payroll
// owns no terms table: the rates are Parties' `employed` edges and their terms, read through Parties.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import { procedure_organizations_read_organization_party_id_in_tx } from "../organizations/procedures.ts";
import { procedure_parties_read_open_employment_terms_in_tx } from "../parties/procedures.ts";
import { procedure_permissions_list_spend_authorities } from "../permissions/procedures.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src/payroll`;
const TERMS = `${SRC}/terms`;

const S = Schema.String;
const N = Schema.Number;

export const rpc_payroll_terms_list = defineRpc({
  id: "payroll.terms.list",
  title: "List the rate in force for each open engagement",
  about:
    "Row `payroll.terms.list`, registered as the public query `payroll/terms:list`. Signed in; requireSpender (a Budget in " +
    "the Organization, ruling Q5). An Organization with no Party has never run payroll and reads empty; a read never " +
    "writes a Party. Otherwise Parties' readOpenEmploymentTermsInTx: the active terms of every open `employed` edge of the " +
    "Organization's Party at now, one row per person at most; a person with no terms yet is absent, not zero. One page with " +
    "no cursor; annotates row_count.",
  was: [
    `${BACKEND}/convex/payroll/terms.ts:3`,
    `${TERMS}/operations/list.ts:13`,
    `${TERMS}/operations/list.ts:16`,
    `${TERMS}/reads.ts:16`,
    `${TERMS}/reads.ts:19`,
    `${TERMS}/reads.ts:21`,
    `${TERMS}/events.ts:8`,
    `${SRC}/guards.ts:22`,
    "packages/protocol/src/payroll/operations.ts:137",
    "packages/protocol/src/payroll/schema.ts:233",
  ],
  concept: concept_payroll,
  kind: "query",
  who:
    "A signed-in member who holds a Budget in the Organization (requireSpender); anyone else is ROLE_PERMISSION_DENIED " +
    "condition_violation.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        partyId: S,
        rate: S,
        unit: Schema.Literals(["hour", "week", "month", "year", "paycheck"]),
        currency: S,
        decimals: N,
        effectiveFrom: N,
      }),
    ),
    nextCursor: Schema.NullOr(S),
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_permissions_list_spend_authorities,
    procedure_organizations_read_organization_party_id_in_tx,
    procedure_parties_read_open_employment_terms_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
