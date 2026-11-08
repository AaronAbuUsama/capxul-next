// The as-is book of the old organizations concept: the treasuries area.
//
// Every operation registered at `organizations/treasuries:*` (packages/backend/convex/organizations/
// treasuries.ts:3-4): the public `read` action built from its protocol row
// (packages/protocol/src/organizations/operations.ts:185-192) and the internal `load` query it runs.

import { Schema } from "effect";
import { defineRpc, type CallRef, type FunctionRef } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  event_account_balance_read,
} from "../shared/vocabulary.ts";
import { contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import { table_org_members, table_orgs } from "./data.ts";
import { procedure_organizations_read_treasury_target, procedure_organizations_require_org_participant } from "./procedures.ts";
import { procedure_accounts_read_positions } from "../accounts/procedures.ts";

const O = "packages/backend/src/organizations";
const T = `${O}/treasuries`;
const CONVEX = "packages/backend/convex/organizations/treasuries.ts";

const callOf = (integration: { readonly id: string; readonly c: object }, name: string): CallRef =>
  (integration.c as Record<string, CallRef | undefined>)[name] ??
  ({ _kind: "call", id: `${integration.id}.${name}`, integration: integration.id, name } as CallRef);
const fnOf = (contract: { readonly id: string; readonly f: object }, name: string): FunctionRef =>
  (contract.f as Record<string, FunctionRef | undefined>)[name] ??
  ({ _kind: "function", id: `${contract.id}.${name}`, contract: contract.id, name } as FunctionRef);

const S = Schema.String;
const N = Schema.Number;
const Target = Schema.Struct({ orgId: S, chainId: N, safeAddress: S });

export const rpc_organizations_treasuries_read = defineRpc({
  id: "organizations.treasuries.read",
  title: "The Organization Account's live balances",
  about:
    "Row `organizations.treasuries.read`, the public action `organizations/treasuries:read`. Signed in " +
    "(`signedInAction`). `readTarget` runs organizations.treasuries.load (participant check, the stored chain and Safe), " +
    "then Accounts' `readPositions` makes one ERC-20 `balanceOf` per configured settlement asset of the chain " +
    "(eth_call), and after each read queues one server-confirmed account_balance_read (account_kind orgTreasury, the " +
    "balance bucket and the read's duration) for delivery after the action answers. Answers the Organization, chain " +
    "and positions.",
  was: [`${T}/operations/read.ts:12`, `${CONVEX}:4`, "packages/protocol/src/organizations/operations.ts:187", `${T}/reads.ts:40`, `${T}/events.ts:11`],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({ orgId: S }),
  /** `TreasurySchema` (protocol organizations/schema.ts): orgId, chainId and one position per asset; a position is too deep to transcribe. */
  output: Schema.Struct({ orgId: S, chainId: N, positions: Schema.Array(Schema.Unknown) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR],
  reads: [table_orgs, table_org_members],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_treasury_target, procedure_accounts_read_positions],
  emits: [event_account_balance_read],
  calls: [callOf(integration_chain_rpc, "fetchEthCall")],
  chain: [fnOf(contract_erc20, "balanceOf")],
  spans: [],
});

export const rpc_organizations_treasuries_load = defineRpc({
  id: "organizations.treasuries.load",
  title: "The read action's participant check and stored Organization Account",
  about:
    "Internal query: `requireOrgParticipant` (ROLE_PERMISSION_DENIED), then the stored Organization's id, chain and Safe; " +
    "a vanished row is UNKNOWN. Names the signed-in person and the verified Organization on the wide event.",
  was: [`${T}/operations/load.ts:15`, `${CONVEX}:3`, `${T}/reads.ts:23`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: organizations.treasuries.read and Accounts' home read, through `readTreasuryTarget`.",
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Target,
  errors: [error_ROLE_PERMISSION_DENIED, error_UNKNOWN],
  reads: [table_orgs, table_org_members],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
