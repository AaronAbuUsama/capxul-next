// approval.sign: a signer's signature of the digest their approval names (decisions.md, 42), checked and kept. When it
// completes its subject (the threshold signed, the sender's owner among them) the subject is sent as one sponsored
// UserOperation through the world's bundler, and the call answers once it is in a block (decisions.md, 24). A
// signature of a subject already sent answers that transaction again and sends nothing (AlreadySent).
import { Approvals as Ops, Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { recoverAddress, zeroAddress } from "viem";
import { contractSignatures, relay } from "../chain/safe.ts";
import { send } from "../chain/userop.ts";
import { caller } from "../organizations/caller.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import { reconcile } from "../organizations/site.ts";
import { checkFunds, landed, orgOf } from "./landed.ts";
import { approvalsOf, find, keep, markSent, type ApprovalRow } from "./store.ts";
import { hex, sameAddress } from "../chain/hex.ts";

type Signing = typeof Ops.sign.rpc.payloadSchema.Type;

/** The address a signature of `digest` recovers, or the zero address when it recovers none. */
const recovered = (digest: string, signature: string) =>
  Effect.tryPromise(() => recoverAddress({ hash: hex(digest), signature: hex(signature) })).pipe(
    Effect.orElseSucceed(() => zeroAddress),
  );

/** How many of a subject's approvals are signed, counting this one, and whether `needs` signed. */
const tally = (rows: ReadonlyArray<ApprovalRow>, needs: string | null) => ({
  signatures: Arr.filter(rows, (row) => row.signature !== null).length,
  needed: needs === null || Arr.some(rows, (row) => row.signer === needs && row.signature !== null),
});

export const approvalSign = Effect.fn("approval.sign.sign")(function* (signing: Signing) {
  const sql = yield* PgClient.PgClient;
  const who = yield* caller;
  const found = yield* find(signing.approval);
  if (Option.isNone(found)) return yield* Errors.ApprovalNotFound.make({ approval: signing.approval });
  const { approval, subject: held } = found.value;
  if (!who.person || who.name !== approval.signer)
    return yield* Errors.NotYourApproval.make({ approval: approval.approval, signer: approval.signer });
  const from = yield* recovered(approval.digest, signing.signature);
  if (!sameAddress(from, approval.signer_address))
    return yield* Errors.SignatureInvalid.make({
      approval: approval.approval,
      expected: approval.signer_address,
      recovered: from,
    });
  const subject = held.subject;
  if (held.state === "sent" && held.tx !== null && held.block !== null)
    return Ops.AlreadySent.make({
      approval: approval.approval,
      subject,
      transaction: held.tx,
      block: Number(held.block),
    });
  const now = yield* worldNow;
  const expiry = DateTime.toEpochMillis(DateTime.makeUnsafe(approval.expires_at));
  if (now.timestampMs >= expiry)
    return yield* Errors.ApprovalExpired.make({ approval: approval.approval, expiredAt: approval.expires_at });

  const rows = Arr.map(yield* approvalsOf(subject.kind, subject.id), (row) =>
    row.approval === approval.approval ? { ...row, signature: signing.signature } : row,
  );
  const count = tally(rows, held.needs);
  if (count.signatures < held.threshold || !count.needed) {
    const answer = Ops.Collected.make({
      approval: approval.approval,
      signer: approval.signer,
      subject,
      signatures: count.signatures,
      threshold: held.threshold,
    });
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* keep(approval.approval, signing.signature);
        yield* emitDeclared("approval.sign", signing, answer);
      }),
    );
    return answer;
  }

  yield* checkFunds(subject);
  const owner = Arr.findFirst(rows, (row) => row.signer === held.needs && row.signature !== null);
  const receipt =
    held.landing.via === "operation"
      ? yield* send(
          held.landing.operation,
          hex(
            Option.getOrElse(
              Option.flatMapNullishOr(owner, (row) => row.signature),
              () => signing.signature,
            ),
          ),
        )
      : yield* relay(
          { ...held.landing.tx, data: hex(held.landing.tx.data), nonce: BigInt(held.landing.tx.nonce) },
          contractSignatures(
            Arr.take(
              Arr.flatMap(rows, (row) =>
                row.signer_safe === null || row.signature === null
                  ? []
                  : [{ owner: row.signer_safe, signature: hex(row.signature) }],
              ),
              held.threshold,
            ),
          ),
          `${subject.kind}:${subject.id}`,
        );
  const transaction = Str.toLowerCase(receipt.receipt.transactionHash);
  if (!receipt.success)
    return yield* Errors.TransactionReverted.make({
      approval: approval.approval,
      transaction,
      reason: receipt.reason ?? "the UserOperation's call reverted",
    });
  const block = BigInt(receipt.receipt.blockNumber);
  const answer = Ops.Sent.make({
    approval: approval.approval,
    signer: approval.signer,
    subject,
    transaction,
    block: Number(block),
  });
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* keep(approval.approval, signing.signature);
      yield* markSent(subject.kind, subject.id, transaction, block);
      yield* landed(subject, receipt);
      yield* emitDeclared("approval.sign", signing, answer);
    }),
  );
  // The company's site is told what landed now if it is ready; if not, the next read of the world's companies does.
  yield* Effect.flatMap(orgOf(subject), (org) => (Option.isSome(org) ? reconcile(org.value) : Effect.void)).pipe(
    Effect.catchCause((cause) => Effect.logWarning("the site could not be moved on", cause)),
  );
  return answer;
});
