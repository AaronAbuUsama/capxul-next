// The board area: a member seated as a Director is told so, and the Directors are told when a Board
// proposal waits for their approvals. Board is designed at the same time, so its records come
// through ./links.ts by their conventional names (decision notices.board-links). Approvals sends no
// mail of its own: the opener's transition says who waits (approvals' decision on notify), and for a
// Board proposal that is board's. The old Director-removed, threshold-changed and officer-hat emails
// wait for board's design to name their transitions (decision notices.board-links).

import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";
import { table_board_seats, table_proposals, transition_board_seat_seat, transition_proposal_propose } from "./links.ts";

const OLD = "packages/backend/src/organizations";

export const workflow_notices_board_director_seated = noticeWorkflow({
  id: "notices.board.director-seated",
  title: "Tell a member they were seated as a Director",
  about:
    "Follows board's seat landing on chain (`board_seat_transitioned`, seated): the member's Safe now signs the company " +
    "Safe. Sends `director-seated` to that member, with the Organization's name and the Board's size and threshold as " +
    "the chain has them now. The frozen note of `org board director add` says Capxul 'emails the member once they are " +
    "seated'; the event itself carries no email or Safe, so the notice reads the seat.",
  trigger: { transition: transition_board_seat_seat },
  reads: [table_board_seats, table_organizations, table_principals, table_parties],
  steps: [
    { name: "seat", about: "Reads the landed seat: the Organization and the seated member's Safe; a principal at that Safe is the recipient." },
    { name: "board", about: "The company Safe's owners and threshold now (`Safe.getOwners`, `Safe.getThreshold` through chain-rpc)." },
  ],
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold],
  was: [`${OLD}/directors/operations/notify.ts:1`, `${OLD}/proposals/rules/notices.ts:180`, "packages/protocol/src/templates/emails/owner-safe.ts:1"],
});

export const workflow_notices_board_proposal_waiting = noticeWorkflow({
  id: "notices.board.proposal-waiting",
  title: "Tell the Directors a Board proposal waits for their approval",
  about:
    "Follows a Board proposal's birth (`proposal_transitioned` from no state): it waits for the Directors' approvals at " +
    "the Safe's threshold. Sends `proposal-waiting` to every Director but the one who proposed it, with what it does in " +
    `a person's words (the proposal's summary, given by the concept that proposed it) and the approval link. ${DIRECTORS}`,
  trigger: { transition: transition_proposal_propose },
  reads: [table_proposals, table_organizations, table_principals, table_parties],
  steps: [
    { name: "proposal", about: "Reads the proposal: its Organization, its proposer and its summary." },
    { name: "directors", about: "The company Safe's owners now, less the proposer's Safe, each to its principal's email." },
  ],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/proposals/rules/notices.ts:1`, `${OLD}/proposals/operations/notify.ts:1`, `${OLD}/proposals/reads/notices.ts:1`],
});
