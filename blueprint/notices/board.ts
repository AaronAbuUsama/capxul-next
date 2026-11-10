// The board area: a member seated as a Director, or removed, is told so; the Directors are told when
// the Gate's threshold changes and when a Board proposal waits for their approvals; a member granted an
// officer hat is told so. Board sends no mail; its events say notices follows them
// (board_change_transitioned, officer_change_transitioned, proposal_transitioned). Approvals sends no
// mail of its own either: the opener's transition says who waits, and for a Board proposal that is
// board's (approvals' decision on notify).

import { table_principals } from "../access/data.ts";
import {
  machine_board_change,
  machine_officer_change,
  machine_proposal,
  table_board_changes,
  table_board_proposals,
  table_officer_changes,
} from "../board/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src/organizations";
const OWNER_SAFE = "packages/protocol/src/templates/emails/owner-safe.ts:1";

const c = machine_board_change.t;

const CHANGE_READS = [table_board_changes, table_organizations, table_principals, table_parties];

export const workflow_notices_board_director_seated = noticeWorkflow({
  id: "notices.board.director-seated",
  title: "Tell a member they were seated as a Director",
  about:
    "Follows `seat`: the founder's seat of a member landed, and the member's Safe now signs the company Safe. Sends " +
    "`director-seated` to the member the change names, with the Organization's name and the Board's size and threshold " +
    "after it. The frozen note of `org board director add` says Capxul 'emails the member once they are seated'; the " +
    "event carries no email or Safe, so the notice reads the change. A claim (`claim`) is the claimer's own act and " +
    "sends nothing.",
  trigger: { transition: c.seat },
  reads: CHANGE_READS,
  steps: [
    { name: "change", about: "Reads the landed change: the member it names (their email as planned, else their principal's) and the Board after it." },
  ],
  was: [`${OLD}/directors/operations/notify.ts:1`, `${OLD}/proposals/rules/notices.ts:180`, OWNER_SAFE],
});

export const workflow_notices_board_director_removed = noticeWorkflow({
  id: "notices.board.director-removed",
  title: "Tell a Director they were removed from the Board",
  about:
    "Follows `remove`: the founder's removal of a Director landed, and the Gate dropped their Safe. Sends " +
    "`director-removed` to the Director the change names, with the Organization's name. A refresh that drops lapsed " +
    "signers (`lapse`) sends nothing: their hat had already lapsed.",
  trigger: { transition: c.remove },
  reads: CHANGE_READS,
  steps: [{ name: "change", about: "Reads the landed change: the Director it names and their email as planned, else their principal's." }],
  was: [`${OLD}/proposals/rules/notices.ts:190`, OWNER_SAFE],
});

export const workflow_notices_board_threshold_changed = noticeWorkflow({
  id: "notices.board.threshold-changed",
  title: "Tell the Directors how many approvals a proposal now needs",
  about:
    "Follows `set_threshold`: the founder's change of the Gate's threshold landed. Sends `threshold-changed` to every " +
    `Director, with the threshold before and after and the Board's size. ${DIRECTORS}`,
  trigger: { transition: c.set_threshold },
  reads: CHANGE_READS,
  steps: [
    { name: "change", about: "Reads the landed change: the threshold before and after, and the Organization's company Safe." },
    { name: "directors", about: "The company Safe's owners now, each to its principal's email." },
  ],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/proposals/rules/notices.ts:199`, OWNER_SAFE],
});

export const workflow_notices_board_proposal_waiting = noticeWorkflow({
  id: "notices.board.proposal-waiting",
  title: "Tell the Directors a Board proposal waits for their approval",
  about:
    "Follows `propose`: a Board proposal is born waiting for the Directors' approvals at the Safe's threshold. Sends " +
    "`proposal-waiting` to every Director but its proposer, with what opened it and its note, and the approval link. A " +
    `rejection waits like any other proposal and is told the same way. ${DIRECTORS}`,
  trigger: { transition: machine_proposal.t.propose },
  reads: [table_board_proposals, table_organizations, table_principals, table_parties],
  steps: [
    { name: "proposal", about: "Reads the proposal: its Organization, its company Safe, its proposer's Safe, its opener and subject, and its note." },
    { name: "directors", about: "The company Safe's owners now, less the proposer's Safe, each to its principal's email." },
  ],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/proposals/rules/notices.ts:1`, `${OLD}/proposals/operations/notify.ts:1`, `${OLD}/proposals/reads/notices.ts:1`],
});

export const workflow_notices_board_officer_granted = noticeWorkflow({
  id: "notices.board.officer-granted",
  title: "Tell a member they were given an officer hat",
  about:
    "Follows `apply` of an officer change: the Board proposal that grants a member the Books, Invoicing or People hat " +
    "executed and the hat is on their Safe. Sends `officer-hat-granted` to the member, naming the permission " +
    "(manage-books, issue-invoices or manage-people) and the Director's note. A revoke that applied sends nothing, as " +
    "before.",
  trigger: { transition: machine_officer_change.t.apply },
  reads: [table_officer_changes, table_organizations, table_principals],
  steps: [
    { name: "change", about: "Reads the applied change; a `revoke` ends here. The member's email as planned, else their principal's." },
  ],
  was: [`${OLD}/members/operations/notify-permission.ts:1`, `${OLD}/members/external.ts:1`, "packages/protocol/src/templates/emails/books.ts:1"],
});
