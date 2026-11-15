// org.budget.create: a budget is a Directors' proposal (decisions.md, 53). The proposal is one company Safe transaction
// (../organizations/proposal.ts): a hat for the budget made under its parent's hat, which the company Safe administers
// as the wearer of the Board's top hat; that hat minted to the holder's personal Safe, its only seat; and
// `Budgets.createChildBudget(parent, amount, hat)`, which the company Safe may call for any of its budgets. The new
// budget takes its parent's token and period. Everything is read live from the chain and checked before anything is
// written; the chain checks the room in the parent again when the transaction runs.
import { Errors, type Budgets as Ops } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import * as PgClient from "@effect/sql-pg/PgClient";
import { encodeFunctionData, parseUnits } from "viem";
import { open } from "../approvals/store.ts";
import { Cast } from "../cast/Cast.ts";
import { BUDGETS, HATS } from "../chain/abi.ts";
import { readContract } from "../chain/calls.ts";
import { hex, sameAddress } from "../chain/hex.ts";
import { SEEDED, USDC_DECIMALS } from "../chain/seeded.ts";
import { caller } from "../organizations/caller.ts";
import { newId } from "../organizations/ids.ts";
import { proposeToDirectors } from "../organizations/proposal.ts";
import * as Organizations from "../organizations/store.ts";
import { belongs } from "../people/roster.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import { budgetOf, periodOf, usdc } from "./chain.ts";
import { insertCreation, waitingUnder } from "./store.ts";

type Creating = typeof Ops.create.rpc.payloadSchema.Type;
type Created = typeof Ops.create.rpc.successSchema.Type;

/** A budget's hat on the chain: what it says of itself. Never the budget's name, which stays off the chain. */
const HAT_DETAILS = "Budget";

/**
 * The id the chain gives the new hat under `parentHat`: the next of its children, after those of every creation still
 * waiting whose hat goes under it too, since those land first, in their nonces' order.
 */
const nextHat = Effect.fn("org.budget.create.hat")(function* (org: string, parentHat: bigint) {
  const [, , , , , , lastHatId] = yield* readContract({
    address: SEEDED.hats,
    abi: HATS,
    functionName: "viewHat",
    args: [parentHat],
  });
  const child = lastHatId + 1 + (yield* waitingUnder(org, parentHat.toString()));
  if (child > 0xffff) return yield* Effect.die(`hat ${parentHat} has no room for another child`);
  return yield* readContract({
    address: SEEDED.hats,
    abi: HATS,
    functionName: "buildHatId",
    args: [parentHat, child],
  });
});

/** The transaction's calls: make the hat, mint it to the holder's Safe, and make the budget of it. */
const creationCalls = (company: string, parent: bigint, parentHat: bigint, hat: bigint, units: bigint, to: string) => [
  {
    to: SEEDED.hats,
    data: encodeFunctionData({
      abi: HATS,
      functionName: "createHat",
      args: [parentHat, HAT_DETAILS, 1, hex(company), hex(company), true, ""],
    }),
  },
  { to: SEEDED.hats, data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [hat, hex(to)] }) },
  {
    to: SEEDED.budgets,
    data: encodeFunctionData({ abi: BUDGETS, functionName: "createChildBudget", args: [parent, units, hat] }),
  },
];

export const budgetCreate = Effect.fn("org.budget.create.propose")(function* (asked: Creating) {
  const sql = yield* PgClient.PgClient;
  const cast = yield* Cast;
  const who = yield* caller;
  const found = yield* Organizations.byOrg(asked.org);
  // A company whose setup has not landed has no Board and no budget on the chain to propose to.
  if (Option.isNone(found) || found.value.setup !== "ready") return yield* Errors.OrgNotFound.make({ org: asked.org });
  const organization = found.value;
  if (!who.person || !Arr.contains(organization.directors, who.name))
    return yield* Errors.NotADirector.make({ org: asked.org, person: who.name });
  if (!(yield* belongs(organization, asked.holder)))
    return yield* Errors.NotAMember.make({ org: asked.org, person: asked.holder });
  const holder = yield* cast.find(asked.holder);
  const holderSafe = Option.getOrNull(Option.flatMap(holder, (each) => Option.fromNullishOr(each.safe)));
  if (holderSafe === null) return yield* Errors.MemberHasNoSafe.make({ org: asked.org, person: asked.holder });
  const parentId = BigInt(asked.parent);
  const held = yield* budgetOf(parentId, organization.safe);
  if (Option.isNone(held)) return yield* Errors.BudgetNotFound.make({ org: asked.org, budget: asked.parent });
  const parent = held.value;
  if (!sameAddress(parent.token, SEEDED.usdc)) return yield* Effect.die(`budget ${parentId} is in ${parent.token}`);
  const units = parseUnits(asked.amount, USDC_DECIMALS);
  if (units > parent.left)
    return yield* Errors.ExceedsParent.make({
      org: asked.org,
      parent: asked.parent,
      left: usdc(parent.left),
      amount: asked.amount,
    });

  const hat = yield* nextHat(asked.org, parent.hat);
  const proposed = yield* proposeToDirectors(
    organization,
    creationCalls(organization.safe, parentId, parent.hat, hat, units, holderSafe),
  );
  const creation = yield* newId("bcr");
  const proposal = yield* newId("prp");
  const answer: Created = {
    creation: {
      id: creation,
      org: asked.org,
      parent: asked.parent,
      name: asked.name,
      holder: asked.holder,
      asset: "USDC",
      period: yield* periodOf(parent.period),
      amount: asked.amount,
      state: "proposed",
    },
    proposal: { id: proposal, nonce: proposed.nonce, threshold: organization.threshold },
    approvals: Arr.map(proposed.approvals, (each) => Struct.omit(each, ["signerSafe"])),
  };
  const now = yield* worldNow;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* insertCreation({
        creation,
        org: asked.org,
        parent: asked.parent,
        parent_hat: parent.hat.toString(),
        name: asked.name,
        holder: asked.holder,
        amount: units.toString(),
        hat: hat.toString(),
        proposal,
        nonce: proposed.nonce,
        proposed_ms: now.timestampMs,
      });
      yield* open({
        subject: { kind: "budget_creation", id: creation },
        org: asked.org,
        threshold: organization.threshold,
        needs: null,
        spends: null,
        landing: proposed.landing,
        about: null,
        approvals: proposed.approvals,
      });
      yield* emitDeclared("org.budget.create", asked, answer);
    }),
  );
  return answer;
});
