// A company Safe transaction proposed to the company's Directors, as org.member.grant and org.budget.create propose
// one: a batch of plain calls (MultiSendCallOnly) at the Safe's next nonce, after every company transaction still
// waiting, and one approval per Director, each naming the digest their own Safe signs for it (EIP-1271). approval.sign
// carries it to the chain once the company Safe's threshold is signed.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { nextCompanyNonce, type Landing } from "../approvals/store.ts";
import { Cast } from "../cast/Cast.ts";
import { SAFE } from "../chain/abi.ts";
import { readContract } from "../chain/calls.ts";
import { multiSend, safeMessageDigest, safeTxHash, type Call } from "../chain/safe.ts";
import { APPROVAL_LIFETIME_MS, SEEDED } from "../chain/seeded.ts";
import { worldNow } from "../record/emit.ts";
import { instant } from "./caller.ts";
import { newId } from "./ids.ts";
import type { Organization } from "./store.ts";

/** The batch `calls` as a transaction of the company Safe at its next nonce, with an approval for each Director. */
export const proposeToDirectors = Effect.fn("org.propose")(function* (
  organization: Organization,
  calls: ReadonlyArray<Call>,
) {
  const cast = yield* Cast;
  const onChain = yield* readContract({ address: organization.safe, abi: SAFE, functionName: "nonce", args: [] });
  const nonce = yield* nextCompanyNonce(organization.org, Number(onChain));
  const tx = {
    safe: organization.safe,
    to: SEEDED.multiSendCallOnly,
    data: multiSend(calls),
    operation: 1 as const,
    nonce: BigInt(nonce),
  };
  const hash = safeTxHash(tx);
  const now = yield* worldNow;
  const expiresAt = instant(now.timestampMs + APPROVAL_LIFETIME_MS);
  const directors = yield* Effect.forEach(organization.directors, (name) =>
    Effect.flatMap(cast.find(name), (listed) =>
      Option.match(
        Option.flatMap(listed, (each) =>
          each.safe === null ? Option.none() : Option.some({ ...each, safe: each.safe }),
        ),
        {
          onNone: () => Effect.die(`the Director ${name} of ${organization.org} has no Safe`),
          onSome: Effect.succeed,
        },
      ),
    ),
  );
  const approvals = yield* Effect.forEach(directors, (director) =>
    Effect.map(newId("apr"), (id) => ({
      id,
      signer: director.person,
      signerAddress: director.signer,
      digest: safeMessageDigest(director.safe, hash),
      expiresAt,
      signerSafe: director.safe,
    })),
  );
  const landing: Landing = {
    via: "company",
    tx: { safe: tx.safe, to: tx.to, data: tx.data, operation: tx.operation, nonce: tx.nonce.toString() },
  };
  return { nonce, approvals, landing };
});
