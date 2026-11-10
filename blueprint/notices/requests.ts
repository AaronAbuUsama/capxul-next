// The requests area: an Invoice's emails (old receivables' notices). Requests sends no mail
// (requests.telemetry); notices follows `request_transitioned`. As before, only an Invoice is
// announced, and only a payer who cannot see it in an inbox is told it was issued: an Organization
// (through its Directors, who can pay it) or a customer not on Capxul paying into the invoice escrow.
// A person on Capxul finds it in `inbox`. The issuer is told when it is paid (its Payment settled, its
// escrow paid out, or a bank deposit matched) and, new and named by the architecture, when the payer
// declines it. The old part-received email is dropped with the state it followed (requests.escrow-process).

import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { machine_request, table_requests } from "../requests/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, PERSON, noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src/requests";
const R = `${OLD}/receivables`;

const r = machine_request.t;

const READS = [table_requests, table_organizations, table_parties, table_principals];

const INVOICE = { name: "request", about: "Reads the request; anything but an Invoice (`kind` invoice) ends here with no notice." } as const;

const ISSUER = {
  name: "issuer",
  about: "The issuer by `owner_kind` and `owner_id`: a person at their principal's email, an Organization through its Directors.",
} as const;

export const workflow_notices_requests_issued = noticeWorkflow({
  id: "notices.requests.issued",
  title: "Tell an Invoice's payer what they owe",
  about:
    "Follows `issue` of an Invoice. A payer Organization is sent `invoice-received` (the issuer, the number, the amount " +
    "and the due date) through its Directors; a payer not on Capxul is sent `invoice-to-pay` at the mailbox the issuer " +
    "gave, with the escrow's address and network to pay into. A person on Capxul, and a link request with no payer yet, " +
    `are told nothing: the Invoice is in their inbox, or at its link. ${DIRECTORS}`,
  trigger: { transition: r.issue },
  reads: READS,
  steps: [
    INVOICE,
    {
      name: "payer",
      about:
        "By `payer_kind`: `capxul` with an Organization's Party (its owner) is told through its Directors; `outside` at " +
        "`payer_email`; a person's Party and `none` end here.",
    },
  ],
  chain: [contract_safe.f.getOwners],
  was: [`${R}/rules.ts:43`, `${R}/reads/notices.ts:103`, `${OLD}/receivables/writes.ts:35`],
});

export const workflow_notices_requests_paid = noticeWorkflow({
  id: "notices.requests.paid",
  title: "Tell an Invoice's issuer it was paid, and its outside payer the receipt",
  about:
    "Follows `settle`: the Invoice's Payment settled, from the payer's inbox or from its escrow's payout. Sends " +
    "`invoice-paid` to the issuer and, when a customer not on Capxul paid through the escrow, `invoice-receipt` to " +
    `them. ${PERSON} ${DIRECTORS}`,
  trigger: { transition: r.settle },
  reads: READS,
  steps: [INVOICE, ISSUER, { name: "receipt", about: "An `outside` payer whose escrow paid it is sent the receipt at `payer_email`." }],
  chain: [contract_safe.f.getOwners],
  was: [`${R}/rules.ts:109`, `${OLD}/writes/notices.ts:44`, `${OLD}/writes/escrows.ts:81`],
});

export const workflow_notices_requests_matched = noticeWorkflow({
  id: "notices.requests.matched",
  title: "Tell an Invoice's issuer a bank deposit paid it",
  about:
    "Follows `match`: a credited bank deposit was matched to the Invoice (by `bank match` or by its reference). Sends " +
    `\`invoice-paid\` to the issuer, as a settled payment does. ${PERSON} ${DIRECTORS}`,
  trigger: { transition: r.match },
  reads: READS,
  steps: [INVOICE, ISSUER],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/writes/deposits.ts:118`],
});

export const workflow_notices_requests_declined = noticeWorkflow({
  id: "notices.requests.declined",
  title: "Tell an Invoice's issuer the payer declined it",
  about:
    "Follows `decline`: the addressed payer turned the Invoice down (`inbox decline`). Sends `invoice-declined` to the " +
    "issuer with the payer's name. New: old receivables said nothing of a decline; the architecture names it " +
    `(dependencies.of-notices: 'a request issued, paid or declined'). ${PERSON} ${DIRECTORS}`,
  trigger: { transition: r.decline },
  reads: READS,
  steps: [INVOICE, ISSUER],
  chain: [contract_safe.f.getOwners],
  was: ["blueprint/shared/decisions.ts (dependencies.of-notices)"],
});
