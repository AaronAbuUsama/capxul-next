import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { integration_bundler, contract_safe_4337_module, contract_entry_point } from "../shared/external.ts";
import { error_PROVIDER_ERROR } from "../shared/vocabulary.ts";
import { machine_approval } from "./data.ts";
import { operation_payment_send } from "../payments/operations.ts";

export const decision_approvals_verified_sponsorship = defineDecision({
  id: "approvals.verified-sponsorship",
  title: "Verify sponsorship bounds on the deployed paymaster before signing",
  question: "How does a sponsor adapter establish authority and time bounds when ERC-7677 does not standardize paymasterData encoding?",
  options: [
    { label: "contract-validation", text: "Read the deployed Safe owner, module and nonce; request stub, estimate and final data; call the configured paymaster's validation from EntryPoint and require its explicit requested window using an injected canonical world clock, never host time. Compare local SafeOp and UserOperation hashes with the deployed contracts." },
    { label: "trust-json", text: "Trust gateway metadata and a locally guessed paymasterData window without validating the final operation on chain." },
  ],
  chosen: "contract-validation",
  why: "The signing decision must bind the actual ordered calls, lossless uint256 nonce and explicit validity bounds, not a gateway's description. The deployed single-owner Safe must enable the configured Safe4337Module, whose supported EntryPoint must match. The owner cannot still be the deployment's claim owner. ERC-7677 context requests validAfter and validUntil in seconds: round the start up and deadline down. Final paymaster validation must return authorizer zero and exactly those nonzero bounds; an accept-all mock, unsupported window, malformed answer or differing digest fails closed. Validation is an eth_call from EntryPoint, with no persisted write. Simulation reverts retain the shared budget, balance and authority refusal mapping. Only the named Budgets, token, Roles and Gate reverts carry their codes; Error(string), Panic, unnamed reverts and a node's revert without data (execution reverted, or an empty return such as from a sender that is not a Safe) are TRANSACTION_FAILED, which is final. Expiry is never a refusal: when the canonical clock leaves less than one whole second of window, before or during sponsorship, the adapter answers expired and sponsors nothing, and the carrier routes it to the approval's lapse at the window's end plus grace, whose nonce guard decides expired (an unmoved nonce, so nothing was sent) or the indexed event's ending (a replacement whose inherited nonce moved). WRONG_STATE as a sponsorship refusal is only BudgetIsClosed. Dates that form no window, including a start at or before the epoch, are INVALID_INPUT. An outage, a node's internal error, missing header or gas cap, an invalid gateway body or a throttled or banned answer (ERC-7769 -32504) is PROVIDER_ERROR, which the carrier retries within approvals.lifecycle.carry's bounded retries and its window timer, and never stores as a refusal. This adapter does not prove staging policy conformance without a real configured signed gateway, nor implement send retries or service-key execution.",
  source: "ERC-7677; Safe4337Module 0.3.0 getOperationHash and SUPPORTED_ENTRYPOINT; EntryPoint v0.7 IPaymaster.validatePaymasterUserOp; integrations.sponsor-refusals",
  affects: [integration_bundler, contract_safe_4337_module, contract_entry_point, error_PROVIDER_ERROR, machine_approval.t.expire, operation_payment_send],
});
