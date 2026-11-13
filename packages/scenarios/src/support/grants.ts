// Granting a member a permission: a Director proposes it, and the Directors sign the proposal's approvals.
import type { Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { answers, findIn, same } from "./expect.ts";
import { approve } from "./signing.ts";

export type Permission = typeof Values.Permission.Type;

/** org.member.grant as `as` (dana unless said). */
export const grant = (org: string, member: string, permission: Permission, as = "dana") =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["org.member.grant"]({ org, member, permission, note: null }, { as });
  });

/** A grant signed by dana, which keeps her signature, then by eli, which executes it. Answers eli's Sent. */
export const grantSigned = (org: string, member: string, permission: Permission) =>
  Effect.gen(function* () {
    const proposed = yield* grant(org, member, permission);
    const of = (signer: string) =>
      findIn(`${signer}'s approval of the grant`, proposed.approvals, (each) => each.signer === signer);
    const kept = yield* answers("dana's signature of the grant", "Collected", approve(yield* of("dana")));
    yield* same("the grant's signatures after dana", [kept.signatures, kept.threshold], [1, 2]);
    yield* same("the subject dana signed", kept.subject, { kind: "officer_change", id: proposed.change.id });
    const sent = yield* answers("eli's signature of the grant", "Sent", approve(yield* of("eli")));
    yield* same("the subject eli's signature sent", sent.subject, kept.subject);
    return { proposed, kept, sent };
  });
