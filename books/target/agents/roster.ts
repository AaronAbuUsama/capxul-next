// The agents concept's roster area: reading agents. `agent list` reads the rows as they stand;
// `agent show` reads one agent with what its Safe holds, read live from the chain, and the Seats
// it holds. Neither settles anything: the change's process has already moved every row on chain
// proof, so a read never writes (the old get and show settled a sent create or change from its
// receipt first; decision agents.one-process).
//
// Row-level security scopes every read to the agents whose owner the session acts for (the person,
// or an Organization they are a member of) and to the agent's own row for an agent signed in with
// its own key (P8). The rpcs narrow an Organization's agents to its Directors.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_agents } from "../shared/foundation.ts";
import { contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import {
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_chain_hats, table_hat_wearers, table_safe_owners } from "../indexing/data.ts";
import { table_personal_safes } from "../accounts/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_agent_changes, table_agents } from "./data.ts";
import { AgentDetail, ListJson, RefInput } from "./shapes.ts";
import { Schema } from "effect";

const OLD = "packages/backend/src/accounts/agents";
const CONVEX = "packages/backend/convex/accounts/agents.ts";
const ROWS = "packages/protocol/src/accounts/agent-operations.ts";
const AS_IS = "docs/as-is/archive/accounts/agents.ts";

/** What an agent's view joins: its Party (name, handle), its principal (accountId) and its owner's rows. */
const VIEW_READS = [
  table_agents,
  table_agent_changes,
  table_parties,
  table_principals,
  table_personal_safes,
  table_organizations,
  table_safe_owners,
];

const VIEW =
  "Each agent is its row joined to what others own: its name and handle from its Party, its `accountId` from access' " +
  "principal at its Safe (null until its first sign-in with its own key), the owner's email and Safe from access and " +
  "accounts (a person) or its handle, name and company Safe from parties and organizations (an Organization), and its " +
  "newest change (`by-agent-created`) as `lastChange`.";

export const rpc_agents_roster_list = defineRpc({
  id: "agents.roster.list",
  title: "List the agents you own, newest first",
  about:
    "Every agent the caller owns (`by-owner-created`), newest first, then the agents of each Organization the caller is " +
    "a Director of (their own Safe among the company Safe's owners in indexing's safe-owners), each with its owner. " +
    VIEW + " A create whose approval lapsed unsent already reads `failed`: its process failed it when the approval " +
    "expired, so nothing is judged at read time. Another person's agents are never listed: row-level security scopes " +
    "the rows to the caller's own and their Organizations', and the rpc keeps only those it acts for. No balances.",
  was: [`${CONVEX}:11`, `${OLD}/operations/list.ts:16`, `${OLD}/views.ts:39`, `${ROWS}:149`, AS_IS],
  concept: concept_agents,
  kind: "query",
  who: "A signed-in person: their own agents, and those of the Organizations they are a Director of.",
  input: Schema.Struct({}),
  output: ListJson,
  errors: [error_NOT_AUTHENTICATED],
  reads: VIEW_READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_agents_roster_show = defineRpc({
  id: "agents.roster.show",
  title: "Show one agent, with what its Safe holds and the Seats it holds",
  about:
    "The agent by its `agent_` id or `@handle`. The caller must be its owner, a Director of the Organization that owns " +
    "it, or the agent itself (signed in with its own key: its principal's Safe is the agent's, `by-safe`); anyone else, " +
    "and a ref that names no agent, is one ROLE_PERMISSION_DENIED, so a handle never tells who owns it. " + VIEW + " Its " +
    "positions are read live: `balanceOf` of its Safe for each settlement asset of the deployment, at `latest` and in " +
    "parallel (chain-rpc); a node that does not answer is PROVIDER_ERROR, and no balance is made up. Its Seats are " +
    "organizations' active Seats at its Safe, each with what it was given: the hats its Safe wears in that " +
    "Organization's tree (indexing's hat-wearers and chain-hats), named by the deployment's officer hats (organizations' " +
    "org-deployments: Books, Invoicing, People) or else by the hat's own details. It writes nothing.",
  was: [`${CONVEX}:25`, `${OLD}/operations/show.ts:24`, `${OLD}/reads/rows.ts:24`, `${ROWS}:78`, AS_IS],
  concept: concept_agents,
  kind: "action",
  who: "The agent's owner, a Director of the Organization that owns it, or the agent itself.",
  input: RefInput,
  output: AgentDetail,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [...VIEW_READS, table_org_members, table_org_deployments, table_hat_wearers, table_chain_hats],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf],
  spans: [],
  budget: budget("chain-read"),
});
