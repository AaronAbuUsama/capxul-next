// The shapes board's operation examples share: Northwind's Board, its company Safe and a few proposals. Not a record and
// not a module in index.ts. Hannah and Marcus are the Directors; Priya is the member put forward as a third. Ids are
// uuid(n) with n in 250-349.

import { ADDRESS, CHAIN_ID, ID, NORTHWIND, PEOPLE, hash, uuid } from "../shared/examples.ts";

export const ORG = NORTHWIND.orgId;
const SAFE = ADDRESS.northwind;
const lc = (a: string) => a.toLowerCase();

export const CHANGE_ID = "dc_0250";
export const APPROVAL_ID = uuid(251);
export const APPROVAL_URL = `https://app.northwind.test/approvals/${APPROVAL_ID}`;
export const PROPOSAL = { waiting: uuid(260), second: uuid(261), executed: uuid(262), rejection: uuid(263) } as const;

const T = (iso: string) => Date.parse(iso);

export const hannah = { name: PEOPLE.hannah.name, email: PEOPLE.hannah.email, safe: ADDRESS.hannah };
export const marcus = { name: PEOPLE.marcus.name, email: PEOPLE.marcus.email, safe: ADDRESS.marcus };
export const priya = { name: PEOPLE.priya.name, email: PEOPLE.priya.email, safe: ADDRESS.priya };

/** A Board change as every Board write answers it, with `--no-wait` unless the fields say otherwise. */
export const boardChange = (over: Record<string, unknown>) => ({
  changeId: CHANGE_ID,
  orgId: ORG,
  action: "seat",
  status: "awaiting_approval",
  person: null,
  removed: [],
  seat: null,
  directors: 2,
  threshold: { needed: 2, of: 2 },
  before: { needed: 2, of: 2 },
  approvalId: APPROVAL_ID,
  url: APPROVAL_URL,
  outcome: null,
  ...over,
});

/** A Board proposal as the proposal reads answer it. */
export const proposal = (over: Record<string, unknown> = {}) => ({
  proposalId: PROPOSAL.waiting,
  orgId: ORG,
  chainId: CHAIN_ID,
  safeAddress: SAFE,
  nonce: 7,
  safeTxHash: hash("5e"),
  kind: "transaction",
  rejects: null,
  transaction: { to: lc(ADDRESS.brightside), value: "0", data: "0x", operation: "call" },
  calls: [{ to: lc(ADDRESS.brightside), value: "0", data: "0x" }],
  note: "Pay Brightside Cleaning for January",
  proposer: ADDRESS.hannah,
  status: "awaiting_approvals",
  threshold: 2,
  approvals: [{ owner: ADDRESS.hannah, label: PEOPLE.hannah.name, state: "approved" }],
  executionUserOpHash: null,
  createdAt: T("2026-02-09T14:00:00Z"),
  ...over,
});

/** An owner change (`org director add|remove|replace|threshold`): a proposal and what it would change. */
export const ownerChange = (change: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  ...proposal({ note: null, ...over }),
  change,
});

/** What `org proposal approve` answers: the caller's approval, opened. */
export const approvalOpened = {
  proposalId: PROPOSAL.waiting,
  step: "approve",
  approvalId: APPROVAL_ID,
  url: APPROVAL_URL,
  kind: "safe_proposal",
  state: "pending",
  actor: { orgId: ORG, name: NORTHWIND.name },
  summary: {
    title: "Approve a Northwind proposal",
    from: { label: PEOPLE.marcus.name, address: lc(ADDRESS.marcus) },
    to: { label: NORTHWIND.name },
    amount: null,
    recipients: [],
    warnings: [],
  },
  operation: null,
  signer: { address: lc(ADDRESS.marcus) },
  expiresAt: T("2026-02-10T10:30:00Z"),
  createdAt: T("2026-02-10T09:30:00Z"),
  reviewedAt: null,
  decidedAt: null,
  consumedAt: null,
};

export { ID };
