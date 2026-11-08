// The banking area: the business verification invitation, the identity verification's approval,
// and a bank payout's way to the bank and back. Banking sends no mail (banking.verification-people);
// notices follows its transitions. A payout tells the person who made it (`created_by`), as old
// banking told the payer; the return, new here, is named by the architecture (dependencies.of-notices:
// "a payout returned").

import { table_principals } from "../access/data.ts";
import {
  machine_bank_payout,
  machine_verification,
  machine_verification_person,
  table_bank_accounts,
  table_bank_payouts,
  table_verification_people,
  table_verifications,
} from "../banking/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { PERSON, noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src";
const V = `${OLD}/parties/verifications`;
const PO = `${OLD}/banking/payouts`;

const PAYOUT_READS = [table_bank_payouts, table_bank_accounts, table_principals];

const PAYOUT_STEPS = [
  {
    name: "payout",
    about:
      "Reads the payout: who made it (`created_by`), the bank amount and currency of its quote (or `delivered_amount`), " +
      "its Payment and the saved account's last four digits.",
  },
] as const;

export const workflow_notices_banking_person_invited = noticeWorkflow({
  id: "notices.banking.person-invited",
  title: "Invite a business's named person to submit their own details",
  about:
    "Follows `invite`: a Director named a person (an owner, a controller, a signer or a director) in the Organization's " +
    "business verification. Sends `person-verification` to the email the Director gave, with the business's name, who " +
    "named them, and how to submit their own identity details with the `inv_kyb_` id (`capxul invite accept <id>`, or " +
    "`verify start --invitation`). The invitation grants no Organization permission.",
  trigger: { transition: machine_verification_person.t.invite },
  reads: [table_verification_people, table_verifications, table_organizations, table_parties, table_principals],
  steps: [
    { name: "person", about: "Reads the named person's row: their email, names, roles and invitation id." },
    { name: "facts", about: "The Organization's name, and the name of the Director who named them (`invited_by`'s Party)." },
  ],
  was: [`${V}/operations/deliver-person-invite.ts:57`, `${V}/writes/people.ts:99`, "packages/protocol/src/templates/emails/person-verification.ts:1"],
});

export const workflow_notices_banking_verified = noticeWorkflow({
  id: "notices.banking.verified",
  title: "Tell the owner they are verified for bank transfers",
  about:
    "Follows `approve`: Bridge approved a currency. Sends `bank-verified` once per verification, at its first approval: " +
    "a person's to that person, a business's to the Director who started it (`started_by`). A further currency's " +
    `approval sends nothing again. ${PERSON}`,
  trigger: { transition: machine_verification.t.approve },
  reads: [table_verifications, table_organizations, table_principals],
  steps: [{ name: "verification", about: "Reads the verification: its subject, its owner, who started it and the currencies approved." }],
  idempotency:
    "One notice per verification: `bank-verified:<verification id>`, so a further currency's approval, or a redelivered " +
    "one, finds the row and sends nothing. A send lost before its record is repeated under the same provider key.",
  was: [`${V}/rules/notices.ts:14`, `${V}/operations/notify.ts:1`],
});

export const workflow_notices_banking_payout_sent = noticeWorkflow({
  id: "notices.banking.payout-sent",
  title: "Tell the payer their bank payout is on its way",
  about:
    "Follows `fund`: the payout's Payment settled at Bridge's deposit address, so Bridge is delivering to the bank. " +
    `Sends \`bank-payout-sent\` to the person who made it, with the bank amount, currency and account. ${PERSON}`,
  trigger: { transition: machine_bank_payout.t.fund },
  reads: PAYOUT_READS,
  steps: PAYOUT_STEPS,
  was: [`${PO}/rules/notices.ts:36`, `${PO}/operations/notify.ts:1`],
});

export const workflow_notices_banking_payout_delivered = noticeWorkflow({
  id: "notices.banking.payout-delivered",
  title: "Tell the payer the bank received their payout",
  about:
    "Follows `deliver`: Bridge reports the bank received the quoted amount (or an operator resolved it so). Sends " +
    `\`bank-payout-delivered\` to the person who made it, with the amount delivered. ${PERSON}`,
  trigger: { transition: machine_bank_payout.t.deliver },
  reads: PAYOUT_READS,
  steps: PAYOUT_STEPS,
  was: [`${PO}/rules/notices.ts:36`],
});

export const workflow_notices_banking_payout_returned = noticeWorkflow({
  id: "notices.banking.payout-returned",
  title: "Tell the payer their bank payout came back",
  about:
    "Follows `mark_returning`: Bridge reports the transfer returned, refunded, cancelled or undeliverable after it was " +
    "funded, even after delivery (K13). Sends `bank-payout-returned` to the person who made it, with why and that the " +
    `refund is on its way to the Safe it left. New: old banking said nothing of a return. ${PERSON}`,
  trigger: { transition: machine_bank_payout.t.mark_returning },
  reads: PAYOUT_READS,
  steps: PAYOUT_STEPS,
  was: [`${PO}/README.md:58`, "docs/as-is/payments.md (K13)"],
});
