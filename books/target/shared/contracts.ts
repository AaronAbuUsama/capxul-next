// The contract records made to match the contract code (10 November 2026). The v4 Solidity is now in the repository
// (packages/contracts, from Xelmar-tech/infrastructure at 62e4947), so the code is the truth for what exists and the book's
// contract records follow it. packages/contracts/abi-check/main.ts compares the two and fails on any difference that no decision names.
//
// CONTRACT_ALLOWANCES is plain data, not records: each difference that may stand, and the decision that names it. The check
// requires the decision to be in the book and its text to name the subject, and that the difference still exists.
// Subjects: `book:<record id>` (a contract record the code does not have), `code:<Solidity name>` (a contract the code
// deploys that no record describes), or `book:<id>.<function|event|error>.<name>` (one member).
//
// These are the coordinator's decisions on Aaron's delegation of the book, sourced as the cut's are (shared/cut.ts): their
// source starts "The coordinator", never "Aaron", so none of them shows as his ruling. The two that touch what he ruled
// (the general escrow, equity) say what he still has to settle.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as x from "./external.ts";
import { decision_aaron_escrow_general, decision_aaron_frappe_native, decision_aaron_one_door } from "./rulings.ts";
import { decision_cut_equity_parked } from "./cut.ts";

export const CONTRACT_ALLOWANCES: readonly { subject: string; decision: string }[] = [
  { subject: "book:escrow", decision: "contracts.general-escrow-not-built" },
  { subject: "book:escrow-factory", decision: "contracts.general-escrow-not-built" },
  { subject: "code:Vesting", decision: "contracts.equity-in-code" },
  { subject: "code:Captable", decision: "contracts.equity-in-code" },
  { subject: "code:ShareClass", decision: "contracts.equity-in-code" },
  { subject: "code:Options", decision: "contracts.equity-in-code" },
  { subject: "code:Rounds", decision: "contracts.equity-in-code" },
  { subject: "code:Exits", decision: "contracts.equity-in-code" },
  { subject: "code:Governor", decision: "contracts.equity-in-code" },
  { subject: "code:EquityInstaller", decision: "contracts.equity-in-code" },
];

const BY = "The coordinator, 10 November 2026, on Aaron's delegation of the book (aaron.one-door, aaron.frappe-native)";
const rulings = [decision_aaron_one_door, decision_aaron_frappe_native];
const built = [
  x.contract_companies_house_claimer, x.contract_company_safe_minter, x.contract_installer, x.contract_payments,
  x.contract_budgets, x.contract_agreements, x.contract_escrow_factory_v4, x.contract_escrow_v4, x.contract_agent_owner,
];

export const decision_contracts_code_is_truth = defineDecision({
  id: "contracts.code-is-truth",
  title: "The contract code is the truth; the records follow it and a check fails on drift",
  question:
    "The v4 contracts are now in packages/contracts. Several records disagreed with them (functions missing, an escrow the code " +
    "never had, stale addresses). Which side is the truth, and how is it kept so?",
  options: [
    {
      label: "code-is-truth",
      text:
        "A contract record that says `code: built` and names its `artifact` carries every function, event and error of that " +
        "compiled contract, with the same names, argument types and order, mutability and indexed arguments. packages/contracts/abi-check/main.ts " +
        "(`pnpm contracts:check-book`) compares them from a committed ABI export (`pnpm contracts:export-abi`, stamped with a hash of " +
        "the contract source, so it fails when the source moves on and the export does not) and fails on any difference that no " +
        "decision names. Third-party records (`code: third-party`) are listed, not compared. A design with no code says " +
        "`code: designed` and needs a decision that names it.",
    },
    { label: "book-leads", text: "The book is the design and the code is made to match it, as for new code (the book changes first)." },
    { label: "no-check", text: "Reconcile once by hand and keep no check." },
  ],
  chosen: "code-is-truth",
  why:
    "The code is tested (965 hermetic tests) and is what a deployment runs; the book's records were written from its " +
    "interfaces before it was brought in and had drifted: budgets omitted `configure`, `commit`, `release`, `payReserved`, " +
    "`setAgreements`, agreements omitted `settle`, `openOf`, `earnedOf`. For code that already exists, the book follows it; for " +
    "new code the rule stays that the book changes first. This supersedes contracts.functions, which kept only the members the " +
    "designed calls named: the refusals an operation depends on (OverBudget, NotAuthorised, AgentSelfCall) are in the errors, so " +
    "the records now hold the whole ABI. A check that runs with the others stops the next drift.",
  source: BY,
  affects: [...built, x.contract_safe, f.system_capxul, ...rulings],
});

export const decision_contracts_record_shape = defineDecision({
  id: "contracts.record-shape",
  title: "A contract record says where its code is and carries its errors",
  question: "The contract kind has functions and events. Where does a record say what code it is, and where do the custom errors go?",
  options: [
    {
      label: "code-artifact-errors",
      text:
        "Three optional fields on the contract kind: `code` (`built`, `designed` or `third-party`), `artifact` (the Solidity name " +
        "of a built contract, the name of its compiled ABI) and `errors` (name, signature, about: the contract's custom errors, " +
        "the refusals an operation depends on). packages/contracts/abi-check/main.ts requires `code` on every contract record.",
    },
    { label: "errors-in-about", text: "Leave the kind as it is and write the errors into each function's about." },
  ],
  chosen: "code-artifact-errors",
  why:
    "An error is a thing a caller can name and match, like a function or an event, and the check must compare it; prose cannot be " +
    "compared. The fields are optional so a record that is archived or parked still loads. A mapping kept in the tool instead of " +
    "the record would be a second place to forget.",
  source: BY,
  affects: [...built, x.contract_safe, x.contract_escrow, x.contract_escrow_factory],
});

export const decision_contracts_general_escrow_not_built = defineDecision({
  id: "contracts.general-escrow-not-built",
  title: "The general escrow is designed and not built; v4's escrow is what exists",
  question:
    "aaron.escrow-general and payments.general-escrow designed an escrow with a sender, an owner who may not exist yet, an " +
    "authority term, canRefund and ownerTakesSurplus. The code has v4's Escrow and EscrowFactory (`ownerSafe`, `payeeSafe`, no " +
    "canRefund, EscrowCreated with 8 arguments, EscrowRefunded with 4). What does the book say exists?",
  options: [
    {
      label: "record-v4-keep-design",
      text:
        "Two records describe what is built: `escrow-factory-v4` and `escrow-v4`, from the compiled Escrow and EscrowFactory, whole " +
        "(the 4 events, the 16 errors, `InvoicePaymentCompleted`, the refund only by `ownerSafe`). The records `escrow` and " +
        "`escrow-factory` stay as written and say `code: designed`: the general escrow is designed and not built, dated 10 November " +
        "2026, until the build in payments.escrow-contract-build writes it. The operations, workflows and notices that name its " +
        "functions and events keep naming them. The check lists the difference as allowed, with this decision.",
    },
    { label: "rewrite-to-v4", text: "Rewrite escrow and escrow-factory as v4's, and the operations that name canRefund, `by` and the authority term with them." },
    { label: "delete-design", text: "Delete the general escrow's design." },
  ],
  chosen: "record-v4-keep-design",
  why:
    "The design is Aaron's (aaron.escrow-general) and nothing was built from it; deleting it, or rewriting the operations built on " +
    "it, would decide for him and lose work. Recording v4 as built is what the code is. Until the general escrow is built, a " +
    "department's hat wearers cannot take an escrow back (v4's refund is the payer Safe's alone), `EscrowRefunded` does not name " +
    "who took it back, and an exit claim reads the owner's `isExitClaimEscrow`; devnet and the evals that need those behaviours " +
    "wait for the build. Reversible: the build turns `escrow` and `escrow-factory` to `code: built` and drops this allowance.",
  source: BY,
  affects: [x.contract_escrow, x.contract_escrow_factory, x.contract_escrow_v4, x.contract_escrow_factory_v4, decision_aaron_escrow_general, ...rulings],
});

export const decision_contracts_devnet_addresses = defineDecision({
  id: "contracts.devnet-addresses",
  title: "Devnet addresses come from the deployment file, not from records",
  question: "The records carried devnet addresses for seven contracts; this build deploys others. Where do devnet addresses live?",
  options: [
    {
      label: "deployment-file",
      text:
        "A contract Capxul deploys keeps no devnet address in its record. The devnet's addresses are the deployment record that " +
        "`packages/devnet`'s deploy writes, `packages/contracts/deployments/devnet.json`, with the chain state under " +
        "`packages/contracts/state/`; a build reads them there. Third-party contracts at a fixed address on a network (Hats, the " +
        "4337 module, MultiSend, the EntryPoint) keep theirs.",
    },
    { label: "update-records", text: "Replace the stale addresses in the records with this build's." },
  ],
  chosen: "deployment-file",
  why:
    "The addresses of CREATE2-deployed contracts follow their code: the runtime code of the claimer, minter, installer, payments, " +
    "budgets, agreements and agent owner is identical to the recorded build's apart from the metadata hash, yet the addresses " +
    "differ. Any rebuild or new constructor argument moves them again, so a hand-kept value is wrong by design. This supersedes " +
    "contracts.addresses for the contracts the code builds.",
  source: BY,
  affects: [...built],
});

export const decision_contracts_equity_in_code = defineDecision({
  id: "contracts.equity-in-code",
  title: "Equity contracts stay in the code and installed; the product stays parked",
  question:
    "The code deploys Vesting, Captable, ShareClass, Options, Rounds, Exits and Governor (and the Installer builds EquityInstaller), " +
    "while equity is parked in the book (cut.equity-parked). What does the contract check do about contracts the book does not record?",
  options: [
    {
      label: "in-code-parked-in-book",
      text:
        "The contracts remain in packages/contracts and in the deploy manifest: the Installer needs them (`deployEquity`, " +
        "`buildEquity`, the implementation getters) and the 965 tests depend on them. They have no contract record in the built " +
        "book; their records are with the parked equity (docs/cut-archive/parked/equity/). The check lists Vesting, Captable, " +
        "ShareClass, Options, Rounds, Exits, Governor and EquityInstaller as allowed differences, named here. The Installer's equity " +
        "functions and getters stay on its record, because the code has them.",
    },
    { label: "remove-from-code", text: "Remove the equity contracts from the code." },
    { label: "record-them", text: "Record them in the built book again." },
  ],
  chosen: "in-code-parked-in-book",
  why:
    "Changing contract source is not this reconciliation's to do, and the Installer cannot be built without them. Recording them " +
    "would take equity out of parked. cut.equity-parked stands: whether equity is kept or dropped is Aaron's to settle; when he " +
    "drops it the contracts leave the manifest and this allowance with them, and when he keeps it their records come back.",
  source: BY,
  affects: [x.contract_installer, decision_cut_equity_parked, ...rulings],
});

export const decision_contracts_agent_authority = defineDecision({
  id: "contracts.agent-authority",
  title: "An agent spends under a hat its Safe wears; Budgets decides",
  question: "How does an agent's authority to spend show in the contract records, and which refusals do operations depend on?",
  options: [
    {
      label: "hat-and-budget",
      text:
        "An agent has no authority of its own. It is a Safe (`AgentOwner.create`, sent by its owner's Safe) whose one signer is its " +
        "key. It spends because its Safe wears a hat, minted by the company Safe, that a budget names: `Budgets.spend` sees the " +
        "agent's Safe as the caller and `authorised` asks Hats whether it wears the budget's hat, or an ancestor budget's, in " +
        "good standing. That is the only place the authority is decided; the amount is bounded by `OverBudget`, and Roles' " +
        "allowance is the backstop. `AgentOwner` is the Safe's transaction and module guard: it refuses a call to the agent's own " +
        "Safe or a delegatecall (`AgentSelfCall`), and any module call while the agent is frozen or removed (`AgentInactive`). The " +
        "refusals are on the records as errors: `NotAuthorised`, `OverBudget`, `AgentSelfCall`, `AgentInactive`, `NotOwner`.",
    },
    { label: "agent-role", text: "Record an agent as a member of a Roles role." },
  ],
  chosen: "hat-and-budget",
  why:
    "It is what the code does (packages/contracts/README.md, 'How an agent's authority to spend flows'). The Roles role's only " +
    "member is Budgets, so the role never names the agent. One open point stays visible: nothing on chain limits which budget an " +
    "agent may draw on beyond the hat on that budget, so an agent should wear the hat of exactly the budgets it should use.",
  source: BY,
  affects: [x.contract_budgets, x.contract_agent_owner, x.contract_hats, x.contract_roles, x.contract_agreements],
});
