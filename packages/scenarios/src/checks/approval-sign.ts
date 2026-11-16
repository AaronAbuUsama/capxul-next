// The checks of every approval.sign (claims.md, approval.sign 1 to 5, org.create 3, org.member.grant 1, and board's
// org.director.add 1 and org.threshold.set 1): a signature short of the threshold is kept and records only
// approval_signed; the last one needed sends one transaction, which is in the chain and did not revert, and records
// approval_signed then approval_landed; a payment and a change to the Board are sent from the signer's own Safe as
// one UserOperation, and a change to the Board is never kept short of a threshold; a replay answers the same
// transaction and records nothing; a signature that does not recover the signer, an unknown approval, another
// person's, and an expired one are each refused and nothing is sent.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { isAddress, logsOf } from "../support/chain.ts";
import { millis, present, same, sameAddress } from "../support/expect.ts";
import { entriesOfCall, view, whereOf } from "../support/world.ts";
import { callerIn, callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";
import { steady } from "../support/steady.ts";

type Asking = Asked<"approval.sign">;

/** The record gains exactly these events, in order. */
const recordGains = (before: Before, events: ReadonlyArray<string>): Check =>
  check(
    `the record gains ${Arr.join(events, ", then ")}`,
    Effect.flatMap(entriesOfCall(before.head, before.where), (added) =>
      same(
        "the events the signature added",
        Arr.map(added, (each) => each.event),
        events,
      ),
    ),
  );

/** The transaction is in the chain, in the block answered, and did not revert. */
const landed = (asked: Asking, transaction: string, block: number): Check =>
  check(
    "its transaction is in the chain, in the block it answered, and did not revert",
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const sent = yield* steady(capxul.chain).transaction({ transaction }, whereOf(asked.options));
      yield* same("the transaction's status and block", [sent.status, sent.block], ["success", block]);
    }),
  );

/** The signature answered is the caller's own, of the approval asked. */
const signedBy = (asked: Asking, answer: { readonly approval: string; readonly signer: string }): Check =>
  check(
    "it is the caller's signature of the approval asked",
    same(
      "the approval and its signer",
      [answer.approval, answer.signer],
      [asked.payload.approval, callerOf(asked.options)],
    ),
  );

/**
 * A payment, and a change to the Board, are sent from the signer's own Safe as one UserOperation: a payment through
 * the Payments contract, a change to the Board by the founder's Safe, which wears the Shareholders' top hat.
 */
const ownOperation = (asked: Asking, transaction: string, before: Before, kind: "payment" | "board_change"): Check =>
  check(
    `a ${kind === "payment" ? "payment" : "change to the Board"} is sent from the signer's own Safe, as one UserOperation`,
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const signer = yield* callerIn(before, asked.options);
      const safe = yield* present(`${signer.person}'s Safe`, signer.safe);
      const sent = yield* steady(capxul.chain).transaction({ transaction }, whereOf(asked.options));
      const ops = Arr.filter(logsOf(sent.logs, "UserOperationEvent"), (log) =>
        isAddress(log.address, before.world.contracts.entryPoint),
      );
      yield* same("the transaction's UserOperations", ops.length, 1);
      for (const op of ops) yield* sameAddress("the UserOperation's sender", op.sender, safe);
      if (kind !== "payment") return;
      const payments = Arr.filter(logsOf(sent.logs, "PaymentSent"), (log) =>
        isAddress(log.address, before.world.contracts.payments),
      );
      yield* same("the transaction's PaymentSent logs", payments.length, 1);
    }),
  );

export const approvalSign = checks<"approval.sign", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, answer, before) => {
    if (answer._tag === "Collected")
      return [
        signedBy(asked, answer),
        check(
          "it is kept, short of the threshold",
          expect(
            answer.signatures >= 1 && answer.signatures < answer.threshold,
            `${answer.signatures} of ${answer.threshold} signatures kept; a signature short of the threshold`,
          ),
        ),
        check(
          "a change to the Board is never kept short of a threshold: its one signature sends it",
          expect(answer.subject.kind !== "board_change", `the board change ${answer.subject.id} was kept, not sent`),
        ),
        recordGains(before, ["approval_signed"]),
      ];
    if (answer._tag === "AlreadySent")
      return [
        check("it answers the approval asked", same("the approval", answer.approval, asked.payload.approval)),
        landed(asked, answer.transaction, answer.block),
        nothingRecorded("the replayed signature", before),
      ];
    return [
      signedBy(asked, answer),
      landed(asked, answer.transaction, answer.block),
      recordGains(before, ["approval_signed", "approval_landed"]),
      ...(answer.subject.kind === "payment" || answer.subject.kind === "board_change"
        ? [ownOperation(asked, answer.transaction, before, answer.subject.kind)]
        : []),
    ];
  },
  refusals: {
    SignatureInvalid: (asked, refused, before) => [
      check(
        "SignatureInvalid names the approval asked, the signer's address and another it recovered",
        Effect.gen(function* () {
          const signer = yield* callerIn(before, asked.options);
          yield* same("SignatureInvalid's approval", refused.approval, asked.payload.approval);
          yield* sameAddress("SignatureInvalid's expected address", refused.expected, signer.signer);
          yield* expect(!isAddress(refused.recovered, refused.expected), "the signature recovers the signer");
        }),
      ),
      nothingRecorded("the refused signature", before),
    ],
    ApprovalNotFound: (asked, refused, before) => [
      check(
        "ApprovalNotFound names the approval asked",
        same("its approval", refused.approval, asked.payload.approval),
      ),
      nothingRecorded("the refused signature", before),
    ],
    NotYourApproval: (asked, refused, before) => [
      check(
        "NotYourApproval names the approval asked and its signer, who is not the caller",
        Effect.gen(function* () {
          yield* same("NotYourApproval's approval", refused.approval, asked.payload.approval);
          yield* expect(refused.signer !== callerOf(asked.options), "NotYourApproval names the caller as its signer");
        }),
      ),
      nothingRecorded("the refused signature", before),
    ],
    ApprovalExpired: (asked, refused, before) => [
      check(
        "ApprovalExpired names the approval asked and when it expired, which the world's clock has passed",
        Effect.gen(function* () {
          yield* same("ApprovalExpired's approval", refused.approval, asked.payload.approval);
          const now = (yield* view(before.world.world)).clock.now;
          yield* expect(
            millis(refused.expiredAt) <= millis(now),
            `the approval expired at ${refused.expiredAt}, after the world's clock, ${now}`,
          );
        }),
      ),
      nothingRecorded("the refused signature", before),
    ],
  },
});
