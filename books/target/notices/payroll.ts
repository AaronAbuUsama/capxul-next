// The payroll area: the emails an agreement sends as its holders' and payee's writes land, as its
// end comes, and when a payee's collection is refused (payroll.notices-elsewhere). Payroll's process
// owns the agreement's status from the chain's facts; notices follows its two machines through the
// outbox. The daily agreement notices (pay ready, a fixed term's last week, a Safe short of what its
// payees can collect) are calendar work with no single transition: processes.ts.
//
// The payee is a person at the mailbox the offer named (they may have no account yet: the offer
// waits for them), or an Organization through its Directors.

import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { machine_agreement, machine_agreement_write, table_agreement_writes, table_agreements } from "../payroll/data.ts";
import { contract_agreements, contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src/payroll/agreements";

const READS = [table_agreements, table_agreement_writes, table_organizations, table_parties, table_principals];

const PAYEE = {
  name: "payee",
  about: "The agreement's payee: a person at `payee_email`, or the payee Organization (`payee_org_id`) through its Directors.",
} as const;

export const workflow_notices_payroll_write_landed = noticeWorkflow({
  id: "notices.payroll.write-landed",
  title: "Tell the other side of an agreement what a landed write changed",
  about:
    "Follows `land`: a holder's or the payee's write reached the chain with its own Agreements event, once per write. " +
    "By its `change`: `offered` sends `agreement-offer` to the payee (the terms, the payer, when the offer lapses); " +
    "`accepted` sends `agreement-accepted` to whoever offered it; `rate_changed` and `rate_change_cancelled` send " +
    "`pay-changed` with the rate from its date; `paused` sends `agreement-paused` with what stays collectable now " +
    "(`availableOf`); `resumed` sends `agreement-resumed`, once; `ended` sends `agreement-ending` with the last day " +
    "paid; `collected` sends `pay-received` with the amount. A landed withdrawal sends nothing. A write that is only " +
    `prepared tells no one: nothing follows before it lands. ${DIRECTORS}`,
  trigger: { transition: machine_agreement_write.t.land },
  reads: READS,
  steps: [
    { name: "write", about: "Reads the landed write (its change and its args) and its agreement; `withdrawn` ends here." },
    { name: "chain", about: "For `paused`, what the payee can collect now: `Agreements.availableOf` through chain-rpc." },
    PAYEE,
    { name: "offerer", about: "For `accepted`, the principal who offered it (`offered_by`) and their email." },
  ],
  chain: [contract_agreements.f.availableOf, contract_safe.f.getOwners],
  was: [`${OLD}/rules/notices.ts:178`, `${OLD}/operations/notify.ts:29`, `${OLD}/reads/notices.ts:1`],
});

export const workflow_notices_payroll_collection_refused = noticeWorkflow({
  id: "notices.payroll.collection-refused",
  title: "Tell a payee their collection did not go through",
  about:
    "Follows `fail` of a payee's `collected` write that reverted, or whose payee Organization's Board proposal ran and " +
    "failed (`execution_failed`, board's `fail`): the chain refused the collection (the payer's Safe short, or its payout " +
    "ceiling reached), so nothing was paid. Sends `collection-refused` to the payee, who can try " +
    "again. A write another beat to the chain, and every holder write that failed, send nothing: the holder is following " +
    `their own write. The old payout-ceiling alert to the Directors is not kept (decision notices.agreements). ${DIRECTORS}`,
  trigger: { transition: machine_agreement_write.t.fail },
  reads: READS,
  steps: [
    { name: "write", about: "Reads the failed write; anything but a payee's `collected` that `reverted` or `execution_failed` ends here." },
    PAYEE,
  ],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/rules/notices.ts:205`],
});

export const workflow_notices_payroll_agreement_ended = noticeWorkflow({
  id: "notices.payroll.agreement-ended",
  title: "Tell a payee their agreement has ended, and what is left to collect",
  about:
    "Follows `finish`: the agreement's end came (a fixed term's own, or a holder's), by the chain's clock. Sends " +
    "`agreement-ended` to the payee with what they can still collect (`availableOf`), once per agreement. Old payroll's " +
    `daily sweep found ended agreements; here the process's timer moves \`finish\` and the notice follows it. ${DIRECTORS}`,
  trigger: { transition: machine_agreement.t.finish },
  reads: READS,
  steps: [
    { name: "agreement", about: "Reads the ended agreement: its payer, payee, token and end." },
    { name: "chain", about: "What the payee can still collect: `Agreements.availableOf` through chain-rpc." },
    PAYEE,
  ],
  chain: [contract_agreements.f.availableOf, contract_safe.f.getOwners],
  was: [`${OLD}/rules/notices.ts:142`, `${OLD}/rules/sweeps.ts:58`],
});
