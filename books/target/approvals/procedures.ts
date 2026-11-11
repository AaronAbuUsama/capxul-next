// The approvals concept's door: the procedures other concepts invoke inside their own transaction.
//
// `approvals.open` is named by the architecture (rules.procedures): a chain write and the approval
// that carries it are one fact. `approvals.withdraw` is this concept's own addition, with its money
// fact in decision `approvals.withdraw-procedure`. Neither makes an outside call: the paymaster, the
// chain and the bundler are the process's (./processes.ts).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_approvals } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { Call, Need, Opener, Summary, machine_approval, table_approvals } from "./data.ts";

const OLD = "packages/backend/src";
const S = Schema.String;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

export const procedure_approvals_open = defineProcedure({
  id: "approvals.open",
  title: "Open the approval that carries an opener's chain write",
  about:
    "Money fact: a chain write and the approval that carries it are one fact. The opener births its intent (a Payment " +
    "command, a Director's approval of a proposal, an agent change, a budget change) and the approval for it in the same " +
    "transaction, so nobody can sign a chain write Capxul has no record of, and no intent waits on an approval that does " +
    "not exist. It takes the signer (a principal: a person, or an agent signing with its own key), the calls in order, the " +
    "page's summary, the opener's subject and a deadline in the future (for an operation sent at once, the paymaster " +
    "cuts it to its own window, 10 minutes on the gateway; for a dated one, the end of its signed window, three days " +
    "after its day). A deadline already past, or no call, is INVALID_INPUT. A dated operation also names the day it is " +
    "sent (`send_after`), what it needs that day (`needs`) and, for any approval, a feature gate the send needs (`gate`). " +
    "The signer's live approval of the same subject answers as it stands (`opened: false`): asking twice answers with the " +
    "same approval. The sender is always the signer's own Safe, read from access' principals (v4 D1), never the opener's word; " +
    "an unknown principal is INVALID_INPUT. A replacement (`replaces`, the void of a dated payment) must name a signed approval of the same Safe " +
    "still held for its day, and takes its nonce key and nonce, so at most one of the two can land. It writes the row " +
    "`sponsoring` with its own nonce key (keccak256 of the approval id, cut to 192 bits, never 0), and the `open` " +
    "transition's event starts its process. It answers the approval's id, its page link (SITE_URL) and its deadline.",
  concept: concept_approvals,
  input: Schema.Struct({
    person_id: S,
    org_id: NullOr(S),
    opener: Opener,
    subject_kind: S,
    subject_id: S,
    chain_id: Schema.Int,
    calls: Schema.Array(Call),
    summary: Summary,
    deadline: Schema.DateTimeUtc,
    send_after: opt(Schema.DateTimeUtc),
    needs: opt(Schema.Array(Need)),
    gate: opt(S),
    replaces: opt(S),
  }),
  output: Schema.Struct({
    approval_id: S,
    url: S,
    deadline: Schema.DateTimeUtc,
    opened: Schema.Boolean,
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_approvals, table_principals],
  writes: [table_approvals],
  drives: [machine_approval.t.open],
  invokes: [],
  emits: [],
  was: [
    `${OLD}/accounts/approvals/writes.ts:52`,
    `${OLD}/accounts/approvals/operations/request.ts:76`,
    `${OLD}/accounts/approvals/operations/open-for-proposal.ts:36`,
    `${OLD}/accounts/approvals/operations/open-for-agreement.ts:29`,
    `${OLD}/payments/executions/writes/stores.ts:78`,
    `${OLD}/payments/executions/rules.ts:146`,
  ],
});

export const procedure_approvals_withdraw = defineProcedure({
  id: "approvals.withdraw",
  title: "Withdraw an unsigned approval whose intent ended first",
  about:
    "Money fact: an intent that ended takes its unsigned carrier with it. When an opener ends the intent an approval " +
    "carries before anyone signed it (a Payment command cancelled or superseded, a proposal executed or rejected while a " +
    "Director's approval still waits, an invitation cancelled with its grant), it withdraws the approval in the same " +
    "transaction, so nobody can sign a chain write whose intent Capxul no longer records. Only a `sponsoring` or `pending` " +
    "approval is withdrawn. A signed one is not: its signature exists, so only the chain can end it, and the opener " +
    "replaces it instead (`approvals.open` with `replaces`). It answers the state the approval is left in, so the opener " +
    "knows which happened; an ended approval answers its own end unchanged. An id that names no approval of this signer " +
    "is INVALID_INPUT.",
  concept: concept_approvals,
  input: Schema.Struct({ person_id: S, approval_id: S, reason: S }),
  output: Schema.Struct({ state: table_approvals.fields.fields.state }),
  errors: [error_INVALID_INPUT],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [machine_approval.t.withdraw],
  invokes: [],
  emits: [],
  was: [
    `${OLD}/accounts/approvals/writes.ts:119`,
    `${OLD}/payments/executions/operations/abandon.ts`,
    `${OLD}/payments/executions/writes/failures.ts:33`,
  ],
});
