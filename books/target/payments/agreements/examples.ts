// The examples of the payroll agreement operations: Northwind's Finance department offers Priya Raman a salary of
// 4000 USDC a month. Not a record and not a module in index.ts: operations.ts imports the lists. Ids 700 to 799.

import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_BUDGETED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../../shared/vocabulary.ts";
import { ADDRESS, CHAIN_ID, ID, NORTHWIND, PEOPLE, hash, ok, refused, uuid } from "../../shared/examples.ts";

const AG = "ag_01JKMZ4R7Q3XV8N5T2C6H9B0DF";
const APPROVAL = `approval_${uuid(701)}`;
const TERMS = hash("e1");
const DEPT = { budgetId: ID.financeBudget, key: "finance", name: "Finance" };
const RATE = { amount: "4000.00", per: "month" } as const;
const WAIT = ["capxul", "payment", "wait", APPROVAL, "--json"];

/** The agreement as the offer, the payee and the department see it, active by default. */
const agreement = (over: Record<string, unknown> = {}) => ({
  agreementId: AG,
  orgId: NORTHWIND.orgId,
  department: DEPT,
  kind: "salary",
  status: "active",
  payer: { orgId: NORTHWIND.orgId, name: NORTHWIND.name, safe: ADDRESS.northwind },
  payee: { kind: "person", safe: ADDRESS.priya, label: PEOPLE.priya.name, email: PEOPLE.priya.email, handle: null },
  offeredBy: { safe: ADDRESS.marcus, label: PEOPLE.marcus.name },
  token: "USDC",
  rate: RATE,
  release: "1mo",
  startsAt: "2026-02-01T00:00:00Z",
  endsAt: null,
  offerExpiresAt: "2026-02-15T00:00:00Z",
  acceptedAt: "2026-02-03T10:15:00Z",
  pausedAt: null,
  pendingChange: null,
  terms: { documentId: uuid(702), hash: TERMS },
  earned: "4000.00",
  collectable: "4000.00",
  collected: "0.00",
  nextReleaseAt: "2026-03-01T00:00:00Z",
  chainId: String(CHAIN_ID),
  ...over,
});

const department = (change?: { adds: string; frees: string; at: string | null }) => ({
  ...DEPT,
  token: "USDC",
  budget: "100000.00",
  committed: "48000.00",
  left: "52000.00",
  ...(change ? { change } : {}),
});

/** What a write by a department holder prints: where it stands, its approval, the agreement and the department. */
const write = (status: string, ag: Record<string, unknown>, change?: { adds: string; frees: string; at: string | null }, next: string[] | null = null) => ({
  status,
  approvalId: APPROVAL,
  agreement: ag,
  department: department(change),
  next,
});

const row = (over: Record<string, unknown> = {}) => ({
  agreementId: AG,
  department: "finance",
  payer: NORTHWIND.name,
  payee: PEOPLE.priya.name,
  kind: "salary",
  token: "USDC",
  rate: RATE,
  yearlyRate: "48000.00",
  status: "active",
  offeredBy: PEOPLE.marcus.name,
  earned: "4000.00",
  collectable: "4000.00",
  collected: "0.00",
  nextReleaseAt: "2026-03-01T00:00:00Z",
  next: ["capxul", "payroll", "agreement", "collect", AG, "--json"],
  ...over,
});

const offered = agreement({ status: "offered", acceptedAt: null, earned: null, collectable: null, collected: null, nextReleaseAt: null });
const H = "--org northwind --json";

export const examples_agreement_accept = [
  ok("Priya accepts the offer, pinning the terms hash she read", `capxul payroll agreement accept ${AG} --terms-hash ${TERMS} --json`, {
    status: "active",
    approvalId: APPROVAL,
    agreement: agreement({ earned: null, collectable: null, collected: null }),
    next: null,
  }),
  ok("With --no-wait it returns the approval at once", `capxul payroll agreement accept ${AG} --no-wait --json`, {
    status: "awaiting_approval",
    approvalId: APPROVAL,
    agreement: offered,
    next: WAIT,
  }),
  refused("The pinned terms hash is not the offer's", `capxul payroll agreement accept ${AG} --terms-hash ${hash("ff")} --json`, error_INVALID_INPUT),
  refused("The offer lapsed", `capxul payroll agreement accept ${AG} --json`, error_WRONG_STATE),
  refused("Marcus is not the payee", `capxul payroll agreement accept ${AG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const examples_agreement_collect = [
  ok("Priya collects January's pay: one payment from Northwind, settled", `capxul payroll agreement collect ${AG} --json`, {
    status: "settled",
    collected: "4000.00",
    payment: {
      paymentId: hash("71"),
      amount: "4000.00",
      token: "USDC",
      from: ADDRESS.northwind,
      to: ADDRESS.priya,
      txHash: hash("c7"),
      periodStart: "2026-02-01T00:00:00Z",
      periodEnd: "2026-03-01T00:00:00Z",
    },
    agreement: agreement({ collectable: "0.00", collected: "4000.00" }),
    nextReleaseAt: "2026-04-01T00:00:00Z",
  }),
  ok("Nothing is released yet: nothing is signed", `capxul payroll agreement collect ${AG} --json`, {
    status: "nothing_released",
    collected: "0.00",
    payment: null,
    agreement: agreement({ earned: "0.00", collectable: "0.00" }),
    nextReleaseAt: "2026-03-01T00:00:00Z",
  }),
  ok("With --no-wait the approval comes back at once", `capxul payroll agreement collect ${AG} --no-wait --json`, {
    status: "awaiting_approval",
    collected: "0.00",
    payment: null,
    agreement: agreement(),
    nextReleaseAt: "2026-03-01T00:00:00Z",
  }),
  refused("Northwind's Safe holds less than the collection", `capxul payroll agreement collect ${AG} --json`, error_PAYER_BALANCE_TOO_LOW),
  refused("The offer was never accepted", `capxul payroll agreement collect ${AG} --json`, error_WRONG_STATE),
  refused("Hannah is not the payee", `capxul payroll agreement collect ${AG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const examples_agreement_list = [
  ok("The agreements that pay Priya", "capxul payroll agreement list --json", { items: [row()] }),
  ok("Only the offers still open", "capxul payroll agreement list --status offered --json", {
    items: [row({ status: "offered", earned: null, collectable: null, collected: null, nextReleaseAt: null, next: ["capxul", "payroll", "agreement", "accept", AG, "--json"] })],
  }),
  refused("A status that is not one of the nine", "capxul payroll agreement list --status maybe --json", error_INVALID_INPUT),
  refused("Not signed in", "capxul payroll agreement list --json", error_NOT_AUTHENTICATED),
  refused("The chain does not answer", "capxul payroll agreement list --json", error_PROVIDER_ERROR),
];

export const examples_agreement_show = [
  ok("Priya reads the terms before she accepts", `capxul payroll agreement show ${AG} --json`, {
    payer: { orgId: NORTHWIND.orgId, name: NORTHWIND.name, safe: ADDRESS.northwind, department: DEPT },
    kind: "salary",
    status: "offered",
    rate: RATE,
    release: "1mo",
    terms: { documentId: uuid(702), hash: TERMS },
    earned: null,
    collectable: null,
    collected: null,
    nextReleaseAt: null,
  }),
  refused("No agreement has that ID", "capxul payroll agreement show ag_00000000000000000000000000 --json", error_INVALID_INPUT),
  refused("Tomas is not the agreement's payee", `capxul payroll agreement show ${AG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const examples_org_agreement_offer = [
  ok("Marcus offers Priya a salary from Finance", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month --start 2026-02-01 ${H}`, write("offered", offered, { adds: "48000.00", frees: "0.00", at: null })),
  ok(
    "With --no-wait the approval comes back at once",
    `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month --no-wait ${H}`,
    write("awaiting_approval", agreement({ status: "prepared", acceptedAt: null, earned: null, collectable: null, collected: null, nextReleaseAt: null }), undefined, WAIT),
  ),
  refused("The offer needs more than Finance has left", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 90000.00/month ${H}`, error_PAYROLL_BUDGET_EXCEEDED),
  refused("Finance has no budget in that token", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month --token EURC ${H}`, error_TOKEN_NOT_BUDGETED),
  refused("Capxul does not admit the token", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month --token XYZ ${H}`, error_TOKEN_NOT_SUPPORTED),
  refused("The department is unknown", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department legal --salary 4000.00/month ${H}`, error_INVALID_INPUT),
  refused("Priya holds no department", `capxul org payroll agreement offer ${PEOPLE.tomas.email} --department finance --salary 4000.00/month ${H}`, error_ROLE_PERMISSION_DENIED),
  refused("Payment agreements are off", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month ${H}`, error_FEATURE_NOT_AVAILABLE),
  refused("The department's budget is closed", `capxul org payroll agreement offer ${PEOPLE.priya.email} --department finance --salary 4000.00/month ${H}`, error_WRONG_STATE),
];

export const examples_org_agreement_change = [
  ok(
    "A raise to 4500 a month takes effect now",
    `capxul org payroll agreement change ${AG} --salary 4500.00/month ${H}`,
    write("active", agreement({ rate: { amount: "4500.00", per: "month" } }), { adds: "6000.00", frees: "0.00", at: null }),
  ),
  ok(
    "A lowering takes effect from a date",
    `capxul org payroll agreement change ${AG} --salary 3500.00/month --from 2026-04-01 ${H}`,
    write("active", agreement({ pendingChange: { rate: { amount: "3500.00", per: "month" }, effectiveAt: "2026-04-01T00:00:00Z" } }), { adds: "0.00", frees: "6000.00", at: "2026-04-01T00:00:00Z" }),
  ),
  refused("The raise needs more than Finance has left", `capxul org payroll agreement change ${AG} --salary 90000.00/month ${H}`, error_PAYROLL_BUDGET_EXCEEDED),
  refused("A lowering already waits", `capxul org payroll agreement change ${AG} --salary 3000.00/month --from 2026-05-01 ${H}`, error_WRONG_STATE),
  refused("The rate is the one it has", `capxul org payroll agreement change ${AG} --salary 4000.00/month ${H}`, error_INVALID_INPUT),
  refused("Priya does not hold the department", `capxul org payroll agreement change ${AG} --salary 4500.00/month ${H}`, error_ROLE_PERMISSION_DENIED),
];

export const examples_org_agreement_end = [
  ok(
    "Set the last day an accepted agreement pays",
    `capxul org payroll agreement end ${AG} --on 2026-06-30 ${H}`,
    write("ending", agreement({ status: "ending", endsAt: "2026-07-01T00:00:00Z" }), { adds: "0.00", frees: "24000.00", at: "2026-07-01T00:00:00Z" }),
  ),
  refused("The date is on or after the end already set", `capxul org payroll agreement end ${AG} --on 2026-09-30 ${H}`, error_WRONG_STATE),
  refused("A last day before today", `capxul org payroll agreement end ${AG} --on 2026-01-01 ${H}`, error_INVALID_INPUT),
  refused("Priya does not hold the department", `capxul org payroll agreement end ${AG} --on 2026-06-30 ${H}`, error_ROLE_PERMISSION_DENIED),
  refused("Payment agreements are off", `capxul org payroll agreement end ${AG} --on 2026-06-30 ${H}`, error_FEATURE_NOT_AVAILABLE),
];

export const examples_org_agreement_list = [
  ok("Northwind's agreements with each department's budget", `capxul org payroll agreement list ${H}`, { items: [row()], departments: [department()] }),
  ok("Only Finance's, and only the offers", `capxul org payroll agreement list --department finance --status offered ${H}`, {
    items: [row({ status: "offered", earned: null, collectable: null, collected: null, nextReleaseAt: null })],
    departments: [department()],
  }),
  refused("The department does not exist", `capxul org payroll agreement list --department legal ${H}`, error_INVALID_INPUT),
  refused("Not a member of the Organization", `capxul org payroll agreement list ${H}`, error_ROLE_PERMISSION_DENIED),
  refused("The chain cannot be read", `capxul org payroll agreement list ${H}`, error_PROVIDER_ERROR),
];

export const examples_org_agreement_pause = [
  ok("Pause for unpaid leave", `capxul org payroll agreement pause ${AG} ${H}`, write("paused", agreement({ status: "paused", pausedAt: "2026-02-10T09:30:00Z" }))),
  refused("Already paused", `capxul org payroll agreement pause ${AG} ${H}`, error_WRONG_STATE),
  refused("The Organization has no such agreement", "capxul org payroll agreement pause ag_00000000000000000000000000 --org northwind --json", error_INVALID_INPUT),
  refused("Priya does not hold the department", `capxul org payroll agreement pause ${AG} ${H}`, error_ROLE_PERMISSION_DENIED),
];

export const examples_org_agreement_resume = [
  ok("Resume after the leave", `capxul org payroll agreement resume ${AG} ${H}`, write("active", agreement())),
  refused("The agreement is not paused", `capxul org payroll agreement resume ${AG} ${H}`, error_WRONG_STATE),
  refused("The Organization has no such agreement", "capxul org payroll agreement resume ag_00000000000000000000000000 --org northwind --json", error_INVALID_INPUT),
  refused("Priya does not hold the department", `capxul org payroll agreement resume ${AG} ${H}`, error_ROLE_PERMISSION_DENIED),
];

export const examples_org_agreement_withdraw = [
  ok("Take back an offer Priya has not accepted", `capxul org payroll agreement withdraw ${AG} ${H}`, write("withdrawn", { ...offered, status: "withdrawn" }, { adds: "0.00", frees: "48000.00", at: null })),
  refused("The payee already accepted it", `capxul org payroll agreement withdraw ${AG} ${H}`, error_WRONG_STATE),
  refused("The Organization has no such agreement", "capxul org payroll agreement withdraw ag_00000000000000000000000000 --org northwind --json", error_INVALID_INPUT),
  refused("The payee holds no department", `capxul org payroll agreement withdraw ${AG} ${H}`, error_ROLE_PERMISSION_DENIED),
];
