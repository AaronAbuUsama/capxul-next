// ABI completeness is not a promise of a product caller. Keep member descriptions in external.ts intact.
// One decision per contract; each stand names the actual caller and the boundary absent from the product graph.
import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as x from "./external.ts";

export const decision_contracts_agent_owner_boundary = defineDecision({
  id: "contracts.agent-owner-boundary", title: "AgentOwner's guard callbacks are Safe calls, not server calls",
  question: "Who calls the AgentOwner ABI members outside the product's explicit calls?",
  options: [{ label: "retain", text: "Keep the whole ABI. Safe invokes its guard interface; diagnostic getters need no new operation." }],
  chosen: "retain", why: "The Safe enforces the agent's restrictions inside execution. A server call to a guard would not enforce anything.",
  source: "packages/contracts/src/agents/AgentOwner.sol; contracts.code-is-truth",
  affects: [x.contract_agent_owner],
  stands: [
    { record: "function:agent-owner.PAYMENTS", rule: "uncalled-function", why: "Anyone may inspect PAYMENTS to audit the immutable sweep destination after deployment. Sweep uses the stored address internally; no product operation needs to discover it through this getter." },
    { record: "function:agent-owner.SWEEP_KIND", rule: "uncalled-function", why: "Anyone may read SWEEP_KIND when inspecting sweep encoding (kind 9). AgentOwner stamps the constant internally; the product sends sweep, not a separate constant read." },
    { record: "function:agent-owner.checkAfterExecution", rule: "uncalled-function", why: "Safe calls checkAfterExecution after a guarded transaction; the public hook is a no-op. No server operation calls an after-hook on the Safe's behalf." },
    { record: "function:agent-owner.checkAfterModuleExecution", rule: "uncalled-function", why: "Safe calls checkAfterModuleExecution after module execution; the public hook is a no-op. The blueprint sends the enclosing transaction, not this callback." },
    { record: "function:agent-owner.checkModuleTransaction", rule: "uncalled-function", why: "Safe calls checkModuleTransaction before a module runs, checking frozen/removed status and forbidding self-call or delegatecall except for AgentOwner's owner powers. The server never invokes this guard directly." },
    { record: "function:agent-owner.checkTransaction", rule: "uncalled-function", why: "Safe calls checkTransaction before executing an agent-signed transaction, rejecting self-call or delegatecall. It is publicly callable but only the Safe's own invocation enforces the guard; no product RPC substitutes for it." },
    { record: "function:agent-owner.supportsInterface", rule: "uncalled-function", why: "Safe probes supportsInterface when accepting transaction/module guards during create. Anyone can probe ERC-165; the blueprint calls create, not the nested interface check." },
    { record: "function:agent-owner.sweeps", rule: "uncalled-function", why: "Anyone may read sweeps(safe) to audit the nonce counter after sweeps. AgentOwner increments it internally; sweep/remove callers do not allocate the counter and no product read exposes it." },
  ],
});

export const decision_contracts_agreements_boundary = defineDecision({
  id: "contracts.agreements-boundary", title: "Agreements' maintenance and diagnostic ABI stays available",
  question: "Which Agreements members have no direct product call today?",
  options: [{ label: "retain", text: "Keep constants, diagnostics and permissionless settlement without inventing a maintenance operation. Product reads use agreementOf, availableOf and the chain clock." }],
  chosen: "retain", why: "Reads must not write settlement. The contract settles reservations during offer and raises; an external keeper may also settle a budget.",
  source: "packages/contracts/src/money/Agreements.sol; payroll.chain-reads; contracts.code-is-truth",
  affects: [x.contract_agreements],
  stands: [
    { record: "function:agreements.MAX_OPEN_AGREEMENTS", rule: "uncalled-function", why: "Anyone may inspect MAX_OPEN_AGREEMENTS before offering into a full budget (64). offer enforces the cap internally; product preparation does not query this constant." },
    { record: "function:agreements.MONTHLY", rule: "uncalled-function", why: "Anyone may read MONTHLY to identify the max-uint64 calendar-month step. The terms builder encodes that sentinel; no separate on-chain constant read is required by an operation." },
    { record: "function:agreements.agreementCount", rule: "uncalled-function", why: "Anyone may inspect agreementCount after offers to audit assigned ids. Product lists select recorded agreements for the caller's Safe, not a global count or enumeration." },
    { record: "function:agreements.budgets", rule: "uncalled-function", why: "Anyone may inspect budgets after deployment to verify reservation wiring. Agreements calls that immutable internally; product preparation uses the deployment's Budgets rather than this discovery getter." },
    { record: "function:agreements.earnedOf", rule: "uncalled-function", why: "Anyone, including a payee, may read earnedOf to project earned-but-uncollected pay at the block time. Current list/show design derives earned pay from agreementOf and the chain clock alongside availableOf; it does not call this convenience view." },
    { record: "function:agreements.openOf", rule: "uncalled-function", why: "Anyone may read openOf(budgetId) for the bounded on-chain settlement list. Product lists include historical and prepared agreements from their own records, so they do not enumerate through this maintenance view." },
    { record: "function:agreements.reservation", rule: "uncalled-function", why: "Anyone may call reservation to calculate the per-budget-period figure capped by a fixed term. offer calls it internally; product preparation calculates the Calendar figure from terms and does not make a separate pure-function chain call." },
    { record: "function:agreements.settle", rule: "uncalled-function", why: "Anyone may call settle(budgetId) once an end, lowering or offer expiry is due to free reservations and prune closed ids. offer/changeRate already settle internally; the product's lifecycle timers update its records, not a separately sponsored keeper transaction." },
    { record: "chainEvent:agreements.ReservationReleased", rule: "unconsumed-chain-event", why: "Agreements emits ReservationReleased while a holder withdraws or accrual closes/lowers an agreement, including permissionless settle. It records capacity freed, not another agreement status; lifecycle follows OfferWithdrawn/AgreementEnded/RateChanged and reads Budgets, with no separate release reaction." },
  ],
});

export const decision_contracts_budgets_boundary = defineDecision({
  id: "contracts.budgets-boundary", title: "Budgets' internal money calls and installation diagnostics stay explicit",
  question: "Why do Budgets ABI members remain outside direct product calls and waits?",
  options: [{ label: "retain", text: "Keep internal Agreements calls, one-time deployment wiring and diagnostic getters. Link configure to the existing organization install batch; do not invent operations for the rest." }],
  chosen: "retain", why: "commit/release/payReserved are Agreements-only nested money calls. Secondary logs do not each require a workflow.",
  source: "packages/contracts/src/money/Budgets.sol; packages/contracts/src/authority/InstallerMoney.sol; contracts.code-is-truth",
  affects: [x.contract_budgets],
  stands: [
    { record: "function:budgets.setHat", rule: "uncalled-function", why: "The company Safe manages a top budget's setHat; for a child, a caller authorised on its parent may set a nonzero hat. Current department/allowance operations create hats and change wearers, not replace a budget's office hat; no rebind operation is designed." },
    { record: "function:budgets.MAX_DEPTH", rule: "uncalled-function", why: "Anyone may read MAX_DEPTH (8) to inspect the tree limit. createChildBudget and path authorization enforce it internally; no product read asks the chain for this constant." },
    { record: "function:budgets.agreements", rule: "uncalled-function", why: "Anyone may read agreements after wiring to audit who may reserve and payReserved. Product calls the deployment's Agreements address, not this wiring diagnostic." },
    { record: "function:budgets.budgetCount", rule: "uncalled-function", why: "Anyone may inspect budgetCount after creation to audit global ids. Product budget lists are Safe-scoped and use indexed ids/childrenOf, not a global count scan." },
    { record: "function:budgets.commit", rule: "uncalled-function", why: "Only the wired Agreements contract may call commit during offers or rate raises, with enough room on an open path. Product calls offer/changeRate; it cannot directly reserve through this Agreements-only entry point." },
    { record: "function:budgets.configs", rule: "uncalled-function", why: "Anyone may read configs(safe) after configure to inspect Roles and its payout key. Product retains the install deployment and reads Roles allowances there, so it has no separate config-discovery call." },
    { record: "function:budgets.hats", rule: "uncalled-function", why: "Anyone may read hats to verify the immutable authority registry after deployment. Product uses its deployment's Hats directly; Budgets.authorised uses the immutable internally." },
    { record: "function:budgets.pathOf", rule: "uncalled-function", why: "Anyone may read pathOf for a budget's root-to-leaf ancestry. Product tree reads already follow budgetOf/childrenOf and no operation requests this convenience array." },
    { record: "function:budgets.payReserved", rule: "uncalled-function", why: "Only Agreements may call payReserved when a payee collects released pay; it pays kind 4 through Roles and Payments. Product prepares Agreements.collect, not an unauthorized direct call to this entry point." },
    { record: "function:budgets.payments", rule: "uncalled-function", why: "Anyone may inspect payments to audit the immutable payout destination after deployment. Budgets uses it internally; product uses the known deployment Payments address, not this discovery getter." },
    { record: "function:budgets.release", rule: "uncalled-function", why: "Only Agreements may call release when withdrawal, expiry, end or lowering frees a reservation. Product sends the enclosing agreement action or observes its deadline; it cannot call this Agreements-only entry point itself." },
    { record: "function:budgets.scheduledCount", rule: "uncalled-function", why: "Anyone may inspect scheduledCount after scheduling to audit global ids. Product tracks each schedule from PaymentScheduled rather than enumerating all companies' schedules by a count." },
    { record: "function:budgets.setAgreements", rule: "uncalled-function", why: "Only the constructor's deployer may setAgreements, once, to a nonzero address. This is chain deployment wiring before any company uses budgets, not an organization or payment operation." },
    { record: "chainEvent:budgets.BudgetHatSet", rule: "unconsumed-chain-event", why: "Budgets emits BudgetHatSet when a top budget's Safe or a child's parent manager rebinds its hat. No product rebind operation exists today; authority reads budgetOf/authorised, rather than a dedicated hat-rebinding workflow." },
    { record: "chainEvent:budgets.Spent", rule: "unconsumed-chain-event", why: "Budgets emits Spent after an authorised spender's successful spend, beside PaymentSent. Payments settles on PaymentSent and budget reads use live balances; a second spend-log workflow would duplicate the same money fact." },
    { record: "chainEvent:budgets.ScheduledPaid", rule: "unconsumed-chain-event", why: "Budgets emits ScheduledPaid when anyone executes a due pending schedule. The payment lifecycle follows its PaymentSent and approval outcome; no separate ScheduledPaid reaction is needed to settle that payment." },
    { record: "chainEvent:budgets.Committed", rule: "unconsumed-chain-event", why: "Budgets emits Committed only after Agreements calls commit for an offer or raise. AgreementOffered/RateChanged carry the product effect and reads use budgetOf/leftOf; no independent reservation workflow consumes this secondary log." },
    { record: "chainEvent:budgets.Released", rule: "unconsumed-chain-event", why: "Budgets emits Released only when Agreements frees a reservation after withdrawal, expiry, end or lowering. Agreement lifecycle events/timers and live budget reads cover the product state; no separate capacity-release workflow is designed." },
    { record: "chainEvent:budgets.AgreementsSet", rule: "unconsumed-chain-event", why: "Budgets emits AgreementsSet when its deployer wires Agreements once. No tenant object is waiting during chain installation, so no product workflow consumes this deployment audit log." },
    { record: "chainEvent:budgets.Configured", rule: "unconsumed-chain-event", why: "Budgets emits Configured when the company Safe executes the install batch's configure. Organization setup follows that batch's approval and indexed install facts, not a distinct Configured-triggered process." },
    { record: "chainEvent:budgets.ReservedPaid", rule: "unconsumed-chain-event", why: "Budgets emits ReservedPaid after Agreements pays a collection via payReserved. Collected lands the agreement write and PaymentSent settles the payment; consuming this third log in another workflow would duplicate those effects." },
  ],
});

export const decision_contracts_installer_boundary = defineDecision({
  id: "contracts.installer-boundary", title: "Installer diagnostics and parked equity/elections do not add commands",
  question: "Who uses the Installer ABI outside the money-install product path?",
  options: [{ label: "retain", text: "Keep constructor diagnostics and parked feature helpers. Existing money-install callers use buildMoney/buildAddToken/buildSetCeiling, which derive role and allowance keys internally." }],
  chosen: "retain", why: "The ABI must match built code even where equity and its elections integration are parked (contracts.equity-in-code).",
  source: "packages/contracts/src/authority/Installer.sol; InstallerBase.sol; InstallerElections.sol; contracts.equity-in-code; cut.equity-parked",
  affects: [x.contract_installer],
  stands: [
    { record: "function:installer.deployEquity", rule: "uncalled-function", why: "Anyone may deployEquity with valid company parameters to create the equity clones. Equity product operations are parked; current organization setup installs money only, so it does not deploy this suite." },
    { record: "function:installer.buildEquity", rule: "uncalled-function", why: "Anyone may read buildEquity for valid install parameters to obtain company/founder batches; execution still needs their authority. Equity is parked, so no active product flow requests these batches." },
    { record: "function:installer.deployElections", rule: "uncalled-function", why: "Anyone may deployElections for a mutable Director hat in the Shareholders tree with a future matching first term. The Governor/equity elections integration is parked; current Board seating/handover calls Hats/Gate directly, not this helper." },
    { record: "function:installer.buildElections", rule: "uncalled-function", why: "Anyone may read buildElections for the predicted clone to build the Governor's election/hat/Gate batch. Execution belongs to the Governor; that equity integration is parked and current Board operations do not request this batch." },
    { record: "function:installer.PAYOUT_ROLE_KEY", rule: "uncalled-function", why: "Anyone may inspect PAYOUT_ROLE_KEY while auditing a money install. buildMoney embeds the role key internally, so product callers ask for its batch rather than reading the constant separately." },
    { record: "function:installer.agreements", rule: "uncalled-function", why: "Anyone may inspect agreements after Installer deployment to audit the shared Agreements address. Product uses the deployment registry; no install operation discovers it through this immutable getter." },
    { record: "function:installer.budgets", rule: "uncalled-function", why: "Anyone may inspect budgets after deployment to audit the payout role's sole member. buildMoney embeds this address; product uses its returned batch, not a separate wiring read." },
    { record: "function:installer.captableImplementation", rule: "uncalled-function", why: "Anyone may inspect captableImplementation when auditing the equity clone template after deployment. Equity is parked and deployEquity uses it internally; no active operation reads this template getter." },
    { record: "function:installer.electionsImplementation", rule: "uncalled-function", why: "Anyone may inspect electionsImplementation to audit the Hats Election Eligibility template after deployment. Its deploy/build helpers are outside the current product path, so no operation discovers this template through its getter." },
    { record: "function:installer.escrowFactory", rule: "uncalled-function", why: "Anyone may inspect escrowFactory after deployment to audit the address passed to Exits.initialize. Exits/equity is parked; active general-escrow payments use their own factory record rather than Installer discovery." },
    { record: "function:installer.exitsImplementation", rule: "uncalled-function", why: "Anyone may inspect exitsImplementation after deployment to audit the exit clone template. Equity exits are parked; no active product operation reads this template address." },
    { record: "function:installer.fallbackHandler", rule: "uncalled-function", why: "Anyone may inspect fallbackHandler while auditing a company install's replacement of the 4337 handler. buildMoney embeds it internally; the existing setup asks for the batch, not this getter." },
    { record: "function:installer.gateImplementation", rule: "uncalled-function", why: "Anyone may inspect gateImplementation to audit the Signer Gate template after deployment. deployMoney builds the Gate internally; no product RPC separately discovers its implementation through this getter." },
    { record: "function:installer.governorImplementation", rule: "uncalled-function", why: "Anyone may inspect governorImplementation after deployment to audit the governance clone template. Governor equity integration is parked; no active operation reads this implementation address." },
    { record: "function:installer.hats", rule: "uncalled-function", why: "Anyone may inspect hats after deployment to audit the registry used by install helpers. Product reads Hats at the deployment address and deployMoney uses the immutable internally, not this discovery getter." },
    { record: "function:installer.hatsModuleFactory", rule: "uncalled-function", why: "Anyone may inspect hatsModuleFactory after deployment to audit the factory for election modules. Election helpers use it internally; the current money setup has no separate factory-discovery read." },
    { record: "function:installer.moduleProxyFactory", rule: "uncalled-function", why: "Anyone may inspect moduleProxyFactory after deployment to audit Zodiac proxy creation. deployMoney invokes it internally; product setup calls deployMoney, not this immutable getter." },
    { record: "function:installer.multisendUnwrapper", rule: "uncalled-function", why: "Anyone may inspect multisendUnwrapper to audit the Roles MultiSend adapter during install. buildMoney embeds its registration; no product operation reads this address separately." },
    { record: "function:installer.optionsImplementation", rule: "uncalled-function", why: "Anyone may inspect optionsImplementation after deployment to audit the option clone template. Option grants are parked with equity; no active product operation queries the template." },
    { record: "function:installer.payments", rule: "uncalled-function", why: "Anyone may inspect payments after deployment to audit payout scoping. Money builders embed the immutable destination; product uses those builders and the deployment registry rather than this getter." },
    { record: "function:installer.payoutAllowanceKey", rule: "uncalled-function", why: "Anyone may call payoutAllowanceKey(token) when inspecting a token's Roles allowance key. buildAddToken/buildSetCeiling derive it internally and product ceiling reads already derive the key; no separate pure chain call is designed." },
    { record: "function:installer.rolesMastercopy", rule: "uncalled-function", why: "Anyone may inspect rolesMastercopy after deployment to audit the Zodiac Roles template. deployMoney creates the proxy internally; product setup does not query the mastercopy getter." },
    { record: "function:installer.roundsImplementation", rule: "uncalled-function", why: "Anyone may inspect roundsImplementation after deployment to audit the fundraising clone template. Rounds are parked with equity, so no active product operation queries this implementation." },
    { record: "function:installer.safe4337Module", rule: "uncalled-function", why: "Anyone may inspect safe4337Module to audit which handler buildMoney recognizes for replacement. The builder performs the check internally; product setup requests its batch, not this immutable read." },
    { record: "function:installer.shareClassImplementation", rule: "uncalled-function", why: "Anyone may inspect shareClassImplementation after deployment to audit the template passed to Captable.initialize. Share classes are parked with equity; no active product operation reads this implementation." },
    { record: "function:installer.vesting", rule: "uncalled-function", why: "Anyone may inspect vesting after deployment to audit the shared equity vesting contract. Equity is parked and active money setup does not query this vesting getter." },
    { record: "chainEvent:installer.EquityDeployed", rule: "unconsumed-chain-event", why: "Installer emits EquityDeployed after any valid deployEquity caller creates the suite. Equity setup is parked; organization money setup waits only on MoneyDeployed, with no equity deployment workflow today." },
    { record: "chainEvent:installer.ElectionsDeployed", rule: "unconsumed-chain-event", why: "Installer emits ElectionsDeployed after any valid deployElections call creates or verifies the matching first term. The Governor/equity elections installation is parked; current Board changes consume Safe/Hats effects instead of this deployment log." },
  ],
});

export const decision_contracts_escrow_boundary = defineDecision({
  id: "contracts.escrow-boundary", title: "The general escrow's getters and duplicate-payment event have no product caller",
  question: "Which members of the built general escrow does no operation call or wait on, and why?",
  options: [{ label: "index-and-act", text: "Product reads an escrow's terms from indexing's escrows table (EscrowDeployed, EscrowCreated) and acts through deploy, collect, payout, refund and canRefund; the getters stay for anyone auditing an address." }],
  chosen: "index-and-act", why: "A chain read per escrow for terms the events already carry would duplicate indexing and slow every listing.",
  source: "packages/contracts/src/money/Escrow.sol; contracts.general-escrow-built; indexing.tables-only",
  affects: [x.contract_escrow, x.contract_escrow_factory],
  stands: [
    { record: "function:escrow.CONDITION_AMOUNT_REACHED", rule: "uncalled-function", why: "Anyone may read the constant 0 after deployment. Terms builders in payments and requests set condition 0 from the book's vocabulary; no operation asks a deployed escrow what its constant is." },
    { record: "function:escrow.CONDITION_OWNER_COLLECTS", rule: "uncalled-function", why: "Anyone may read the constant 1 after deployment. Claim escrow builders set condition 1 from the book's vocabulary; no operation queries the constant from a deployed escrow." },
    { record: "function:escrow.amount", rule: "uncalled-function", why: "Anyone may read the fixed amount once deployed. Indexing records it from EscrowCreated into the escrows table, and payments and accounts read that row, so no operation calls the getter." },
    { record: "function:escrow.authority", rule: "uncalled-function", why: "Anyone may read the refund authority once deployed. EscrowDeployed and EscrowCreated carry it into indexing's escrows row, and payment cancel asks canRefund, so no operation reads the getter." },
    { record: "function:escrow.authorityKey", rule: "uncalled-function", why: "Anyone may read the authority's key (a budget id) once deployed. Indexing records it from EscrowDeployed and canRefund applies it, so no operation reads the getter itself." },
    { record: "function:escrow.bootstrapOwner", rule: "uncalled-function", why: "Anyone may read the term once deployed. Builders set it from EscrowFactory.bootstrapOwner or leave it zero, and setup and payment claim decide readiness from the owner Safe's own state, not from this getter." },
    { record: "function:escrow.condition", rule: "uncalled-function", why: "Anyone may read the condition once deployed. EscrowCreated carries it into indexing (amount_reached or owner_collects), which every reader uses instead of a chain call." },
    { record: "function:escrow.conditionMet", rule: "uncalled-function", why: "Anyone may ask before collect or payout whether the condition holds. collect and payout check it themselves and refuse with ConditionNotMet; setup collects right after the claim role makes the signer the Safe's only owner, so no operation probes it first." },
    { record: "function:escrow.documentHash", rule: "uncalled-function", why: "Anyone may read the document hash once deployed. EscrowCreated carries it into indexing, and the Payment row already holds its document, so no operation calls the getter." },
    { record: "function:escrow.jobNonce", rule: "uncalled-function", why: "Anyone may read the job nonce once deployed. It is the Payment's own nonce, set by the builder that prepared the terms, so no operation needs to read it back." },
    { record: "function:escrow.kind", rule: "uncalled-function", why: "Anyone may read the payment kind once deployed. EscrowCreated carries it into indexing and the Payment holds it, so no operation calls the getter." },
    { record: "function:escrow.owner", rule: "uncalled-function", why: "Anyone may read who collects once deployed. EscrowDeployed and EscrowCreated index it as `owner`, which setup and payment claim query, so no operation reads the getter." },
    { record: "function:escrow.ownerTakesSurplus", rule: "uncalled-function", why: "Anyone may read the surplus routing once deployed. Only Exits (parked equity) sets it true; Capxul's builders always set false and no product reader needs it, so the escrows table omits it." },
    { record: "function:escrow.paymentId", rule: "uncalled-function", why: "Anyone may read the payment id once deployed, and the factory reads it for EscrowDeployed. Payments predicts the same id with EscrowFactory.predictPaymentId before anything exists, so no operation reads it from the escrow." },
    { record: "function:escrow.payments", rule: "uncalled-function", why: "Anyone may read the Payments router bound into the escrow. Capxul knows its deployment's Payments from the deployment file and the address binds it, so no operation discovers it from an escrow." },
    { record: "function:escrow.sender", rule: "uncalled-function", why: "Anyone may read where a refund goes once deployed. Indexing records `sender` from both events and payment cancel reads canRefund, so no operation calls the getter." },
    { record: "function:escrow.token", rule: "uncalled-function", why: "Anyone may read the token once deployed. EscrowCreated carries it into indexing, and the Payment holds its asset, so no operation calls the getter." },
    { record: "function:escrow-factory.bootstrapOwner", rule: "uncalled-function", why: "Anyone may read the chain's Companies House from the factory. Exits reads it inside its terms builder; Capxul's builders take Companies House from the deployment file they already use for the claimer, so no operation calls it." },
    { record: "function:escrow-factory.payments", rule: "uncalled-function", why: "Anyone may read the factory's Payments, which every escrow's address binds. Capxul uses its deployment's Payments address directly, so no operation discovers it from the factory." },
    { record: "chainEvent:escrow.InvoicePaymentCompleted", rule: "unconsumed-chain-event", why: "Anyone calling payout on an invoice escrow whose payment id was already paid through Payments emits it as the escrow closes Paid and returns its balance to the sender. Indexing marks the escrows row paid from it (a table write); the Payment already settled on the earlier PaymentSent, so no workflow waits on it." },
  ],
});

export const decision_contracts_general_factory_boundary = defineDecision({
  id: "contracts.general-factory-boundary", title: "General factory discovery is indexing, not a durable reaction",
  question: "Does general EscrowDeployed need its own workflow?",
  options: [{ label: "index", text: "Keep the deployment event for discovery; product lifecycles consume the escrow's terms and payment/refund events." }],
  chosen: "index", why: "Deploying counterfactual code is not itself a money movement or another long-lived business process.",
  source: "contracts.general-escrow-built; packages/contracts/src/money/EscrowFactory.sol; indexing.tables-only",
  affects: [x.contract_escrow_factory],
  stands: [{ record: "chainEvent:escrow-factory.EscrowDeployed", rule: "unconsumed-chain-event", why: "The designed general factory emits EscrowDeployed when anyone first deploys the terms/salt, before or after funding. It makes the address discoverable to indexing; payment/invoice workflows follow EscrowCreated and payment/refund facts, not a separate deployment-triggered process." }],
});

export const decision_contracts_hats_boundary = defineDecision({
  id: "contracts.hats-boundary", title: "Hat creation is metadata; ownership changes drive product waits",
  question: "Does HatCreated need a durable product consumer?",
  options: [{ label: "index", text: "Keep HatCreated as metadata for the indexer. Product authority follows wearers and live hat reads." }],
  chosen: "index", why: "A new empty hat gives nobody authority; a distinct creation workflow would add no business effect.",
  source: "packages/contracts/src/interfaces/external/IHats.sol; packages/contracts/src/authority/InstallerMoney.sol; indexing.tables-only",
  affects: [x.contract_hats],
  stands: [{ record: "chainEvent:hats.HatCreated", rule: "unconsumed-chain-event", why: "Hats emits HatCreated when an authorised admin creates a child hat (Installer also creates office/Director hats during deployment). Indexing may retain its metadata; product waits use TransferSingle for wearers and viewHat for live configuration, not a separate empty-hat creation reaction." }],
});

export const decision_contracts_safe_boundary = defineDecision({
  id: "contracts.safe-boundary", title: "Safe hash approvals are indexed evidence, not proposal completion",
  question: "Does every Director hash approval wake a durable process?",
  options: [{ label: "index", text: "Retain ApproveHash in indexed approvals. The Gate counts signatures and only execution at the proposal's nonce ends its process." }],
  chosen: "index", why: "board.proposals.carry explicitly waits for execution, not intermediate approvals. Indexed approvals remain readable without a new workflow.",
  source: "blueprint/board/processes.ts (board.proposals.carry); packages/contracts/src/interfaces/external/ISafe.sol; indexing.tables-only",
  affects: [x.contract_safe],
  stands: [{ record: "chainEvent:safe.ApproveHash", rule: "unconsumed-chain-event", why: "Safe emits ApproveHash when an owner (a Director's personal Safe on a company proposal) approves a hash. Ponder records safe-approvals for reads; the Gate counts them on chain and board.proposals.carry waits for ExecutionSuccess/Failure at the nonce, not a workflow per partial approval." }],
});

export const decision_contracts_claimer_boundary = defineDecision({
  id: "contracts.claimer-boundary", title: "Personal Safe setup names the claim log it already waits to index",
  question: "Which existing process consumes CapxulSafeClaimed?",
  options: [{ label: "link", text: "Name CapxulSafeClaimed on accounts.setup.personal-safe's claim-indexed wait, which already reads that claim block." }],
  chosen: "link", why: "The service role delegatecalls claim through Companies House, swaps the bootstrap owner, and setup waits for that exact transaction's indexed claim before becoming claimed.",
  source: "packages/contracts/src/companies-house/CompaniesHouseClaimer.sol; blueprint/accounts/processes.ts",
  affects: [x.contract_companies_house_claimer],
});
