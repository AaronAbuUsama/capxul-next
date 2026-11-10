// The examples of the organizations operations, one story: Northwind Trading is created, Hannah invites Tomas, Marcus
// reads his standing. Ids 400 to 499 are this concept's (blueprint/shared/examples.ts holds the cast).
//
// `org create` takes a two-letter `--country`; "NL" is used as a neutral value (the record requires one).

import {
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, NORTHWIND, PEOPLE, hash, ok, refused, uuid } from "../shared/examples.ts";

const t = (iso: string) => Date.parse(iso);
const ORG = NORTHWIND.orgId;
const ORG_FLAG = `--org ${NORTHWIND.slug}`;

const MEMBER = { hannah: uuid(420), marcus: uuid(421), priya: uuid(422) } as const;
const ACCOUNT = { hannah: uuid(410), marcus: uuid(411), priya: uuid(412), tomas: uuid(413) } as const;
const INVITATION = uuid(430);
const MARCUS_SAFE = "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec";

const SETUP_READY = {
  orgId: ORG,
  safe: ADDRESS.northwind,
  setup: "ready",
  steps: ["safe_minted", "money_deployed", "installed"],
  issue: null,
  recovery: "none",
  approvalId: null,
  checkedAt: t("2026-01-12T09:05:00Z"),
  board: { directors: 2, threshold: 2, nonce: 0, waitingProposals: 0 },
  fde: null,
};

const SETUP_AWAITING = {
  orgId: ORG,
  safe: ADDRESS.northwind,
  setup: "awaiting_authorization",
  steps: ["safe_minted", "money_deployed"],
  issue: null,
  recovery: "authorize",
  approvalId: ID.approval,
  checkedAt: t("2026-01-12T09:02:00Z"),
  board: null,
  fde: null,
};

const invitation = (phase: string, extra: Record<string, unknown> = {}) => ({
  id: INVITATION,
  orgId: ORG,
  organizationName: NORTHWIND.name,
  grantee: { partyId: ID.tomas, kind: "human", handle: null, accountId: null, accountReady: false },
  phase,
  offers: [{ kind: "officer", hat: "people" }],
  offerDigest: hash("e5"),
  recovery: null,
  recoveryActions: { resendAvailableAt: t("2026-02-10T09:31:00Z") },
  expiresAt: t("2026-02-24T09:30:00Z"),
  endingReason: null,
  acceptedAt: null,
  memberId: null,
  delivery: "sent",
  ...extra,
});

const member = (who: "hannah" | "marcus" | "priya", role: string, permissions: string[], safe: string) => ({
  memberId: MEMBER[who],
  email: PEOPLE[who].email,
  name: PEOPLE[who].name,
  accountId: ACCOUNT[who],
  personalSafeAddress: safe,
  role,
  status: "active",
  kind: "human",
  permissions,
});

const hannah = member("hannah", "Director", ["manage-books", "issue-invoices", "manage-people"], ADDRESS.hannah);
const marcus = member("marcus", "Member", ["manage-books"], MARCUS_SAFE);
const priya = member("priya", "Member", [], ADDRESS.priya);

export const orgCreate = [
  ok(
    "Create Northwind and follow its setup to ready",
    `capxul org create --name "Northwind Trading" --handle northwind --country NL --confirm --json`,
    { organizationId: ORG, lifecycle: SETUP_READY },
  ),
  refused(
    "A script run without --confirm",
    `capxul org create --name "Northwind Trading" --handle northwind --country NL --json`,
    error_CLI_USAGE,
  ),
  refused(
    "The handle is already taken",
    `capxul org create --name "Northwind Traders" --handle northwind --country NL --confirm --json`,
    error_INVALID_INPUT,
  ),
  refused(
    "Still on the beta waitlist",
    `capxul org create --name "Northwind Trading" --handle northwind --country NL --confirm --json`,
    error_FEATURE_NOT_AVAILABLE,
  ),
];

export const orgList = [
  ok("List the organizations Hannah can act in", "capxul org list --json", {
    items: [
      {
        id: ORG,
        name: NORTHWIND.name,
        handle: NORTHWIND.slug,
        account: ADDRESS.northwind,
        setup: "ready",
        member: { memberId: MEMBER.hannah, kind: "human" },
        capabilities: { managePeople: true, spend: true, director: true, approvalsNeeded: 2 },
        founderEmail: PEOPLE.hannah.email,
      },
    ],
    nextCursor: null,
    unfinishedSetups: [],
  }),
  refused("A page size out of range", "capxul org list --limit 500 --json", error_CLI_USAGE),
  refused("Signed out", "capxul org list --json", error_NOT_AUTHENTICATED),
];

export const orgMe = [
  ok("Marcus checks what he may do in Northwind", `capxul org me ${ORG_FLAG} --email ${PEOPLE.marcus.email} --json`, {
    member: { memberId: MEMBER.marcus, accountId: ACCOUNT.marcus, kind: "human", safe: MARCUS_SAFE },
    role: "Member",
    capabilities: { managePeople: false, spend: true, director: false, approvalsNeeded: 2 },
    budgets: [{ budgetId: ID.financeBudget, label: "Finance", token: "USDC", perPaymentCap: "5000.00" }],
  }),
  refused("Someone whose Seat was removed", `capxul org me ${ORG_FLAG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const orgRetry = [
  ok("Resume a setup that stopped, now ready", `capxul org retry --org ${ORG} --confirm --json`, {
    organizationId: ORG,
    lifecycle: SETUP_READY,
  }),
  refused("No Organization named", "capxul org retry --confirm --json", error_CLI_USAGE),
  refused("The setup failed for good", `capxul org retry --org ${ORG} --confirm --json`, error_WRONG_STATE),
];

export const orgShow = [
  ok("Read Northwind's setup once it is ready", `capxul org show ${ORG_FLAG} --json`, SETUP_READY),
  ok("Read a setup that waits for the founder's signature", `capxul org show ${ORG_FLAG} --json`, SETUP_AWAITING),
  refused("A session that cannot reach the Organization", `capxul org show ${ORG_FLAG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const orgWait = [
  ok("Follow setup until it is ready", `capxul org wait ${ORG_FLAG} --timeout-seconds 120 --json`, {
    status: "ready",
    recovery: "none",
    setup: SETUP_READY,
  }),
  refused("The deadline passed before setup finished", `capxul org wait ${ORG_FLAG} --timeout-seconds 5 --json`, error_CLI_DEADLINE),
];

export const useOrg = [
  ok("Act for Northwind from now on", "capxul use org northwind --json", {
    actingAs: { kind: "organization", handle: NORTHWIND.slug, orgId: ORG },
  }),
  refused("Not a member of that Organization", "capxul use org globex --json", error_CLI_USAGE),
  refused("Signed out", "capxul use org northwind --json", error_NOT_AUTHENTICATED),
];

export const orgSeatsShow = [
  ok("Northwind's Seats", `capxul org seats show ${ORG_FLAG} --json`, {
    orgId: ORG,
    seatLimit: 10,
    seatsUsed: 3,
    offersReserved: 1,
    ownAgent: false,
    seatsBought: 0,
    raisedBy: null,
    raisedAt: null,
    price: { amount: "25.00", asset: "USDC" },
  }),
  refused("Signed out", `capxul org seats show ${ORG_FLAG} --json`, error_NOT_AUTHENTICATED),
  refused("An Organization the caller is no member of", "capxul org seats show --org globex --json", error_ROLE_PERMISSION_DENIED),
];

export const orgMemberList = [
  ok("List Northwind's members", `capxul org member list ${ORG_FLAG} --json`, {
    items: [hannah, marcus, priya],
    nextCursor: null,
  }),
  refused("Not a current member", `capxul org member list ${ORG_FLAG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const orgMemberGet = [
  ok("Show Priya by her Account ID", `capxul org member get ${ACCOUNT.priya} ${ORG_FLAG} --json`, priya),
  refused(
    "No member has that Account ID",
    `capxul org member get ${uuid(499)} ${ORG_FLAG} --json`,
    error_INVALID_INPUT,
  ),
  refused("Not a current member", `capxul org member get ${ACCOUNT.priya} ${ORG_FLAG} --json`, error_ROLE_PERMISSION_DENIED),
];

export const inviteList = [
  ok("Tomas lists the invitations sent to him", `capxul invite list --email ${PEOPLE.tomas.email} --json`, {
    items: [invitation("pending")],
    nextCursor: null,
    observedAt: t("2026-02-10T09:35:00Z"),
  }),
  refused("A page size out of range", "capxul invite list --limit 500 --json", error_INVALID_INPUT),
];

export const inviteDecline = [
  ok(
    "Tomas declines a Seat-only offer",
    `capxul invite decline ${INVITATION} --email ${PEOPLE.tomas.email} --confirm --json`,
    invitation("declined", { endingReason: "declined" }),
  ),
  refused(
    "The offer was already accepted",
    `capxul invite decline ${INVITATION} --email ${PEOPLE.tomas.email} --confirm --json`,
    error_WRONG_STATE,
  ),
  refused(
    "Not the person the offer was sent to",
    `capxul invite decline ${INVITATION} --email ${PEOPLE.priya.email} --confirm --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
];

export const orgInviteList = [
  ok("List the offers Northwind has pending", `capxul org invite list ${ORG_FLAG} --phase pending --json`, {
    items: [invitation("pending")],
    nextCursor: null,
    observedAt: t("2026-02-10T09:35:00Z"),
  }),
  refused(
    "Priya cannot manage people",
    `capxul org invite list ${ORG_FLAG} --email ${PEOPLE.priya.email} --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
  refused("A page size out of range", `capxul org invite list ${ORG_FLAG} --limit 500 --json`, error_INVALID_INPUT),
];

export const orgInviteCancel = [
  ok(
    "Hannah cancels the offer to Tomas",
    `capxul org invite cancel ${INVITATION} ${ORG_FLAG} --confirm --json`,
    invitation("cancelled", { endingReason: "cancelled" }),
  ),
  refused(
    "Priya cannot manage people",
    `capxul org invite cancel ${INVITATION} ${ORG_FLAG} --email ${PEOPLE.priya.email} --confirm --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
  refused("The offer was already accepted", `capxul org invite cancel ${INVITATION} ${ORG_FLAG} --confirm --json`, error_WRONG_STATE),
  refused("The approval was declined", `capxul org invite cancel ${INVITATION} ${ORG_FLAG} --confirm --json`, error_CANCELLED),
];

export const orgInviteResend = [
  ok(
    "Hannah resends the offer to Tomas",
    `capxul org invite resend ${INVITATION} ${ORG_FLAG} --confirm --json`,
    invitation("pending", { recoveryActions: { resendAvailableAt: t("2026-02-10T09:36:00Z") } }),
  ),
  refused("The last delivery was under a minute ago", `capxul org invite resend ${INVITATION} ${ORG_FLAG} --confirm --json`, error_RATE_LIMITED),
  refused("The offer has expired", `capxul org invite resend ${INVITATION} ${ORG_FLAG} --confirm --json`, error_WRONG_STATE),
];
