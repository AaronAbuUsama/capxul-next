// org.member.grant: a permission is a Director proposal (org.member.grant 1). The proposal is a company Safe
// transaction at its next nonce (./proposal.ts): the permission's officer hat minted to the member's Safe, after one
// more seat when every seat is worn (claim 5). Everything is read live from the chain and checked before anything is
// written.
import { Errors, type Organizations as Ops } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import * as PgClient from "@effect/sql-pg/PgClient";
import { encodeFunctionData } from "viem";
import { open } from "../approvals/store.ts";
import { Cast } from "../cast/Cast.ts";
import { HATS } from "../chain/abi.ts";
import { readContract } from "../chain/calls.ts";
import { SEEDED } from "../chain/seeded.ts";
import { emitDeclared } from "../record/emit.ts";
import { caller } from "./caller.ts";
import { newId } from "./ids.ts";
import { proposeToDirectors } from "./proposal.ts";
import * as Store from "./store.ts";
import { hex } from "../chain/hex.ts";
import { belongs } from "../people/roster.ts";

type Grant = typeof Ops.memberGrant.rpc.payloadSchema.Type;
type Granted = typeof Ops.memberGrant.rpc.successSchema.Type;

/** The hat's calls: one more seat when every seat is worn, then the mint to the member's Safe. */
const hatCalls = Effect.fn("org.member.grant.hat")(function* (hat: bigint, wearer: string) {
  const [, maxSupply, supply] = yield* readContract({
    address: SEEDED.hats,
    abi: HATS,
    functionName: "viewHat",
    args: [hat],
  });
  const mint = {
    to: SEEDED.hats,
    data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [hat, hex(wearer)] }),
  };
  if (supply < maxSupply) return [mint];
  const seat = {
    to: SEEDED.hats,
    data: encodeFunctionData({ abi: HATS, functionName: "changeHatMaxSupply", args: [hat, supply + 1] }),
  };
  return [seat, mint];
});

export const orgMemberGrant = Effect.fn("org.member.grant.propose")(function* (grant: Grant) {
  const sql = yield* PgClient.PgClient;
  const cast = yield* Cast;
  const who = yield* caller;
  const found = yield* Store.byOrg(grant.org);
  // A company whose setup has not landed has no Board on the chain to propose to.
  if (Option.isNone(found) || found.value.setup !== "ready") return yield* Errors.OrgNotFound.make({ org: grant.org });
  const organization = found.value;
  if (!who.person || !Arr.contains(organization.directors, who.name))
    return yield* Errors.NotADirector.make({ org: grant.org, person: who.name });
  // A member who joined by an invitation is a member like a founding one (src/people/roster.ts).
  if (!(yield* belongs(organization, grant.member)))
    return yield* Errors.NotAMember.make({ org: grant.org, person: grant.member });
  const member = yield* cast.find(grant.member);
  const memberSafe = Option.getOrNull(Option.flatMap(member, (each) => Option.fromNullishOr(each.safe)));
  if (memberSafe === null) return yield* Errors.MemberHasNoSafe.make({ org: grant.org, person: grant.member });
  const hat = BigInt(organization.deployment.officerHats[grant.permission]);
  const wears = yield* readContract({
    address: SEEDED.hats,
    abi: HATS,
    functionName: "isWearerOfHat",
    args: [hex(memberSafe), hat],
  });
  if (wears)
    return yield* Errors.AlreadyHeld.make({ org: grant.org, person: grant.member, permission: grant.permission });
  const waiting = yield* Store.waitingFor(grant.org, grant.member);
  if (Option.isSome(waiting))
    return yield* Errors.ChangeWaiting.make({ org: grant.org, person: grant.member, change: waiting.value });

  const proposed = yield* proposeToDirectors(organization, yield* hatCalls(hat, memberSafe));
  const { nonce, approvals } = proposed;
  const change = yield* newId("chg");
  const proposal = yield* newId("prp");
  const answer: Granted = {
    change: { id: change, member: grant.member, permission: grant.permission, state: "proposed" },
    proposal: { id: proposal, nonce, threshold: organization.threshold },
    approvals: Arr.map(approvals, (each) => Struct.omit(each, ["signerSafe"])),
  };
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* Store.insertChange({
        change,
        org: grant.org,
        member: grant.member,
        permission: grant.permission,
        note: grant.note,
        proposal,
        nonce,
      });
      yield* open({
        subject: { kind: "officer_change", id: change },
        org: grant.org,
        threshold: organization.threshold,
        needs: null,
        spends: null,
        landing: proposed.landing,
        about: null,
        approvals,
      });
      yield* emitDeclared("org.member.grant", grant, answer);
    }),
  );
  return answer;
});
