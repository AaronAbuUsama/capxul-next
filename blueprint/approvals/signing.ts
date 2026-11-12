// The approvals concept's signing area: what the signer does with an approval. They read it (the
// approval page, the CLI's follow, `dev approve`, every opener's flow), the page stamps the first
// open, and the signer answers with a signature or a no. Both answers are signals: they resume the
// approval's process (./processes.ts), which owns sponsorship, the one send and the chain proof.
//
// Only the approval's signer reaches an approval here. Another principal's approval, and an id that
// names nothing, get the same INVALID_INPUT `approvalId` (it names nothing the caller can see), so an
// id never tells whether an approval exists. Row-level security scopes every read to the caller's
// `person_id` (P8). Decision `approvals.signing-area`.

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_approvals } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { Address, Call, Hex, Opener, Refusal, Summary, UserOperation, machine_approval, table_approvals } from "./data.ts";

const OLD = "packages/backend/src/accounts/approvals";
const SDK = "packages/sdk/src/accounts";
const S = Schema.String;
const NullOr = Schema.NullOr;
const Instant = Schema.DateTimeUtc;

/** The approval as its signer reads it: the approval page, the CLI and the SDK all print this. */
export const ApprovalView = Schema.Struct({
  approvalId: S,
  url: S,
  state: table_approvals.fields.fields.state,
  opener: Opener,
  subjectKind: S,
  subjectId: S,
  orgId: NullOr(S),
  summary: Summary,
  network: Schema.Struct({ chainId: Schema.Int, name: S, explorerUrl: S }),
  sender: Address,
  calls: Schema.Array(Call),
  /** The Safe's owner key that must sign; null until sponsored. */
  signer: NullOr(Schema.Struct({ address: Address })),
  /** The sponsored operation; `digest` (the SafeOp hash) is the one thing the key signs. Null until sponsored. */
  operation: NullOr(
    Schema.Struct({ userOperation: UserOperation, digest: Hex, userOpHash: Hex, validAfter: NullOr(Instant), validUntil: Instant }),
  ),
  sendAfter: NullOr(Instant),
  expiresAt: Instant,
  refusal: NullOr(Refusal),
  sendError: NullOr(Refusal),
  transactionHash: NullOr(Hex),
  displacedBy: NullOr(Hex),
  createdAt: Instant,
  reviewedAt: NullOr(Instant),
  signedAt: NullOr(Instant),
  sentAt: NullOr(Instant),
  endedAt: NullOr(Instant),
});

const ApprovalId = Schema.Struct({ approvalId: S });
const SIGNER =
  "The approval's signer: the principal whose own Safe sends it, signed in as themselves (a person, or an agent with its " +
  "own key; `dev approve` signs in as the person it plays). Anyone else's approval, or an id that names nothing, is " +
  "INVALID_INPUT `approvalId`. The public transport reauthenticates and evaluates any approval gate on every call " +
  "and live frame; a disabled gate is FEATURE_NOT_AVAILABLE, without exposing another signer's row.";

export const rpc_approvals_signing_get = defineRpc({
  id: "approvals.signing.get",
  title: "Read one of your approvals, live",
  about:
    "A live query: the first frame is the approval as it stands and every transition pushes the next. The approval page " +
    "renders it; an opener's flow reads it to wait for the sponsorship (state `pending`, with the digest), to sign with an " +
    "agent's key, and to follow it to its end; `payment wait` with an `approval_…` id follows it; `dev approve` reads it " +
    "before signing. The link is SITE_URL's approval page; the network's name and explorer come from the deployment's " +
    "chain. `expiresAt` is the sponsorship's `validUntil` once sponsored, the opener's deadline before. It never sends, " +
    "signs or writes.",
  was: [`${OLD}/operations/get.ts:14`, `${OLD}/operations/observe.ts:14`, `${OLD}/views.ts:20`, `${SDK}/approval-wait.ts:1`],
  concept: concept_approvals,
  kind: "live",
  who: SIGNER,
  input: ApprovalId,
  output: ApprovalView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_FEATURE_NOT_AVAILABLE],
  reads: [table_approvals, table_feature_flags],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.approvals.signing.get"],
  budget: budget("live-read"),
});

export const rpc_approvals_signing_review = defineRpc({
  id: "approvals.signing.review",
  title: "Stamp the first time the signer opens a pending approval",
  about:
    "The approval page calls it when it opens. A `sponsoring` or `pending` approval with no `reviewed_at` is stamped now, " +
    "so an agent or CLI waiting on the person can say the page is open (`reviewedAt` in the approval's `--json`); any " +
    "later open, and an approval in any other state, answers unchanged. It changes no state.",
  was: [`${OLD}/operations/review.ts:19`, `${OLD}/writes.ts:93`],
  concept: concept_approvals,
  kind: "mutation",
  who: SIGNER,
  input: ApprovalId,
  output: ApprovalView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_FEATURE_NOT_AVAILABLE],
  reads: [table_approvals, table_feature_flags],
  writes: [table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.approvals.signing.review"],
  budget: budget("write"),
});

export const rpc_approvals_signing_sign = defineRpc({
  id: "approvals.signing.sign",
  title: "Give your signature to a pending approval",
  about:
    "The signer's yes, and the process's signal to send. The approval must be `pending` (sponsored) and its window still " +
    "open: anything earlier or ended is WRONG_STATE with its state, and an expired approval says so. A signature is 65 " +
    "bytes that recover, with no message prefix, to the stored signer over the stored digest (the SafeOp hash), else " +
    "INVALID_INPUT `signature` and nothing is kept or sent. When the approval names a gate, the gate must be on for its " +
    "Organization (or for the signer when it has none), read through access' evaluator, else FEATURE_NOT_AVAILABLE and " +
    "nothing is kept. It keeps the signature and `signed_at` and drives `sign`; the process then sends it, at once or on " +
    "its day. The same signature again, on an approval already signed or later, answers it as it stands and sends nothing " +
    "more; another signature then is WRONG_STATE. Recovering a key needs no outside call, so this is one transaction.",
  was: [
    `${OLD}/operations/approve.ts:39`,
    `${OLD}/operations/record-approval.ts:25`,
    `${OLD}/errors.ts:66`,
    "packages/backend/src/payments/executions/operations/submit-command.ts",
    `${SDK}/approvals.ts:156`,
  ],
  concept: concept_approvals,
  kind: "mutation",
  who: SIGNER,
  input: Schema.Struct({ approvalId: S, signature: Hex }),
  output: ApprovalView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: [table_approvals, table_feature_flags],
  writes: [table_approvals],
  drives: [machine_approval.t.sign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.approvals.signing.sign"],
  budget: budget("write"),
});

export const rpc_approvals_signing_decline = defineRpc({
  id: "approvals.signing.decline",
  title: "Say no to an approval before signing it",
  about:
    "The signer's no, and the process's signal to stop. A `sponsoring` or `pending` approval is declined with `ended_at`; " +
    "nothing was signed, so nothing can be sent, and the opener answers CANCELLED. A declined approval answers again " +
    "unchanged. A signed or later approval is WRONG_STATE: its signature exists, so only the chain or its window ends it, " +
    "and the opener's replacement (a void) is the way back.",
  was: [`${OLD}/operations/reject.ts:16`, `${OLD}/writes.ts:106`, `${SDK}/approvals.ts:191`],
  concept: concept_approvals,
  kind: "mutation",
  who: SIGNER,
  input: ApprovalId,
  output: ApprovalView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: [table_approvals, table_feature_flags],
  writes: [table_approvals],
  drives: [machine_approval.t.decline],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.approvals.signing.decline"],
  budget: budget("write"),
});
