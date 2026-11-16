// How the journeys sign: each signer signs an approval's digest with their own key (support/signing.ts), and a
// Directors' proposal is signed by dana, whose signature is kept, then by eli, whose signature sends it.
import type { Values } from "@capxul/blueprint";
import { Cast } from "../cast.ts";
import type { Payload } from "../client.ts";
import * as Effect from "effect/Effect";
import type { Tries } from "../tries.ts";
import { findIn, same } from "../support/expect.ts";
import { signWith } from "../support/signing.ts";
import type { Approval } from "../support/world.ts";

/** approval.sign's payload: `approval` signed with its signer's own key, or with the key at `by`. */
export const sign = (approval: Approval, by: string = approval.signerAddress) =>
  Effect.map(signWith(by, approval.digest), (signature): Payload<"approval.sign"> => ({
    approval: approval.id,
    signature,
  }));

/** The approval of `signer` among `approvals`. */
export const approvalOf = (approvals: ReadonlyArray<Approval>, signer: string) =>
  findIn(`${signer}'s approval`, approvals, (each) => each.signer === signer);

/** What a Directors' proposal authorises. */
export type Subject = typeof Values.Subject.Type;

/** A subject proposed to the Directors: dana's signature is kept, 1 of 2; eli's sends it. Answers eli's Sent. */
export const signedByDirectors = (op: Tries<"approval.sign">, approvals: ReadonlyArray<Approval>, subject: Subject) =>
  Effect.gen(function* () {
    const cast = yield* Cast;
    const kept = yield* op.answers("Collected", yield* sign(yield* approvalOf(approvals, cast.dana)), {
      as: cast.dana,
    });
    yield* same(
      `the ${subject.kind} after dana's signature`,
      [kept.signatures, kept.threshold, kept.subject],
      [1, 2, subject],
    );
    const sent = yield* op.answers("Sent", yield* sign(yield* approvalOf(approvals, cast.eli)), { as: cast.eli });
    yield* same("the subject eli's signature sent", sent.subject, kept.subject);
    return sent;
  });

/** An officer change proposed to the Directors, signed by dana then eli. Answers eli's Sent. */
export const signedByBoard = (op: Tries<"approval.sign">, approvals: ReadonlyArray<Approval>, change: string) =>
  signedByDirectors(op, approvals, { kind: "officer_change", id: change });
