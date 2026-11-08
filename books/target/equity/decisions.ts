// Equity's own judgments, each a decision record whose `affects` lists the records it shapes. The
// architecture's judgments about equity (its place in the map, its dependencies, its codes) are in
// shared/decisions.ts (concepts.equity, dependencies.of-equity, vocabulary.new-equity-codes).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import {
  contract_captable,
  contract_exits,
  contract_governor,
  contract_options,
  contract_rounds,
} from "../shared/external.ts";
import { error_NOT_IMPLEMENTED } from "../shared/vocabulary.ts";
import { procedure_approvals_open, procedure_approvals_withdraw } from "../approvals/procedures.ts";
import * as data from "./data.ts";
import { rpc_equity_installs_begin, rpc_equity_installs_watch } from "./installs.ts";
import { rpc_equity_issues_propose } from "./issues.ts";
import * as grants from "./grants.ts";
import * as rounds from "./rounds.ts";
import * as safes from "./safes.ts";
import * as investments from "./investments.ts";
import * as holdings from "./holdings.ts";
import * as sales from "./sales.ts";
import * as exits from "./exits.ts";
import * as votes from "./votes.ts";
import { rpc_equity_writes_watch } from "./writes.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as ops from "./operations.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";

const by = (s: string) => `Equity designer, 8 Nov 2026: ${s}`;
const OLD = "packages/backend/src/organizations";

const TABLES = [
  data.table_equity_installs,
  data.table_equity_writes,
  data.table_fundraise_rounds,
  data.table_fundraise_investments,
  data.table_equity_grants,
  data.table_share_sales,
  data.table_votes,
];
const MACHINES = [
  data.machine_equity_install,
  data.machine_equity_write,
  data.machine_fundraise_round,
  data.machine_fundraise_investment,
  data.machine_equity_grant,
  data.machine_share_sale,
  data.machine_vote,
];
const EVENTS = [
  data.event_equity_install_transitioned,
  data.event_equity_write_transitioned,
  data.event_fundraise_round_transitioned,
  data.event_fundraise_investment_transitioned,
  data.event_equity_grant_transitioned,
  data.event_share_sale_transitioned,
  data.event_vote_transitioned,
];
const WORKFLOWS = [
  processes.workflow_equity_installs_setup,
  processes.workflow_equity_grants_lifecycle,
  processes.workflow_equity_rounds_lifecycle,
  processes.workflow_equity_sales_lifecycle,
  processes.workflow_equity_votes_lifecycle,
  processes.workflow_equity_writes_follow,
];
const BOARD_RPCS = [
  rpc_equity_issues_propose,
  grants.rpc_equity_grants_propose,
  grants.rpc_equity_grants_end,
  rounds.rpc_equity_rounds_create,
  rounds.rpc_equity_rounds_invite,
  rounds.rpc_equity_rounds_allocate,
  rounds.rpc_equity_rounds_close,
  rounds.rpc_equity_rounds_cancel,
  safes.rpc_equity_safes_create,
  safes.rpc_equity_safes_invite,
  safes.rpc_equity_safes_close,
  sales.rpc_equity_sales_approve,
  exits.rpc_equity_exits_pay,
];
const HOLDER_RPCS = [
  grants.rpc_equity_grants_accept,
  grants.rpc_equity_grants_exercise,
  investments.rpc_equity_investments_commit,
  investments.rpc_equity_investments_pay,
  investments.rpc_equity_investments_sign,
  holdings.rpc_equity_holdings_convert,
  holdings.rpc_equity_holdings_delegate,
  sales.rpc_equity_sales_offer,
  votes.rpc_equity_votes_propose,
  votes.rpc_equity_votes_cast,
  votes.rpc_equity_votes_execute,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_equity_chain_is_truth = defineDecision({
  id: "equity.chain-is-truth",
  title: "Equity keeps what the chain cannot name and reads the rest",
  question:
    "The old code copied chain state into its equity rows (the deployment's clones, earlier clones, the cap table as " +
    "JSON, issued and granted timestamps) and re-read the deployment on every answer. What does the target store?",
  options: [
    {
      label: "capxul-facts",
      text:
        "Store only Capxul's ids, who an instrument is for (Party, mailbox, Safe), the documents behind the hashes, the " +
        "request a repeat answers and the carrier of each write; read classes, balances, vesting, the pool, positions and " +
        "the Governor's standing from indexing's views or the clones when asked.",
    },
    { label: "mirror", text: "Mirror the clones' state in equity's tables, refreshed by their events." },
  ],
  chosen: "capxul-facts",
  why:
    "Ponder already indexes every equity clone (indexing's equity instruments and positions, chain-deployments, " +
    "chain-logs), so a mirror would be a second copy that drifts, the problem the indexing concept removed. What the " +
    "chain cannot name is what the frozen surface prints and Capxul alone knows: `og_`, `rd_`, `tr_`, `vt_` ids, member " +
    "names, documents and whether their hashes match. A status machine on each object is still Capxul's (P7), driven only " +
    "by chain proof.",
  source: by(`books/as-is/organizations/data.ts:725-1066 (nine tables); ${OLD}/equity/reads.ts:70 (equityFactsInTx re-read)`),
  affects: [...TABLES, concept_equity],
});

export const decision_equity_tables = defineDecision({
  id: "equity.tables",
  title: "Seven tables in place of nine",
  question: "Which tables does equity need, given the old organizations' nine equity tables?",
  options: [
    {
      label: "seven",
      text:
        "Installs; one writes table; rounds of both kinds; each investor's place in a round; grants (options and founders' " +
        "vesting); secondary sales; votes.",
    },
    { label: "as-is", text: "Keep the nine: equities, issues, SAFE rounds, option grants, share transfers, rounds, votes, ballots, executions." },
  ],
  chosen: "seven",
  why:
    "Old `orgRounds` and `orgSafeRounds` were the same shape twice: one `fundraise-rounds` with a kind. Issues, ballots " +
    "and executions are each one chain write with no life of their own: rows of `equity-writes` (equity.one-writes-table). " +
    "Investors had no table at all (the old code built none of rounds' investor side), yet commit, allocate, pay and sign " +
    "each need the investor's place, so `fundraise-investments` is new. Founders' vesting grants join option grants " +
    "because `org options end` ends both. Every table is the company's (P8).",
  source: by("books/as-is/organizations/data.ts:725-1066; books/frozen/operations.ts (invest.*, org.round.*, org.options.end designed)"),
  affects: [...TABLES],
});

export const decision_equity_one_writes_table = defineDecision({
  id: "equity.one-writes-table",
  title: "One writes table for every chain write equity carries",
  question:
    "Every equity command ends in a chain write carried by a Board proposal or a holder's approval, and many need 'the " +
    "same request answers the same write' and 'one on its way at a time'. Where do the carriers live?",
  options: [
    { label: "writes", text: "One `equity-writes` row per write, with its change, its object, its carrier, its request digest and its outcome." },
    { label: "columns", text: "Approval, proposal and user-operation columns on every object row, as the old tables had." },
  ],
  chosen: "writes",
  why:
    "An object has many writes over its life (a round's create, invites, allocation and close; a vote's propose, ballots " +
    "and executions), so carrier columns cannot hold them. One table gives one idempotency index (the request digest " +
    "while it waits), one 'on its way' guard per Safe and object (a second ballot) and one per Board matter (a second " +
    "execution, enforced inside the writing transaction), one machine with one event, and one live follow rpc for every " +
    "flow. Payroll's agreement-writes set the same pattern.",
  source: by(`${OLD}/tables/equity.ts:57; ${OLD}/tables/votes.ts:45-71; ${OLD}/tables/share-transfers.ts:9; books/target/payroll/data.ts`),
  affects: [data.table_equity_writes, data.machine_equity_write, rpc_equity_writes_watch],
});

export const decision_equity_holder_reads = defineDecision({
  id: "equity.holder-reads",
  title: "The company is the tenant; a holder reads their own rows by their Safe",
  question:
    "Investors, grantees, buyers and voters often hold no Seat in the company, yet must read their own invitation, grant, " +
    "sale or ballot. Whose rows are they?",
  options: [
    { label: "company-tenant", text: "org_id on every row; a second row-level policy admits the holder by the Safe column that names them." },
    { label: "split", text: "Person-tenanted copies of each holder's rows." },
  ],
  chosen: "company-tenant",
  why:
    "Each fact is one company's instrument, written in the company's transactions, so P8's tenant is the company. A copy " +
    "per holder would be two writes of one fact. The holder's own Safe is already on the row (investor_safe, grantee_safe, " +
    "seller_safe, buyer_safe, signer_safe), and its cross-tenant index names the query it serves. Payroll's payee reads " +
    "set the same pattern.",
  source: by("P8; books/target/payroll/decisions.ts (payroll.payee-reads)"),
  affects: [data.table_fundraise_investments, data.table_equity_grants, data.table_share_sales, data.table_equity_writes],
});

export const decision_equity_events = defineDecision({
  id: "equity.events",
  title: "Seven machines, seven events; four keep the old catalog's names",
  question:
    "The old catalog had five equity events (equity_shares_transitioned, equity_grant_transitioned, " +
    "fundraise_round_transitioned, fundraise_investment_transitioned, vote_transitioned), each the report of a landed " +
    "write. P7 gives each machine exactly one event named after it. Which machines, and what names?",
  options: [
    {
      label: "entity-machines",
      text:
        "One machine per object (install, write, round, investment, grant, sale, vote), named so that the round, investment, " +
        "grant and vote keep the catalog's event names; equity_shares_transitioned has no entity and goes.",
    },
    { label: "catalog-machines", text: "Five machines named after the old events, each over a mixed table of what it reported." },
  ],
  chosen: "entity-machines",
  why:
    "A machine is an entity's lifecycle (P7); 'equity shares' covered an install, an issue, a sale, a conversion and an exit, " +
    "five lifecycles with nothing in common. Naming the round, investment and grant machines `fundraise-round`, " +
    "`fundraise-investment` and `equity-grant` keeps those funnels' names. The old transition words survive as the " +
    "write's `change` (equity.reports).",
  source: by(`${OLD}/equity/events.ts:20-120; ${OLD}/rounds/events.ts; ${OLD}/votes/events.ts; P7`),
  affects: [...MACHINES, ...EVENTS],
});

export const decision_equity_reports = defineDecision({
  id: "equity.reports",
  title: "What 'reports' means in equity's claims",
  question:
    "Frozen claims say a write 'reports `equity_set_up` once', 'reports `cast` once with its side' or 'reports nothing'. " +
    "The old event fired only for a landed write; the target sends one event per transition of seven machines. How does a " +
    "claim's report map onto them?",
  options: [
    {
      label: "landed-write",
      text:
        "A report is equity_write_transitioned to `landed` with its `change` (the old transition word), at the block's time, " +
        "prepared_by its preparer; 'reports nothing' is no landed write.",
    },
    { label: "any-event", text: "A report is any event; then births, failures and abandonments break 'once' and 'never'." },
  ],
  chosen: "landed-write",
  why:
    "P7 sends events for births and failures too, so the funnel sees a proposal opened and a write that failed; counting " +
    "any event would make 'once' and 'a rejected one never' false. The catalog's words survive as the write's `change` " +
    "column, so claims without an old event name stay word for word (P1). Each line's `observes` names the event the trace " +
    "observer counts.",
  source: by(`${OLD}/equity/events.ts:1-20 (reports of landed writes); books/target/payroll/decisions.ts (payroll.reports); P1; P7`),
  affects: [data.event_equity_write_transitioned, data.machine_equity_write, ...ops.OPERATIONS],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_equity_processes = defineDecision({
  id: "equity.processes",
  title: "One process per install, grant, round, sale and vote; one per lone write",
  question:
    "rules.durable-processes names a round. Which other equity objects are long-lived, and who decides a write that " +
    "changes no long-lived object?",
  options: [
    {
      label: "per-object",
      text:
        "Add the install, the grant, the sale and the vote, each owning its machine and deciding its own writes; a round owns " +
        "its investors; an issue, conversion, delegation or exit payout is decided by a small process of its own.",
    },
    { label: "round-only", text: "Only rounds get a process; every other write is followed by the flow that made it." },
  ],
  chosen: "per-object",
  why:
    "Each added object waits on something outside a request (A3, P3): an install on a service-key receipt and the Board; a " +
    "grant on its grantee within 30 days and on its exercise window; a sale on the Board, the buyer and its expiry; a vote " +
    "on the Governor's clock and on an execution anyone may send. A flow cannot be what decides, since the CLI may stop. " +
    "Deciding a write in the object's own process moves the object in the same transaction as the write's landing, as " +
    "payroll does. A lone write needs only its carrier and its facts. No cron: the old system swept nothing for equity, " +
    "and every expiry is the object's own timer.",
  source: by("A3; P3; rules.durable-processes; books/target/payroll/processes.ts"),
  affects: [...WORKFLOWS, data.machine_equity_write],
});

export const decision_equity_setup_in_process = defineDecision({
  id: "equity.setup-in-process",
  title: "Setup deploys and proposes from the install's process",
  question:
    "`org equity setup` needs `Installer.deployEquity` (sent by Companies House's tier key) before the Board's batch can " +
    "be built, since `buildEquity` names the clones. Where do the deployment and the proposal happen?",
  options: [
    {
      label: "process",
      text:
        "The rpc plans and begins the install; its process sends deployEquity once, waits for EquityDeployed, builds the " +
        "batch and opens it through board.propose, with each founder's vesting grant born proposed on the same proposal.",
    },
    { label: "rpc", text: "The rpc sends deployEquity and waits for its receipt, then proposes." },
  ],
  chosen: "process",
  why:
    "An rpc is one transaction and never waits on the chain (A3); a lost answer after broadcast must be looked up, never " +
    "re-sent, and a deployment with no receipt yet must hold other terms back (setup line 4), which only a durable record " +
    "of the send can do. Founders' grants born with the batch give `org options end` a grant to end, decided by its own " +
    "process when the batch lands. The flow follows the install live until it is proposed, then signs.",
  source: by(`${OLD}/equity/operations/setup.ts; books/frozen/operations.ts (org.equity.setup designed call)`),
  affects: [rpc_equity_installs_begin, rpc_equity_installs_watch, processes.workflow_equity_installs_setup, flows.flow_client_org_equity_setup, data.machine_equity_grant],
});

export const decision_equity_director_from_chain = defineDecision({
  id: "equity.director-from-chain",
  title: "A Director is read from the chain, not from board's tables",
  question: "Every Board matter is refused for someone who is not a Director. What does equity read to know?",
  options: [
    { label: "chain", text: "The caller's own Safe owns the company Safe and wears the Director hat now: indexing's Safe owners and hat wearers, the hat id from organizations' deployment." },
    { label: "board", text: "Board's Director rows." },
  ],
  chosen: "chain",
  why:
    "Being a Director is a chain fact (the Signer Gate's valid signers wear the Director hat), so the check survives a " +
    "Director seated outside Capxul; it needs no read of board, whose tables are being designed at the same time. Board " +
    "still decides the proposal: equity only refuses early.",
  source: by(`${OLD}/proposals/guards.ts (requireSafeOwner); books/target/shared/foundation.ts (concept_board)`),
  affects: [...BOARD_RPCS],
});

export const decision_equity_no_door = defineDecision({
  id: "equity.no-door",
  title: "Equity has no procedures",
  question: "Does any other concept write equity's tables inside its own transaction?",
  options: [
    { label: "none", text: "No: equity invokes approvals', board's and documents' doors; payments settles equity's payments from chain facts." },
    { label: "payments-door", text: "Payments records a round payment on equity's investment in its settlement." },
  ],
  chosen: "none",
  why:
    "A round payment, SAFE, exercise, purchase or exit payout ends in one PaymentSent, which payments settles as a Payment " +
    "born from a chain fact (concepts.payments), and the round's process marks the investor paid from the same indexed fact. " +
    "The two need not commit together: neither moves or owns money the other does not already record on chain (rules.procedures).",
  source: by("rules.procedures; concepts.payments"),
  affects: [concept_equity, procedure_approvals_open, procedure_approvals_withdraw, procedure_board_propose, procedure_documents_store],
});

export const decision_equity_invest_pay_buys = defineDecision({
  id: "equity.invest-pay-buys",
  title: "`invest pay` also buys an approved secondary sale",
  question:
    "`org equity transfer approve` tells the buyer 'the buyer pays with: capxul invest pay tr_01K9…', but `invest pay` is " +
    "'Pay for your shares' in a round. Which command does the buyer run?",
  options: [
    { label: "both", text: "`invest pay` takes a round (`rd_`, Rounds.pay) or a sale (`tr_`, Exits.buy)." },
    { label: "round-only", text: "Only rounds; the buyer's purchase has no command." },
  ],
  chosen: "both",
  why:
    "The frozen designed example names `invest pay tr_…` for the buyer, and without it a sale could never complete from the " +
    "CLI. Both are 'pay for your shares and receive them in the same transaction'; the id's prefix chooses the call.",
  source: by("books/frozen/operations.ts (org.equity.transfer.approve designed example; invest.pay)"),
  affects: [investments.rpc_equity_investments_pay, flows.flow_client_me_invest_pay, ops.operation_invest_pay, processes.workflow_equity_sales_lifecycle],
});

export const decision_equity_safe_close = defineDecision({
  id: "equity.safe-close",
  title: "A full SAFE round is closed by a Director's own call",
  question: "The designed text says 'close needs no proposal for a full round'. Who sends it?",
  options: [
    { label: "own-call", text: "A Director's own Safe sends Rounds.closeSafeRound when the round is full; otherwise it is a Board proposal." },
    { label: "always-board", text: "Always a Board proposal." },
  ],
  chosen: "own-call",
  why:
    "The frozen returns say `closed`, or the proposal's status when the round is not full, so a full round closes at once; " +
    "only a Director may ask (ROLE_PERMISSION_DENIED for the rest), and their own Safe is the only one an approval can carry.",
  source: by("books/frozen/operations.ts (org.safe.close returns; org.safe.create designed signs)"),
  affects: [safes.rpc_equity_safes_close, flows.flow_client_org_safes_close],
});

export const decision_equity_vote_matters = defineDecision({
  id: "equity.vote-matters",
  title: "Six vote matters built; the Board-seat matters wait for board's seat groups",
  question:
    "`org vote create` names nine matters. `board-settings`, `elect` and `remove` call a Hats Elections clone and the " +
    "Installer's election batch (recorded since: contracts.hats-elections), and their seat groups and terms are board's, " +
    "which board has not designed (`org board claim --seat` names none yet). What do they answer?",
  options: [
    { label: "six", text: "Build the six whose calls are equity clones; the Board-seat three answer NOT_IMPLEMENTED until board designs seat groups." },
    { label: "build-nine", text: "Build all nine now on the recorded Elections calls, choosing seat groups and terms in equity." },
  ],
  chosen: "six",
  why:
    "NOT_IMPLEMENTED is the code a frozen command answers until it is built (vocabulary.keep-unnamed), and the Board-seat " +
    "matters belong with board's seat design (`org board claim`), whose seat groups are still null (CAP-1153). The shared " +
    "records now hold the Elections calls (contracts.hats-elections), so that blocker is gone; choosing seat groups and " +
    "terms in equity would design board's seats from outside board, so equity builds the three once board defines them.",
  source: by("books/frozen/operations.ts (org.vote.create designed flags W5-W8); packages/contracts/v4/src/authority/InstallerElections.sol"),
  affects: [votes.rpc_equity_votes_propose, error_NOT_IMPLEMENTED],
});

export const decision_equity_contract_functions = defineDecision({
  id: "equity.contract-functions",
  title: "Add the equity clones' functions equity reads and builds",
  question: "Equity's rpcs read and build v4 functions shared/external.ts did not list. Which are added?",
  options: [
    {
      label: "add",
      text:
        "Captable setTransferRule, freeze, convertibleReserved, closedForExit; Options vestedOf; Rounds pricedRound, " +
        "position, consent; Exits transfer, sale; Governor getVotes, proposalThreshold, hasVoted, isAllowedTarget.",
    },
    { label: "bundler-only", text: "Leave them out and let the bundler's simulation refuse." },
  ],
  chosen: "add",
  why:
    "Frozen refusals must come before anything is signed (BELOW_THRESHOLD, AUTHORISED_EXCEEDED, NOT_VESTED, RESERVED_MATTER), " +
    "and a sponsorship revert maps only to TRANSACTION_FAILED. Each signature is the v4 interface's (ICaptable, IOptions, " +
    "IRounds, IExits, IGovernor). No chain event was added: equity's processes are triggered by their objects' births and " +
    "read their carriers' facts with indexer.factsOf.",
  source: by("packages/contracts/v4/src/interfaces/ICaptable.sol:236-378; IOptions.sol:148; IRounds.sol:230-291; IExits.sol:240-251; IGovernor.sol:72"),
  affects: [contract_captable, contract_options, contract_rounds, contract_exits, contract_governor],
});

export const decision_equity_returns = defineDecision({
  id: "equity.returns",
  title: "Board matters whose frozen returns lack it also print their proposal",
  question: "`org round close` and `org options end` are Board proposals, but their frozen returns have no status or proposal. What do they print?",
  options: [
    { label: "add", text: "The frozen fields, then `status` and `proposal`, as every other Board matter prints." },
    { label: "frozen-only", text: "Only the frozen fields." },
  ],
  chosen: "add",
  why:
    "A Board proposal on a Board of more than one waits for the other Directors; without its status and id the person " +
    "cannot tell whether it executed or what to approve. Adding fields keeps every frozen one (P10).",
  source: by("books/frozen/operations.ts (org.round.close, org.options.end returns)"),
  affects: [ops.operation_org_round_close, ops.operation_org_options_end],
});

export const decision_equity_setup_budget = defineDecision({
  id: "equity.setup-budget",
  title: "Setup's p95 is 8 s, not chain-submit's 4 s",
  question: "`org equity setup` waits for a service-key transaction and its indexing before the Director can sign. What budget?",
  options: [
    { label: "8s", text: "chain-submit with p95 8,000 ms, the person's wait and chain confirmation excluded." },
    { label: "default", text: "chain-submit's 4,000 ms." },
  ],
  chosen: "8s",
  why:
    "deployEquity's receipt and its indexing at finality happen before the proposal exists, and that wait is the system's, " +
    "not the person's: the service signer's waitForReceipt has a 4 s p95 on its own, plus Ponder's poll.",
  source: by("P5; books/target/shared/external.ts (service-signer waitForReceipt p95)"),
  affects: [ops.operation_org_equity_setup, flows.flow_client_org_equity_setup],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_equity_acceptance = defineDecision({
  id: "equity.acceptance",
  title: "Twenty-three equity operations keep no acceptance line",
  question:
    "Equity was never built on the old devnet, and 23 of its 38 frozen operations have no acceptance line. Does the " +
    "target write new ones?",
  options: [
    { label: "none", text: "Keep none: the `no-acceptance` gap shows them until Aaron accepts new lines (spec 30)." },
    { label: "write", text: "Write new lines from the designed text." },
  ],
  chosen: "none",
  why:
    "P1 freezes the old lines and numbers them; new lines are a separate matter Aaron reviews per area. The designed v4 " +
    "text is still the specification of each (P10), and every refusal is booked from a world.",
  source: by("P1; P10; books/frozen/operations.ts (equity acceptance arrays)"),
  affects: [...ops.OPERATIONS],
});

export const decision_equity_acceptance_rewrites = defineDecision({
  id: "equity.acceptance-rewrites",
  title: "Thirty claims rewritten as outcomes (P1)",
  question:
    "Equity's frozen lines name old telemetry events (`reports equity_shares_transitioned once`), storage ('is stored', " +
    "'is noted', 'in the writing transaction') and the component that checks ('The SDK opens', 'The SDK signs'). Keep or rewrite?",
  options: [
    { label: "rewrite", text: "Rewrite each as the outcome a black box sees: proposed once, reported once, the approval's calls on chain; the old line moves to `was`." },
    { label: "keep", text: "Keep them: events that no longer exist, rows and an SDK the observers cannot see." },
  ],
  chosen: "rewrite",
  why:
    "P1 rewrites a line that names a mechanism, and each rewrite still passes against the old system. Rewritten: setup 4, 6; " +
    "issue 1-3; cap table 5; options grant 1, 2, 4; sell 1; transfer approve 1; round create 1-4; SAFE create 1, 2; vote " +
    "create 4-6; vote execute 2-5; vote list 2; vote cast 3-6; vote list (mine) 2. A claim naming " +
    "`fundraise_round_transitioned` or `equity_grant_transitioned` is rewritten too, since births and rejections now send " +
    "those events (equity.reports). The other 23 lines are word for word.",
  source: by("books/frozen/operations.ts (the 15 equity operations with acceptance); P1; P7; books/target/budgets/decisions.ts (budgets.acceptance-events)"),
  affects: [
    ops.operation_org_equity_setup,
    ops.operation_org_equity_issue,
    ops.operation_org_cap_table,
    ops.operation_org_options_grant,
    ops.operation_shares_sell,
    ops.operation_org_equity_transfer_approve,
    ops.operation_org_round_create,
    ops.operation_org_safe_create,
    ops.operation_org_vote_create,
    ops.operation_org_vote_execute,
    ops.operation_org_vote_list,
    ops.operation_vote_cast,
    ops.operation_vote_list,
  ],
});

export const decision_equity_worlds = defineDecision({
  id: "equity.worlds",
  title: "The thirteen worlds equity's refusals are reached from",
  question: "Which named devnet snapshots do equity's refusals need?",
  options: [
    {
      label: "thirteen",
      text:
        "signed-out (shared); org-with-equity-off; org-without-equity; org-with-equity-deploy-held; org-with-equity; " +
        "org-with-option-offered; org-with-option-active; org-with-round-open; org-with-round-allocated; " +
        "org-with-safe-round; org-with-sale-offered; org-with-votes; org-with-exit-approved.",
    },
    { label: "one-per-refusal", text: "A world per refusal." },
  ],
  chosen: "thirteen",
  why:
    "Each is built by running operations on a fresh devnet and saved: a company of two founders (a 2-of-2 Board), a member " +
    "who is not a Director and an outsider, then each step of equity's life. `org-with-equity-off` turns the gate off with " +
    "`dev gates set`; `org-with-equity-deploy-held` holds the service signer's receipt with its fault switch; " +
    "`org-with-votes` warps the clock so votes stand pending, active, defeated, succeeded and executed, with one lapsed " +
    "unsigned. Reusing worlds keeps their number small.",
  source: by("CONVENTIONS.md (refusals use given worlds); books/target/equity/operations.ts (WORLDS)"),
  affects: [...ops.OPERATIONS],
});

export const decision_equity_dropped = defineDecision({
  id: "equity.dropped",
  title: "Old equity plumbing that is not ported",
  question: "Which old organizations equity, rounds and votes functions have no target record?",
  options: [
    {
      label: "drop",
      text:
        "The emit actions (telemetry is the runtime's, P7), the load, find and list-rows queries (reads inside the rpcs), the " +
        "record and record-outcome mutations and the send-signed actions (approvals send, the processes decide), the " +
        "accounts lanes' reserve and release (one send per Safe is approvals'), the earlier-clones list and the share " +
        "transfer read (`transfer`, served by equity.writes.watch).",
    },
    { label: "port", text: "Port each as an rpc or workflow." },
  ],
  chosen: "drop",
  why:
    "None is reached by a frozen operation (P2) except through what replaces it: P3 drops plumbing, P7 makes telemetry the " +
    "runtime's, and approvals owns every UserOperation's send (concepts.approvals).",
  source: by(`books/as-is/organizations/equity.ts; books/as-is/organizations/votes.ts; books/as-is/organizations/rounds.ts; P2; P3; P7`),
  affects: [concept_equity, rpc_equity_writes_watch, ...HOLDER_RPCS],
});

// ── assembly (8 November 2026) ──────────────────────────────────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, target assembly (rails-and-reads), 8 November 2026; evidence: ${evidence}`;

export const decision_equity_failed_proposals = defineDecision({
  id: "equity.failed-proposals",
  title: "A Board proposal that ran and failed fails the equity write it carried",
  question:
    "Board added a `failed` proposal (the company Safe ran it and its call failed; board.failed-proposal) and asked every " +
    "follower of proposal_transitioned to read it as 'ran without effect'. What does an equity write, and an install's " +
    "batch, become?",
  options: [
    {
      label: "fail",
      text:
        "The write fails with `execution_failed`, as a reverted operation does; an install whose batch's proposal failed " +
        "ends `failed` (batch_reverted). Rejected and replaced proposals still abandon.",
    },
    { label: "abandon", text: "Abandon the write, as for a rejected or replaced proposal." },
  ],
  chosen: "fail",
  why:
    "Abandoned says nothing reached the chain, and a failed proposal used its nonce: the company Safe ran it. The " +
    "install machine already calls a batch that ran without effect `failed`, and its failure literal `batch_reverted` " +
    "is the same outcome, so no new install state is needed. The write keeps the cause apart so a show can say the Board " +
    "ran it and it failed. The write flows answer each carrier's end with approvals.machine's codes: declined CANCELLED, " +
    "expired unsent WRONG_STATE, refused, beaten or failed TRANSACTION_FAILED.",
  source: ASSEMBLY("books/target/board/decisions.ts (board.failed-proposal); books/target/board/data.ts (machine_proposal: fail); approvals.machine"),
  affects: [data.machine_equity_write, data.table_equity_writes, data.machine_equity_install, processes.workflow_equity_installs_setup, processes.workflow_equity_writes_follow, flows.flow_client_org_equity_setup],
});

export const decision_equity_assembly_rulings = defineDecision({
  id: "equity.assembly-rulings",
  title: "What equity takes from the shared assembly: tx-width, events, checkpoints",
  question:
    "Equity's report left four items with the shared records: its Board-matter prepares' transaction width, 12 events " +
    "its processes name in prose, the Elections record, and checkpoint reads for `org cap-table --at`. The shared pass " +
    "ruled on each. Does equity change?",
  options: [
    {
      label: "follow-rulings",
      text:
        "No record changes but the vote matters' text: the prepares are within sys:tx-width (rules.transaction-width counts " +
        "direct invocations: documents and board); the events are recorded (contracts.equity-events) and equity's processes " +
        "keep following them through their waits and factsOf; `--at` stays NOT_IMPLEMENTED (contracts.no-checkpoint-reads); " +
        "the Board-seat matters wait for board (equity.vote-matters).",
    },
    { label: "trigger-on-events", text: "Make each recorded event a workflow trigger of its own." },
  ],
  chosen: "follow-rulings",
  why:
    "A3 gives each long-lived object one process that waits on its chain events; a workflow per event would split the " +
    "object's one writer into many. The build's unconsumed-chain-event gap counts only triggers, and the schema's waits " +
    "carry no reference to a chain event, so those gaps stay until a wait can name its event. The frozen `org cap-table` " +
    "designed call says `--at` is not built yet, so NOT_IMPLEMENTED is its frozen answer.",
  source: ASSEMBLY("books/target/shared/decisions.ts (rules.transaction-width, contracts.equity-events, contracts.hats-elections, contracts.no-checkpoint-reads)"),
  affects: [concept_equity, votes.rpc_equity_votes_propose, holdings.rpc_equity_holdings_cap_table, procedure_board_propose, procedure_documents_store],
});
