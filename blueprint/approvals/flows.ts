// The approvals concept's Core SDK flow. Approvals owns no frozen operation (OPERATION_OWNERS gives
// it none), so its one flow serves a surface: the approval page, where a person signs in the
// browser with their Openfort signer (React SDK). Every operation that opens an approval composes
// approvals' rpcs in its own concept's flow instead (read until sponsored, sign with an agent's key
// or hand the person this page, follow to the end), and `dev approve` is devnet's flow. Declining on
// the page is one rpc (`approvals.signing.decline`), so it needs no flow.

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import { error_CAPABILITY_UNAVAILABLE, error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ApprovalView, rpc_approvals_signing_get, rpc_approvals_signing_review, rpc_approvals_signing_sign } from "./signing.ts";

const SDK = "packages/sdk/src/accounts";

export const flow_client_approvals_sign = defineFlow({
  id: "client.approvals.sign",
  title: "Sign an approval on the approval page",
  about:
    "For the approval page (React SDK), not for an operation: the page the CLI opens for every command a person signs. It " +
    "reads the approval live until it is sponsored, stamps the first open, and checks in the browser that the operation " +
    "describes its digest on this chain (the SafeOp hash of the operation and its window equals the stored digest; else " +
    "INVALID_INPUT `approval`, nothing signed). The person reads the summary and presses Approve (their wait is never " +
    "system time); the Openfort signer's address must be the approval's signer (INVALID_INPUT `signer`) and it signs the " +
    "digest with no prefix. A person who cancels the passkey prompt gets CANCELLED and the approval stays pending. The " +
    "signature goes to `approvals.signing.sign`, and the page follows the approval until it is sent or ends. A client " +
    "with no signer is CAPABILITY_UNAVAILABLE (an SDK host without a browser hands the person the link instead); an " +
    "approval that is not pending when read is WRONG_STATE with its state.",
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.approvals.sign",
  input: Schema.Struct({ approvalId: Schema.String }),
  output: ApprovalView,
  steps: [
    { name: "read", rpc: rpc_approvals_signing_get, about: "The approval, live, until it is `pending` with its digest, or ends." },
    { name: "review", rpc: rpc_approvals_signing_review, about: "Stamps the page's first open." },
    { name: "check", local: "build", about: "Recomputes the SafeOp digest from the operation, its window and the chain id, and compares it." },
    { name: "confirm", local: "wait", about: "The person reads the summary and presses Approve; Decline calls the decline rpc instead." },
    { name: "sign", local: "sign", about: "The Openfort signer's address must be the approval's signer; it signs the digest with no prefix." },
    { name: "submit", rpc: rpc_approvals_signing_sign, about: "Gives the signature; the process sends it." },
    { name: "until-sent", local: "wait", about: "The live read until the approval is sent or ends; the page keeps following to the chain." },
  ],
  errors: [error_CAPABILITY_UNAVAILABLE, error_INVALID_INPUT, error_WRONG_STATE],
  calls: [integration_openfort.c.getAddress, integration_openfort.c.signDigest],
  spans: ["sdk.client.approvals.sign"],
  budget: budget("vendor"),
  was: [`${SDK}/approvals.ts:156`, `${SDK}/approval-rules.ts:66`, `${SDK}/approval-wait.ts:1`],
});
