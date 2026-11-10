// The examples of the agents operations. Hannah Okafor owns the agent `ledger-agent`; its Safe is the cast's agent
// address, its key (the signer) another well-known test address. A change is carried by Hannah's approval.

import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SEAT_LIMIT_REACHED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, hash, ID, NORTHWIND, ok, PEOPLE, refused, uuid } from "../shared/examples.ts";

const AGENT_ID = `agent_${ID.agent}`;
const HANDLE = "ledger-agent";
const SIGNER = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
const NEW_SIGNER = "0xBcd4042DE499D14e55001CcbB24a551F3b954096";
const USDC = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const owner = { kind: "person", accountId: ID.hannah, email: PEOPLE.hannah.email, safe: ADDRESS.hannah } as const;
const carrier = (n: number) => ({ kind: "approval", id: `approval_${uuid(n)}`, url: `http://localhost:3000/approvals/approval_${uuid(n)}` }) as const;
const swept = { asset: "USDC", token: USDC, to: ADDRESS.hannah, rawAmount: "250000000", amount: "250.00" };

const change = (kind: string, n: number, over: Record<string, unknown> = {}) => ({
  changeId: `change_${uuid(n)}`,
  agentId: AGENT_ID,
  kind,
  state: "landed",
  carrier: carrier(n),
  oldSigner: null,
  signer: null,
  recipient: null,
  assets: [],
  swept: [],
  txHash: hash("a7"),
  failure: null,
  createdAt: "2026-02-10T09:10:00Z",
  endedAt: "2026-02-10T09:11:30Z",
  ...over,
});

const agent = (state: string, last: unknown, over: Record<string, unknown> = {}) => ({
  agentId: AGENT_ID,
  name: "ledger-agent",
  handle: HANDLE,
  accountId: ID.agent,
  safe: ADDRESS.agent,
  signer: SIGNER,
  key: { kind: "own-key", store: "file" },
  state,
  owner,
  createdAt: "2026-02-10T09:10:00Z",
  activatedAt: "2026-02-10T09:11:30Z",
  lastChange: last,
  ...over,
});

const mine = (cmd: string) => `capxul agent ${cmd} --json`;

export const examples_agent_create = [
  ok("Hannah creates ledger-agent and follows it until its Safe is on chain", "capxul agent create ledger-agent --handle ledger-agent --key file --json", {
    agentId: AGENT_ID,
    name: "ledger-agent",
    handle: HANDLE,
    accountId: null,
    safe: ADDRESS.agent,
    state: "active",
    owner,
    key: { store: "file" },
    changeId: `change_${uuid(1051)}`,
    carrier: carrier(1051),
  }),
  refused("The handle is taken", "capxul agent create ledger-agent --handle ledger-agent --json", error_INVALID_INPUT, { field: "handle", reason: "taken" }),
  refused("Hannah's own Safe is not claimed yet", mine("create ledger-agent"), error_SMART_ACCOUNT_MISSING),
  refused("Northwind already owns an agent of its own", `capxul agent create Second --org ${NORTHWIND.slug} --json`, error_SEAT_LIMIT_REACHED),
  refused("An organization-owned agent is not switched on", `capxul agent create ledger-agent --org ${NORTHWIND.slug} --json`, error_FEATURE_NOT_AVAILABLE),
  refused("Priya is not a Director of Northwind", `capxul agent create ledger-agent --org ${NORTHWIND.slug} --json`, error_ROLE_PERMISSION_DENIED),
  refused("Signed out", mine("create ledger-agent"), error_NOT_AUTHENTICATED),
];

export const examples_agent_freeze = [
  ok("Hannah freezes ledger-agent", mine(`freeze ${HANDLE}`), { agentId: AGENT_ID, handle: HANDLE, state: "frozen", changeId: `change_${uuid(1052)}`, carrier: carrier(1052) }),
  refused("It is already frozen", mine(`freeze ${HANDLE}`), error_WRONG_STATE, { state: "frozen" }),
  refused("Priya does not own that agent", mine(`freeze ${HANDLE}`), error_ROLE_PERMISSION_DENIED),
];

export const examples_agent_unfreeze = [
  ok("Hannah lets ledger-agent sign again", mine(`unfreeze ${HANDLE}`), { agentId: AGENT_ID, handle: HANDLE, state: "active", changeId: `change_${uuid(1053)}`, carrier: carrier(1053) }),
  refused("It is not frozen", mine(`unfreeze ${HANDLE}`), error_WRONG_STATE, { state: "active" }),
];

export const examples_agent_key_rotate = [
  ok("Rotate ledger-agent's key to one kept in the environment", mine(`key rotate ${HANDLE} --key env`), {
    agentId: AGENT_ID,
    handle: HANDLE,
    state: "landed",
    txHash: hash("b8"),
    oldSigner: SIGNER,
    signer: NEW_SIGNER,
    key: { store: "env", privateKey: hash("5c") },
    changeId: `change_${uuid(1054)}`,
    carrier: carrier(1054),
  }),
  refused("The agent is frozen", mine(`key rotate ${HANDLE}`), error_WRONG_STATE, { state: "frozen" }),
  refused("The new key already signs for a Safe", mine(`key rotate ${HANDLE}`), error_INVALID_INPUT, { field: "signer", reason: "already signs" }),
];

export const examples_agent_list = [
  ok("The agents Hannah owns, newest first", mine("list"), { agents: [agent("active", change("create", 1051))] }),
  refused("Signed out", mine("list"), error_NOT_AUTHENTICATED),
];

export const examples_agent_show = [
  ok("Read ledger-agent from the chain", mine(`show ${HANDLE}`), {
    ...agent("active", change("create", 1051)),
    positions: [{ asset: "USDC", token: USDC, decimals: 6, raw: "250000000", amount: "250.00" }],
    seats: [{ orgId: NORTHWIND.orgId, handle: NORTHWIND.slug, name: NORTHWIND.name, permissions: ["payments.read"] }],
  }),
  refused("Priya does not own it (the same refusal as no such agent)", mine("show ledger-agent"), error_ROLE_PERMISSION_DENIED),
  refused("The chain does not answer", mine(`show ${HANDLE}`), error_PROVIDER_ERROR),
];

export const examples_agent_sweep = [
  ok("Sweep ledger-agent's USDC to Hannah", mine(`sweep ${HANDLE}`), {
    agentId: AGENT_ID,
    handle: HANDLE,
    state: "landed",
    txHash: hash("c9"),
    to: ADDRESS.hannah,
    swept: [swept],
    changeId: `change_${uuid(1056)}`,
    carrier: carrier(1056),
  }),
  refused("Its Safe holds none of the asset", mine(`sweep ${HANDLE} --asset USDC`), error_WRONG_STATE, { asset: "USDC" }),
  refused("The recipient does not resolve", mine(`sweep ${HANDLE} --to nobody@northwind.test`), error_INVALID_INPUT, { field: "to" }),
];

export const examples_agent_remove = [
  ok("Remove ledger-agent for good, sweeping its USDC to Hannah", mine(`remove ${HANDLE} --confirm`), {
    agentId: AGENT_ID,
    handle: HANDLE,
    state: "removed",
    txHash: hash("d1"),
    swept: [swept],
    seatsEnded: 0,
    changeId: `change_${uuid(1057)}`,
    carrier: carrier(1057),
  }),
  refused("--confirm is missing outside a terminal", mine(`remove ${HANDLE}`), error_CLI_USAGE),
  refused("It is already removed", mine(`remove ${HANDLE} --confirm`), error_WRONG_STATE, { state: "removed" }),
];
