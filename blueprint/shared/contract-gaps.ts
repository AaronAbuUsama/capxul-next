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

export const decision_contracts_escrow_factory_v4_boundary = defineDecision({
  id: "contracts.escrow-factory-v4-boundary", title: "The built v4 factory remains distinct from the general escrow design",
  question: "Why has the built v4 factory no product caller?",
  options: [{ label: "retain", text: "Retain the built ABI while product operations target the designed general factory (contracts.general-escrow-not-built)." }],
  chosen: "retain", why: "Binding general-escrow operations to v4 would silently lose authority and surplus terms.",
  source: "packages/contracts/src/money/EscrowFactory.sol; contracts.general-escrow-not-built",
  affects: [x.contract_escrow_factory_v4],
  stands: [
    { record: "function:escrow-factory-v4.bootstrapOwner", rule: "uncalled-function", why: "Anyone may inspect bootstrapOwner for the v4 claim check after deployment. Product builds general-escrow terms instead; it does not discover claim authority from this legacy factory." },
    { record: "function:escrow-factory-v4.deploy", rule: "uncalled-function", why: "Anyone may deploy exact v4 terms and salt, idempotently, before or after funding. Product workflows target the general factory with authority terms; this built factory remains for v4 compatibility, not those calls." },
    { record: "function:escrow-factory-v4.payments", rule: "uncalled-function", why: "Anyone may inspect payments to audit which Payments contract newly created v4 escrows use. General-escrow product workflows do not discover wiring from the v4 factory." },
    { record: "function:escrow-factory-v4.predictAddress", rule: "uncalled-function", why: "Anyone may call predictAddress with valid v4 terms/salt before funding to derive its CREATE2 address. Product funding uses the general factory's different terms and prediction, never this incompatible address." },
    { record: "function:escrow-factory-v4.predictPaymentId", rule: "uncalled-function", why: "Anyone may call predictPaymentId before signing a v4 payment; a claim uses the predicted escrow as executor. Product predicts ids with the general factory instead, so it has no direct v4 prediction call." },
    { record: "chainEvent:escrow-factory-v4.EscrowDeployed", rule: "unconsumed-chain-event", why: "The v4 factory emits EscrowDeployed when any caller first deploys its terms/salt. Product lifecycle waits reference the general escrow's events; no v4-specific deployment reaction is designed while that replacement remains unbuilt." },
  ],
});

export const decision_contracts_escrow_v4_boundary = defineDecision({
  id: "contracts.escrow-v4-boundary", title: "The built v4 escrow is retained, not substituted for the general design",
  question: "Why do built v4 escrow members have no direct product callers or waits?",
  options: [{ label: "retain", text: "Keep v4 compatibility visible. General-escrow product calls keep their own terms and event shapes until the replacement is built." }],
  chosen: "retain", why: "v4 has payer-only refund and a different claim/surplus model; linking it to general escrow workflows would claim unsupported behaviour.",
  source: "packages/contracts/src/money/Escrow.sol; contracts.general-escrow-not-built",
  affects: [x.contract_escrow_v4],
  stands: [
    { record: "function:escrow-v4.CONDITION_INVOICE_AMOUNT_REACHED", rule: "uncalled-function", why: "Anyone may read CONDITION_INVOICE_AMOUNT_REACHED to inspect v4's condition-0 tag. Product builders use the general escrow vocabulary, not a v4 constant query." },
    { record: "function:escrow-v4.CONDITION_PAYEE_CLAIMED", rule: "uncalled-function", why: "Anyone may read CONDITION_PAYEE_CLAIMED to inspect v4's condition-1 tag. General escrow product calls do not query this legacy claim-condition constant." },
    { record: "function:escrow-v4.amount", rule: "uncalled-function", why: "Anyone may read amount after v4 deployment to inspect the fixed payout. Product escrow reads target general escrow/indexed terms rather than this v4 getter." },
    { record: "function:escrow-v4.bootstrapOwner", rule: "uncalled-function", why: "Anyone may read bootstrapOwner after v4 deployment to identify the Companies House owner whose absence proves a claim. Product uses the general escrow's per-escrow bootstrap term instead of this legacy getter." },
    { record: "function:escrow-v4.collect", rule: "uncalled-function", why: "Only payeeSafe may collect a funded open v4 condition-1 escrow after its owners exclude Companies House. Product payment-claim/setup calls target general Escrow.collect; v4 compatibility is retained but not used as its replacement." },
    { record: "function:escrow-v4.condition", rule: "uncalled-function", why: "Anyone may inspect condition after v4 deployment to distinguish invoice and claim. Product general-escrow readers use their own indexed terms, not this v4 getter." },
    { record: "function:escrow-v4.conditionMet", rule: "uncalled-function", why: "Anyone may call conditionMet before v4 payout/collect: invoice balance or an exact false isOwner(bootstrapOwner) answer. v4 payout uses it internally; product follows the general escrow design, not this legacy probe." },
    { record: "function:escrow-v4.documentHash", rule: "uncalled-function", why: "Anyone may inspect documentHash after v4 deployment to identify its payment document. Product reads general escrow terms and payment records, not the legacy escrow getter." },
    { record: "function:escrow-v4.jobNonce", rule: "uncalled-function", why: "Anyone may inspect jobNonce to audit a deployed v4 payment's identity. Product command identity is built for the general escrow; no operation reads this legacy nonce getter." },
    { record: "function:escrow-v4.kind", rule: "uncalled-function", why: "Anyone may inspect kind after v4 deployment, including kind 8 for an exit-labelled payment. Product uses general terms; parked exit claims do not add a caller to this legacy getter." },
    { record: "function:escrow-v4.ownerSafe", rule: "uncalled-function", why: "Anyone may inspect ownerSafe after v4 deployment to identify the payer/refund recipient. Product's general escrow calls name sender instead; they do not query this differently named v4 role." },
    { record: "function:escrow-v4.payeeSafe", rule: "uncalled-function", why: "Anyone may inspect payeeSafe after v4 deployment to identify the recipient allowed to collect. Product general-escrow ownership reads do not query this legacy payee getter." },
    { record: "function:escrow-v4.paymentId", rule: "uncalled-function", why: "Anyone may read paymentId after v4 deployment, and the v4 factory reads it internally for EscrowDeployed. Product predicts/tracks the general escrow's id instead, not a direct v4 read." },
    { record: "function:escrow-v4.payments", rule: "uncalled-function", why: "Anyone may inspect payments after v4 deployment to audit its immutable payment router. Product uses the deployment's Payments and general escrow, so no legacy-router discovery call is designed." },
    { record: "function:escrow-v4.payout", rule: "uncalled-function", why: "Anyone may payout an open v4 condition-0 invoice once funded; an already-paid id closes and returns the balance. Product invoice workflows target the general Escrow.payout, not this retained v4 entry point." },
    { record: "function:escrow-v4.refund", rule: "uncalled-function", why: "Only ownerSafe may refund a v4 claim before collection, an open invoice while short, or a later deposit after closure. Product requires general escrow's sender/authority refund model, so no operation is linked to this payer-only fallback." },
    { record: "function:escrow-v4.state", rule: "uncalled-function", why: "Anyone may inspect state after v4 deployment for Open/Paid/Refunded. Product status reads and waits follow the general escrow record instead of a v4 state query." },
    { record: "function:escrow-v4.token", rule: "uncalled-function", why: "Anyone may inspect token after v4 deployment to identify what it holds. Product general-escrow terms/indexing provide the token without querying this legacy instance." },
    { record: "chainEvent:escrow-v4.EscrowCreated", rule: "unconsumed-chain-event", why: "A v4 deployment by any factory caller emits EscrowCreated with eight term fields. Product workflows consume the general ten-field EscrowCreated with authority, not this incompatible legacy creation event." },
    { record: "chainEvent:escrow-v4.EscrowPaid", rule: "unconsumed-chain-event", why: "Successful v4 payout by anyone or collect by payeeSafe emits EscrowPaid beside PaymentSent. Product escrow waits use the general event's owner/sender roles, not v4 payer/payee roles; no separate v4 workflow is designed." },
    { record: "chainEvent:escrow-v4.EscrowRefunded", rule: "unconsumed-chain-event", why: "A v4 ownerSafe refund emits EscrowRefunded, including later-deposit recovery, without a by field or payee. Product waits require the general sender/by refund event; consuming this one would lose who exercised authority." },
    { record: "chainEvent:escrow-v4.InvoicePaymentCompleted", rule: "unconsumed-chain-event", why: "Anyone calling v4 payout after the invoice id was already paid causes InvoicePaymentCompleted and returns the balance to ownerSafe. Product invoice completion follows PaymentSent and the general escrow design; no legacy duplicate-payment cleanup workflow is specified." },
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

export const decision_contracts_general_factory_boundary = defineDecision({
  id: "contracts.general-factory-boundary", title: "General factory discovery is indexing, not a durable reaction",
  question: "Does general EscrowDeployed need its own workflow?",
  options: [{ label: "index", text: "Keep the deployment event for discovery; product lifecycles consume the escrow's terms and payment/refund events." }],
  chosen: "index", why: "Deploying counterfactual code is not itself a money movement or another long-lived business process.",
  source: "contracts.general-escrow-not-built; packages/contracts/src/money/EscrowFactory.sol (v4 precursor); indexing.tables-only",
  affects: [x.contract_escrow_factory],
  stands: [{ record: "chainEvent:escrow-factory.EscrowDeployed", rule: "unconsumed-chain-event", why: "The designed general factory emits EscrowDeployed when anyone first deploys the terms/salt, before or after funding. It makes the address discoverable to indexing; payment/invoice workflows follow EscrowCreated and payment/refund facts, not a separate deployment-triggered process. The general factory is not built yet." }],
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
