// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision, type Concept } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as v from "./vocabulary.ts";
import * as x from "./external.ts";

export const decision_concepts_equity = defineDecision({
  id: "concepts.equity",
  title: "New concept: equity, with shareholder votes",
  question: "Where do the cap table, options, rounds, SAFEs, exits, shares and shareholder votes live?",
  options: [
    { label: "equity", text: "One equity concept, low priority, including the Governor's votes." },
    { label: "board-votes", text: "Equity without votes; votes in board." },
  ],
  chosen: "equity",
  why:
    "They are the v4 equity clones (Captable, ShareClass, Vesting, Options, Rounds, Exits, Governor), all low priority and " +
    "off the critical path (spec 40), so one concept keeps them out of the critical concepts' budgets. Shareholder votes " +
    "weigh shares and run on the Governor, an equity clone; Board decisions are board's proposals.",
  source: by("docs/spec/40-capxul-team.md (equity, directors and voting low priority); docs/planning/protocol-v4/architecture.md"),
  affects: [f.concept_equity, f.concept_board],
});

export const decision_dependencies_of_equity = dependencies(f.concept_equity, {
  access: "the caller of every rpc.",
  parties: "investors, grantees and shareholders are resolved to Parties and Safes.",
  indexing: "the equity clones' events and positions.",
  approvals: "an investor's, grantee's or shareholder's call is an approval from their own Safe.",
  accounts: "an invited investor needs a claimed Safe to commit or pay.",
  organizations: "the company, its members and its equity deployment.",
  board: "every Board matter (issue, round, options, exit) is a Board proposal.",
  documents: "round, SAFE and grant documents are stored with their offers.",
});

export const decision_contracts_hats_elections = defineDecision({
  id: "contracts.hats-elections",
  title: "Hats Elections and the Installer's election calls are recorded",
  question:
    "`org vote create` names `board-settings`, `elect` and `remove` (designed, W6), whose Governor calls go to a seat " +
    "group's Hats Elections clone and the Installer's election batch. contracts.v4-set left Elections out. Record it?",
  options: [
    {
      label: "record",
      text:
        "Record the Elections clone (elect, recall, setNextTerm, startNextTerm, currentTermEnd, nextTermEnd) and the " +
        "Installer's deployElections, buildElections and ElectionsDeployed.",
    },
    { label: "wait", text: "Leave it out until board designs seat groups; the three matters answer NOT_IMPLEMENTED." },
  ],
  chosen: "record",
  why:
    "P10: a designed block is the specification, and the shared records should not be what keeps a designed matter " +
    "unbuilt; equity.vote-matters names this record as one of its two blockers. The calls are v4's: IHatsElectionEligibility " +
    "and InstallerElections are in packages/contracts/v4, and the Governor's allowed targets include the predicted " +
    "Elections clone. The other blocker, board's seat groups and terms, is board's design; until it lands the three " +
    "matters keep NOT_IMPLEMENTED, and equity builds them once it does.",
  source: assembly("packages/contracts/v4/src/interfaces/external/IHatsElectionEligibility.sol:9; authority/InstallerElections.sol:22-80; interfaces/IInstaller.sol:113, 288; frozen org.vote.create designed flags"),
  affects: [x.contract_hats_elections, x.contract_installer, f.concept_equity, f.concept_board],
});

export const decision_contracts_equity_events = defineDecision({
  id: "contracts.equity-events",
  title: "The equity events that equity's processes follow are recorded",
  question: "Equity's processes and tables name 12 v4 events that the contract records lacked. Record them?",
  options: [
    {
      label: "record",
      text:
        "Add Options' OptionsAccepted; Rounds' SafeRoundCreated, SafeInvited, SafeSigned, Invited, Allocated and " +
        "RoundCancelled; Exits' SaleApproved, TransferOffered and TransferApproved; Vesting's Granted and Revoked.",
    },
    { label: "prose", text: "Leave them named only in the processes' prose." },
  ],
  chosen: "record",
  why:
    "contracts.functions records every event a concept must follow, and equity/processes.ts and equity/data.ts name " +
    "these; Ponder indexes them for indexing's views either way. Recorded, equity can trigger on or name them by record, " +
    "and the unconsumed-chain-event gap shows exactly which it still follows only in words. Escrow's " +
    "InvoicePaymentCompleted is not added: nothing reads the surplus it reports (indexing's report).",
  source: assembly("packages/contracts/v4/src/interfaces/IOptions.sol:38; IRounds.sol:70-104; IExits.sol:68-90; IVesting.sol:30-39; books/target/equity/processes.ts"),
  affects: [x.contract_options, x.contract_rounds, x.contract_exits, x.contract_vesting, f.concept_equity],
});

export const decision_contracts_no_checkpoint_reads = defineDecision({
  id: "contracts.no-checkpoint-reads",
  title: "No checkpoint reads for `org cap-table --at` yet",
  question: "Equity asks for the share classes' checkpoint reads so `org cap-table --at` can answer. Record them?",
  options: [
    { label: "wait", text: "Record none: the designed call says `--at` is not built yet, so it answers NOT_IMPLEMENTED." },
    { label: "votes", text: "Record ShareClass getPastVotes, getPastTotalSupply and safeBalanceAt." },
  ],
  chosen: "wait",
  why:
    "The frozen designed `call` says '`--at` (checkpoints) is not built yet', so NOT_IMPLEMENTED is the frozen surface, " +
    "not a weakening. ERC20Votes keeps checkpoints of votes, not balances: a holder who delegated shows no votes, so a past " +
    "vote count is not a past holding, and only the company Safe's balance has its own checkpoint (safeBalanceAt). A past " +
    "cap table reads better from indexing's history of the classes' Transfers; when `--at` is designed, equity and " +
    "indexing choose.",
  source: assembly("frozen org.cap-table (designed call); packages/contracts/v4/src/interfaces/IShareClass.sol:8-58; books/target/equity/holdings.ts:39"),
  affects: [x.contract_share_class, f.concept_equity],
});
