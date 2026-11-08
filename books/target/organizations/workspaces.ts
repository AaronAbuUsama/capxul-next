// The workspaces area: the Organizations a person can act in (`org list`, `use org`) and their
// standing in one (`org me`). Every authority shown is read from the chain through indexing (the
// hats the member's Safe wears, the company Safe's signers and threshold, the budgets whose office
// hat they wear), named through the Organization's deployment. Nothing here is a Capxul grant.
// The old treasuries area (the company Safe's balance) is activity's `balance` for whoever you act
// as; the old roles catalog is replaced by the deployment's named officer hats.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import {
  table_org_deployments,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import { SetupView } from "./setups.ts";
import { table_parties } from "../parties/data.ts";
import { table_chain_budgets, table_hat_wearers, table_safe_owners } from "../indexing/data.ts";

const O = "packages/backend/src/organizations";
const W = `${O}/workspaces`;
const AS_IS = "books/as-is/organizations/workspaces.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;

/** What a member may do, from the chain: the People hat, any budget's office hat, the Director hat. */
export const Capabilities = Schema.Struct({
  managePeople: B,
  spend: B,
  director: B,
  /** How many Directors must approve a Board change: the company Safe's threshold. */
  approvalsNeeded: N,
});

export const rpc_organizations_workspaces_list = defineRpc({
  id: "organizations.workspaces.list",
  title: "The Organizations the caller can act in, and the setups they founded that are unfinished",
  about:
    "One page of the caller's current Seats (by principal), one row per Organization sorted by Organization ID, each with " +
    "its handle (its Party), its company Safe, its setup state, the caller's Seat and capabilities (the hats the Seat's " +
    "Safe wears, named through the deployment). Below every page, in full, the setups the caller founded that are not " +
    "ready: an unfinished setup gives no Seat and no access to the workspace. The founder's own email shows only to the " +
    "founder. A page outside 1 to 100, or a cursor this list did not issue, is INVALID_INPUT.",
  was: [`${AS_IS}:62`, `${W}/operations/list.ts:9`, `${W}/reads/workspaces.ts:48`, `${O}/setups/reads/setups.ts:97`],
  concept: concept_organizations,
  kind: "query",
  who: "Any signed-in person.",
  input: Schema.Struct({ limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        id: S,
        name: S,
        handle: S,
        account: S,
        setup: S,
        member: Schema.Struct({ memberId: S, kind: Schema.Literals(["human", "agent"]) }),
        capabilities: Capabilities,
        founderEmail: NullOr(S),
      }),
    ),
    nextCursor: NullOr(S),
    unfinishedSetups: Schema.Array(SetupView),
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [
    table_org_members,
    table_organizations,
    table_org_setups,
    table_org_deployments,
    table_parties,
    table_hat_wearers,
    table_safe_owners,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_organizations_workspaces_me = defineRpc({
  id: "organizations.workspaces.me",
  title: "The caller's standing in one Organization",
  about:
    "The caller's active Seat here (else ROLE_PERMISSION_DENIED: a removed Seat, a non-member and an unfinished setup " +
    "alike), and from the chain: the role (Director when the Seat's Safe is a signer the Gate holds valid, else Member), " +
    "whether it wears the People hat (manage people) and any budget's office hat (spend), the company Safe's threshold, " +
    "and the budgets it can pay from, each with its label and its per-payment cap, or no cap when the budget sets none.",
  was: [`${AS_IS}:97`, `${W}/operations/me.ts:9`, `${W}/reads/standing.ts:158`],
  concept: concept_organizations,
  kind: "query",
  who: "An active member of the Organization.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({
    member: Schema.Struct({ memberId: S, accountId: S, kind: Schema.Literals(["human", "agent"]), safe: S }),
    role: NullOr(Schema.Literals(["Director", "Member"])),
    capabilities: Capabilities,
    budgets: Schema.Array(Schema.Struct({ budgetId: S, label: S, token: S, perPaymentCap: NullOr(S) })),
  }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_members, table_org_deployments, table_organizations, table_hat_wearers, table_safe_owners, table_chain_budgets],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
