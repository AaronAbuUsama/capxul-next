// The examples of the plugs operations: Marcus prepares the payment for Brightside's invoice, Hannah looks after
// the site's roles and event stream. Ids 550 to 599 are this concept's. Flags follow the operations' own text:
// `--doctype`, `--name`, `--hash`, `--to`, `--amount`, `--for`, `--map`, `--from`, and `<seq>`.

import {
  error_AUTHORISED_EXCEEDED,
  error_DOCUMENT_HASH_MISMATCH,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, hash, ok, refused, uuid } from "../shared/examples.ts";

const t = (iso: string) => Date.parse(iso);
const DOC_HASH = hash("a1");
const REQUEST_ID = uuid(550);

const PREPARE = `capxul payment prepare-document --doctype "Payment Entry" --name ACC-PAY-2026-00001 --hash ${DOC_HASH} --to ${ADDRESS.brightside} --amount 125.50`;

export const paymentPrepareDocument = [
  ok("Marcus prepares the payment for Brightside's invoice", `${PREPARE} --json`, {
    request_id: REQUEST_ID,
    approval_id: ID.approval,
    awaiting: ADDRESS.marcus,
    awaiting_name: "Marcus Lindqvist",
    approval_url: `https://app.capxul.test/approvals/${ID.approval}`,
  }),
  refused("Priya wears no hat that may pay from the budget", `${PREPARE} --json`, error_ROLE_PERMISSION_DENIED),
  refused(
    "The amount is more than the budget has left this period",
    `${PREPARE.replace("--amount 125.50", "--amount 90000")} --json`,
    error_AUTHORISED_EXCEEDED,
  ),
  refused("The draft changed after it was prepared", `${PREPARE.replace(DOC_HASH, hash("b2"))} --json`, error_DOCUMENT_HASH_MISMATCH),
  refused("The zero hash", `${PREPARE.replace(DOC_HASH, hash("00"))} --json`, error_INVALID_INPUT),
];

export const paymentAwaiting = [
  ok("What is waiting for Marcus to sign", "capxul payment awaiting --json", {
    requests: [
      {
        requestId: REQUEST_ID,
        doctype: "Payment Entry",
        docname: "ACC-PAY-2026-00001",
        documentHash: DOC_HASH,
        status: "waiting",
        awaiting: ADDRESS.marcus,
        awaitingName: "Marcus Lindqvist",
        requestedBy: ADDRESS.marcus,
        toParty: ADDRESS.brightside,
        amount: "125.50",
        asset: "USDC",
        costCentre: "Main",
        accountCode: "5200",
        approvalId: ID.approval,
        failureReason: null,
        txHash: null,
        createdAt: t("2026-02-10T09:30:00Z"),
      },
    ],
  }),
  refused("Priya asks for Marcus's list", `capxul payment awaiting --for ${ADDRESS.marcus} --json`, error_ROLE_PERMISSION_DENIED),
  refused("Signed out", "capxul payment awaiting --json", error_NOT_AUTHENTICATED),
];

export const orgRolesShow = [
  ok("The hat-to-role map the site shipped with", "capxul org roles show --map --json", {
    person: ADDRESS.marcus,
    roles: ["Accounts User", "Purchase User"],
    grants: 2,
    map: {
      mapVersion: "2026.1",
      rows: [
        { hat: "books", job: "Bookkeeper", role: "Accounts User", scope: "organization" },
        { hat: "budget", job: "Budget holder", role: "Purchase User", scope: "department" },
      ],
    },
  }),
  ok("Marcus's own roles, without the map", "capxul org roles show --json", {
    person: ADDRESS.marcus,
    roles: ["Accounts User", "Purchase User"],
    grants: 2,
    map: null,
  }),
  refused("Signed out", "capxul org roles show --json", error_NOT_AUTHENTICATED),
];

export const orgRolesDrift = [
  ok("Hannah checks the site's roles against the chain: one extra role", "capxul org roles drift --org northwind --json", {
    checkedAt: t("2026-02-10T09:30:00Z"),
    differences: [{ person: ADDRESS.priya, kind: "extra-role", detail: "Priya Raman has Accounts Manager, which no hat gives." }],
  }),
  ok("No difference", "capxul org roles drift --org northwind --json", { checkedAt: t("2026-02-10T09:30:00Z"), differences: [] }),
  refused("Priya does not wear the Director hat", "capxul org roles drift --org northwind --json", error_ROLE_PERMISSION_DENIED),
  refused("The site's bench is stopped", "capxul org roles drift --org northwind --json", error_PROVIDER_ERROR),
];

export const orgEventsStatus = [
  ok("The event stream is flowing, with one event set aside earlier and applied", "capxul org events status --org northwind --json", {
    nextSeq: 4,
    lastAppliedSeq: 3,
    state: "flowing",
    blockedSeq: null,
    counts: { pending: 0, applied: 3, set_aside: 0, unmatched: 0 },
    events: [
      { seq: 1, eventKey: "org_created:northwind", kind: "org_created", status: "applied", attempts: 1, lastError: null, money: false, createdAt: t("2026-01-12T09:00:00Z"), appliedAt: t("2026-01-12T09:06:00Z") },
      { seq: 2, eventKey: "hat_granted:marcus:budget", kind: "hat_granted", status: "applied", attempts: 1, lastError: null, money: false, createdAt: t("2026-01-15T10:00:00Z"), appliedAt: t("2026-01-15T10:00:05Z") },
      { seq: 3, eventKey: "payment_sent:brightside:1", kind: "payment_sent", status: "applied", attempts: 2, lastError: null, money: true, createdAt: t("2026-02-03T10:00:00Z"), appliedAt: t("2026-02-03T10:00:30Z") },
    ],
  }),
  ok("A blocked stream: one event set aside", "capxul org events status --org northwind --json", {
    nextSeq: 5,
    lastAppliedSeq: 2,
    state: "blocked",
    blockedSeq: 3,
    counts: { pending: 1, applied: 2, set_aside: 1, unmatched: 0 },
    events: [
      { seq: 3, eventKey: "hat_granted:tomas:payroll", kind: "hat_granted", status: "set_aside", attempts: 5, lastError: "No Frappe user for tomas.varga@northwind.test.", money: false, createdAt: t("2026-02-09T08:00:00Z"), appliedAt: null },
    ],
  }),
  refused("Signed out", "capxul org events status --org northwind --json", error_NOT_AUTHENTICATED),
];

export const orgEventsResend = [
  ok("Resend every event from the start, after the site was restored", "capxul org events resend --from 1 --org northwind --json", { from: 1, nextSeq: 4 }),
  refused("--from is beyond the next number", "capxul org events resend --from 99 --org northwind --json", error_INVALID_INPUT),
  refused("Priya does not wear the Director hat", "capxul org events resend --from 1 --org northwind --json", error_ROLE_PERMISSION_DENIED),
];

export const orgEventsRetry = [
  ok("Release the set-aside event so it is tried again", "capxul org events retry 3 --org northwind --json", { seq: 3, status: "pending" }),
  refused("The event is not set aside", "capxul org events retry 2 --org northwind --json", error_WRONG_STATE),
  refused("Priya does not wear the Director hat", "capxul org events retry 3 --org northwind --json", error_ROLE_PERMISSION_DENIED),
];

export const orgSiteLink = [
  ok("A viewer asks for a one-time read-only link", "capxul org site link --org northwind --json", {
    url: "https://northwind-town.sites.capxul.test/app?link=one-time-token",
    expiresAt: t("2026-02-10T09:40:00Z"),
    readOnly: true,
  }),
  refused("Neither a viewer grant nor a site user", "capxul org site link --org northwind --json", error_ROLE_PERMISSION_DENIED),
  refused("The site's bench is stopped", "capxul org site link --org northwind --json", error_PROVIDER_ERROR),
];
