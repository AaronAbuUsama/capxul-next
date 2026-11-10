// The examples of budgets' operations, kept here so operations.ts stays readable. The story: Northwind's budget tree
// holds two top budgets in USDC per year, Finance (Marcus holds it) and Operations (Priya holds it), under one USDC
// payout ceiling of 200,000 a year; Operations has one allowance, `office-costs`, that Priya wears. Hannah and Tomas
// are the Directors, so a Board proposal needs two approvals. Ids use uuid(100..199), the range reserved to budgets.

import {
  error_AMOUNT_BELOW_USE,
  error_CAPABILITY_UNAVAILABLE,
  error_CHILDREN_EXCEED_PARENT,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, NORTHWIND, PEOPLE, hash, ok, refused, uuid } from "../shared/examples.ts";

const USDC = { symbol: "USDC", address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", decimals: 6 };
const at = (iso: string) => Date.parse(iso);

const FIN = { key: "finance", id: `dep_${uuid(101)}`, budgetId: "1", hat: `0x${"00000001".padEnd(64, "0")}` };
const OPS = { key: "operations", id: `dep_${uuid(102)}`, budgetId: "2", hat: `0x${"00000002".padEnd(64, "0")}` };
const OFFICE_COSTS = { key: "office-costs", id: `allowance_${uuid(103)}`, budgetId: "3", hat: `0x${"00000002".padEnd(16, "0")}${"0001".padEnd(48, "0")}` };

const finance = { email: PEOPLE.marcus.email, safe: ADDRESS.marcus };
const operations = { email: PEOPLE.priya.email, safe: ADDRESS.priya };

const board = (approvals: readonly string[] = [ADDRESS.hannah]) => ({
  proposalId: ID.proposal,
  nonce: "7",
  threshold: { needed: 2, of: 2 },
  approvals,
});

/** What every write answers first: the change, the caller's own approval and, when the Board signs, its proposal. */
const prepared = (n: number, signer: "board" | "office", extra: Record<string, unknown>) => ({
  status: signer === "board" ? "awaiting_approvals" : "awaiting_approval",
  changeId: uuid(110 + n),
  requestKey: `req-${uuid(110 + n).slice(-4)}`,
  signer,
  approvalId: ID.approval,
  approvalUrl: `https://capxul.test/approvals/${ID.approval}`,
  proposal: signer === "board" ? board() : null,
  ...extra,
});

const ceiling = (over: Record<string, unknown> = {}) => ({ token: "USDC", amount: "200000", left: "173000", period: "year", frozen: false, leave: null, ...over });

const line = (b: typeof FIN, over: Record<string, unknown>) => ({
  key: b.key, id: b.id, budgetId: b.budgetId, name: null, kind: "department", status: "active", parent: null, token: USDC, period: "year",
  amount: "0", childrenAmount: "0", spent: "0", committed: "0", left: "0", closed: false, refillsAt: "2027-01-01T00:00:00Z", office: { hat: b.hat, holders: [] },
  offers: 0, runningAgreements: 0, ...over,
});
const financeLine = line(FIN, { name: "Finance", amount: "120000", childrenAmount: "0", spent: "18000", committed: "30000", left: "72000", office: { hat: FIN.hat, holders: [finance] }, offers: 1, runningAgreements: 2 });
const operationsLine = line(OPS, { name: "Operations", amount: "60000", childrenAmount: "6000", spent: "9000", committed: "12000", left: "33000", office: { hat: OPS.hat, holders: [operations] }, offers: 0, runningAgreements: 1 });

const allowanceLine = {
  allowanceId: OFFICE_COSTS.id, key: OFFICE_COSTS.key, name: "Office costs", budgetId: OFFICE_COSTS.budgetId, status: "active", parent: "operations", asset: USDC,
  amount: "6000", period: "year", spent: "1250", committed: "0", left: "4750", refillsAt: "2027-01-01T00:00:00Z", closed: false, hat: OFFICE_COSTS.hat, wearers: [ADDRESS.priya],
};

const outsider = "mallory@brightside.test";

// ── departments ─────────────────────────────────────────────────────────────────────────────

export const departmentCreate = [
  ok(
    "The Board proposes Finance, a yearly budget held by Marcus",
    `capxul org department create Finance --budget 120000/year --token USDC --holder ${PEOPLE.marcus.email} --json`,
    prepared(1, "board", {
      department: { key: "finance", id: FIN.id, name: "Finance", parent: null, token: "USDC", period: "year", amount: "120000", office: { hat: FIN.hat, holders: [finance] } },
      parent: null,
      office: { hat: FIN.hat, period: "year" },
      groups: { office: 1, holders: 1, ceiling: 1, budget: 1 },
    }),
  ),
  refused(
    "A team that asks its parent for more than the parent has left",
    `capxul org department create Training --parent finance --budget 90000/year --holder ${PEOPLE.priya.email} --email ${PEOPLE.marcus.email} --json`,
    error_CHILDREN_EXCEED_PARENT,
    { parent: "finance", requested: "90000", left: "72000" },
  ),
  refused(
    "A member who is not a Director proposes a top budget",
    `capxul org department create Legal --budget 30000/year --holder ${PEOPLE.priya.email} --email ${PEOPLE.priya.email} --json`,
    error_ROLE_PERMISSION_DENIED,
    { needs: "Director" },
  ),
];

export const departmentBudgetSet = [
  ok(
    "Marcus's Finance budget is raised to 150,000 a year, and the ceiling grows with it",
    "capxul org department budget set finance --budget 150000/year --token USDC --json",
    prepared(2, "board", {
      budget: { key: "finance", kind: "department", amount: "150000", previous: "120000", left: "102000" },
      parent: null,
      payoutCeiling: ceiling({ amount: "210000", left: "183000" }),
    }),
  ),
  refused(
    "A budget below what is already used this period",
    "capxul org department budget set finance --budget 40000/year --json",
    error_AMOUNT_BELOW_USE,
    { budget: "finance", used: "48000", asked: "40000" },
  ),
  refused(
    "Not a Director",
    `capxul org department budget set finance --budget 150000/year --email ${PEOPLE.priya.email} --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
];

export const departmentClose = [
  ok(
    "Operations is closed; its running agreement keeps paying",
    "capxul org department close operations --json",
    prepared(3, "board", { department: { key: "operations", closed: true, runningAgreements: 1 }, office: { budgetId: OPS.budgetId, period: "year" } }),
  ),
  refused("The department is already closed", "capxul org department close operations --json", error_WRONG_STATE, { department: "operations", state: "closed" }),
];

export const departmentReopen = [
  ok(
    "Operations is opened again",
    "capxul org department reopen operations --json",
    prepared(4, "board", { department: { key: "operations", closed: false, runningAgreements: 1 }, office: { budgetId: OPS.budgetId, period: "year" } }),
  ),
  refused("The department is not closed", "capxul org department reopen finance --json", error_WRONG_STATE, { department: "finance", state: "open" }),
];

export const departmentHolderAdd = [
  ok(
    "Priya also holds Finance",
    `capxul org department holder add finance ${PEOPLE.priya.email} --json`,
    prepared(5, "board", {
      budget: { key: "finance", kind: "department" },
      office: { hat: FIN.hat, holders: [finance, operations] },
      supply: { before: 1, after: 2 },
      wearers: [ADDRESS.marcus, ADDRESS.priya],
    }),
  ),
  refused("Hannah wears the People hat, which cannot be held with a department", `capxul org department holder add finance ${PEOPLE.hannah.email} --json`, error_ROLE_CONFLICT, {
    person: PEOPLE.hannah.email,
  }),
  refused("Marcus already holds it", `capxul org department holder add finance ${PEOPLE.marcus.email} --json`, error_WRONG_STATE, { person: PEOPLE.marcus.email }),
];

export const departmentHolderRemove = [
  ok(
    "Priya no longer holds Finance",
    `capxul org department holder remove finance ${PEOPLE.priya.email} --json`,
    prepared(6, "board", {
      budget: { key: "finance", kind: "department" },
      office: { hat: FIN.hat, holders: [finance] },
      supply: { before: 2, after: 2 },
      wearers: [ADDRESS.marcus],
    }),
  ),
  refused("Tomas does not hold Finance", `capxul org department holder remove finance ${PEOPLE.tomas.email} --json`, error_WRONG_STATE, { person: PEOPLE.tomas.email }),
];

export const departmentList = [
  ok("Both top budgets, with what each has spent and committed", "capxul org department list --json", { items: [financeLine, operationsLine] }),
  refused("Someone outside the Organization learns nothing", `capxul org department list --email ${outsider} --json`, error_ROLE_PERMISSION_DENIED),
];

export const departmentShow = [
  ok("Operations and the allowance under it, with the ceiling it pays within", "capxul org department show operations --json", {
    trees: [
      {
        token: USDC,
        period: "year",
        payoutCeiling: ceiling(),
        nodes: [
          { ...operationsLine, children: [OFFICE_COSTS.key] },
          { ...allowanceLine, key: OFFICE_COSTS.key, id: OFFICE_COSTS.id, kind: "allowance", token: USDC, childrenAmount: "0", office: { hat: OFFICE_COSTS.hat, holders: [operations] }, offers: 0, runningAgreements: 0, children: [] },
        ],
      },
    ],
  }),
  refused("No budget has that key", "capxul org department show marketing --json", error_INVALID_INPUT, { department: "marketing" }),
];

// ── payout ceilings ─────────────────────────────────────────────────────────────────────────

export const ceilingSet = [
  ok(
    "The USDC ceiling is set to 200,000 a year",
    "capxul org department ceiling set --token USDC --amount 200000/year --json",
    prepared(7, "board", { payoutCeiling: ceiling() }),
  ),
  refused("A ceiling below what the top budgets add up to", "capxul org department ceiling set --token USDC --amount 150000/year --json", error_INVALID_INPUT, { minimum: "180000" }),
  refused("An amount with no period", "capxul org department ceiling set --token USDC --amount 200000 --json", error_CLI_USAGE, { hint: "write the amount as 200000/year" }),
];

export const ceilingFreeze = [
  ok(
    "Payroll payouts in USDC stop, leaving 10,000 to spend",
    "capxul org department ceiling freeze --token USDC --leave 10000 --json",
    prepared(8, "board", { payoutCeiling: ceiling({ left: "10000", frozen: true, leave: "10000" }) }),
  ),
  refused("The token is already frozen", "capxul org department ceiling freeze --token USDC --json", error_WRONG_STATE, { token: "USDC", state: "frozen" }),
  refused("Leaving more than the ceiling has left", "capxul org department ceiling freeze --token USDC --leave 500000 --json", error_INVALID_INPUT, { most: "173000" }),
];

export const ceilingUnfreeze = [
  ok(
    "The freeze ends and the ceiling is restored",
    "capxul org department ceiling unfreeze --token USDC --json",
    prepared(9, "board", { payoutCeiling: ceiling({ left: "163000" }) }),
  ),
  refused("The token is not frozen", "capxul org department ceiling unfreeze --token USDC --json", error_WRONG_STATE, { token: "USDC", state: "not frozen" }),
];

// ── allowances ──────────────────────────────────────────────────────────────────────────────

export const allowanceCreate = [
  ok(
    "The Board proposes office-costs under Operations and gives it to Priya",
    `capxul org allowance create --input office-costs.json --assign-to ${PEOPLE.priya.email} --request-key office-costs-1 --json`,
    prepared(10, "board", {
      requestKey: "office-costs-1",
      allowance: { allowanceId: OFFICE_COSTS.id, key: OFFICE_COSTS.key, name: "Office costs", budgetId: null, hat: OFFICE_COSTS.hat, amount: "6000", period: "year", parent: "operations", wearers: [ADDRESS.priya] },
    }),
  ),
  refused("More than Operations has left to give", "capxul org allowance create --input big-allowance.json --request-key big-1 --json", error_CHILDREN_EXCEED_PARENT, {
    parent: "operations",
    requested: "40000",
    left: "33000",
  }),
  refused("Not a Director", `capxul org allowance create --input office-costs.json --email ${PEOPLE.priya.email} --request-key office-costs-2 --json`, error_ROLE_PERMISSION_DENIED),
  refused("The environment is not provisioned", "capxul org allowance create --input office-costs.json --request-key office-costs-3 --json", error_CAPABILITY_UNAVAILABLE, { environment: "beta" }),
];

export const allowanceChange = [
  ok(
    "office-costs is raised from 6,000 to 9,000 a year",
    `capxul org allowance change ${OFFICE_COSTS.id} --input raise.json --request-key raise-1 --json`,
    prepared(11, "board", {
      requestKey: "raise-1",
      budget: { key: OFFICE_COSTS.key, kind: "allowance", amount: "9000", previous: "6000", left: "7750" },
      parent: { key: "operations", childrenAmount: "9000", left: "30000" },
      payoutCeiling: null,
    }),
  ),
  refused("A new amount below what is already spent", `capxul org allowance change ${OFFICE_COSTS.id} --input shrink.json --request-key shrink-1 --json`, error_AMOUNT_BELOW_USE, {
    used: "1250",
    asked: "1000",
  }),
  refused("Priya cannot raise her own allowance", `capxul org allowance change ${OFFICE_COSTS.id} --input raise.json --email ${PEOPLE.priya.email} --request-key raise-2 --json`, error_ROLE_PERMISSION_DENIED),
];

export const allowanceAssign = [
  ok(
    "Tomas also wears office-costs",
    `capxul org allowance assign ${OFFICE_COSTS.id} --member ${PEOPLE.tomas.email} --request-key assign-1 --json`,
    prepared(12, "board", {
      requestKey: "assign-1",
      budget: { key: OFFICE_COSTS.key, kind: "allowance" },
      office: { hat: OFFICE_COSTS.hat, holders: [operations, { email: PEOPLE.tomas.email, safe: ADDRESS.tomas }] },
      supply: { before: 1, after: 2 },
      wearers: [ADDRESS.priya, ADDRESS.tomas],
    }),
  ),
  refused("Priya already wears it", `capxul org allowance assign ${OFFICE_COSTS.id} --member ${PEOPLE.priya.email} --request-key assign-2 --json`, error_WRONG_STATE, { member: PEOPLE.priya.email }),
  refused("Signed out", `capxul org allowance assign ${OFFICE_COSTS.id} --member ${PEOPLE.tomas.email} --request-key assign-3 --json`, error_NOT_AUTHENTICATED),
];

export const allowanceRevoke = [
  ok(
    "Priya's hold on office-costs is removed",
    `capxul org allowance revoke ${OFFICE_COSTS.id} --member ${PEOPLE.priya.email} --request-key revoke-1 --json`,
    prepared(13, "board", {
      requestKey: "revoke-1",
      budget: { key: OFFICE_COSTS.key, kind: "allowance" },
      office: { hat: OFFICE_COSTS.hat, holders: [] },
      supply: { before: 1, after: 1 },
      wearers: [],
    }),
  ),
  refused("Tomas does not wear it", `capxul org allowance revoke ${OFFICE_COSTS.id} --member ${PEOPLE.tomas.email} --request-key revoke-2 --json`, error_WRONG_STATE, { member: PEOPLE.tomas.email }),
];

export const allowanceList = [
  ok("Northwind's one allowance", "capxul org allowance list --limit 20 --json", { items: [allowanceLine], nextCursor: null }),
  refused("Someone outside the Organization", `capxul org allowance list --email ${outsider} --json`, error_ROLE_PERMISSION_DENIED),
];

export const allowanceGet = [
  ok("office-costs by its id", `capxul org allowance get ${OFFICE_COSTS.id} --json`, allowanceLine),
  refused("An id that names no allowance", `capxul org allowance get allowance_${uuid(199)} --json`, error_INVALID_INPUT, { allowance: `allowance_${uuid(199)}` }),
];

/** Replacing a Roles module is refused on every v4 company; it never succeeds, so it has no success example. */
export const allowanceReplace = [
  refused("Always refused: allowances are budgets and there is no Roles module", "capxul org allowance replace --json", error_FEATURE_NOT_AVAILABLE),
];

// ── invitations ─────────────────────────────────────────────────────────────────────────────

const invitation = (n: number, over: Record<string, unknown>) => ({
  id: uuid(140 + n),
  orgId: NORTHWIND.orgId,
  organizationName: NORTHWIND.name,
  grantee: { partyId: ID.tomas, kind: "human", handle: null, accountId: uuid(150 + n), accountReady: true },
  phase: "pending",
  offers: [],
  offerDigest: hash("d1"),
  recovery: null,
  recoveryActions: { resendAvailableAt: at("2026-02-10T10:30:00Z") },
  expiresAt: at("2026-02-24T09:30:00Z"),
  endingReason: null,
  acceptedAt: null,
  memberId: null,
  delivery: "not_confirmed",
  grants: [],
  commandId: null,
  ...over,
});

export const memberInvite = [
  ok(
    "A Seat with no grants needs no approval and is pending at once",
    `capxul org member invite ${PEOPLE.tomas.email} --request-key invite-tomas-1 --json`,
    invitation(1, {}),
  ),
  ok(
    "An agent is offered a new allowance, which goes to the Directors",
    "capxul org member invite @ledger-agent --agent --new-allowance-name ledger-ops --asset USDC --limit 500 --request-key invite-agent-1 --json",
    invitation(2, {
      grantee: { partyId: ID.agent, kind: "agent", handle: "ledger-agent", accountId: null, accountReady: null },
      phase: "authorizing",
      offers: [{ kind: "new-allowance", name: "ledger-ops", asset: "USDC", limit: "500" }],
      offerDigest: hash("d2"),
      recovery: "board_proposal",
      delivery: "none",
      grants: [`allowance_${uuid(104)}`],
      commandId: uuid(124),
    }),
  ),
  refused(
    "Offering a grant without being a Director",
    `capxul org member invite ${PEOPLE.tomas.email} --new-allowance-name travel --asset USDC --limit 2000 --email ${PEOPLE.priya.email} --request-key invite-tomas-2 --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
  refused("The request key names a different invitation", `capxul org member invite ${PEOPLE.hannah.email} --request-key invite-tomas-1 --json`, error_INVALID_INPUT, {
    requestKey: "invite-tomas-1",
  }),
];
