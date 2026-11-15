// org.director.list, org.director.add and org.threshold.set: a company's Board, read from the chain, and the two
// changes its founder makes to it. Every refusal is checked from Core's records before the chain is read, then the
// Board, the Director hat's seats and the founder's UserOperation are read and prepared live (src/board/propose.ts).
import { type Board as Ops, Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Cast } from "../cast/Cast.ts";
import { sameAddress } from "../chain/hex.ts";
import { multiSend } from "../chain/safe.ts";
import { SEEDED } from "../chain/seeded.ts";
import { caller } from "../organizations/caller.ts";
import { belongs } from "../people/roster.ts";
import { ownersOf, seatCalls, seatsOf, thresholdCall } from "./calls.ts";
import { boardNow, companyOf, founderOnly, nothingWaiting, propose } from "./propose.ts";

type Listing = typeof Ops.directorList.rpc.payloadSchema.Type;
type Adding = typeof Ops.directorAdd.rpc.payloadSchema.Type;
type Setting = typeof Ops.thresholdSet.rpc.payloadSchema.Type;

/** The gas the founder's Safe may use to seat a Director, and to set the threshold. */
const SEAT_GAS = 1_500_000n;
const THRESHOLD_GAS = 1_000_000n;

/** A person's claimed personal Safe, if they have one. */
const safeOf = (person: string) =>
  Effect.map(
    Effect.flatMap(Cast, (cast) => cast.find(person)),
    (found) => Option.getOrNull(Option.flatMapNullishOr(found, (each) => each.safe)),
  );

export const directorList = Effect.fn("org.director.list.read")(function* (listing: Listing) {
  const who = yield* caller;
  const organization = yield* companyOf(listing.org);
  // The world's owner sees the whole world; a person sees only a company they belong to.
  if (who.person && !(yield* belongs(organization, who.name)))
    return yield* Errors.NotAMember.make({ org: listing.org, person: who.name });
  const board = yield* ownersOf(organization.safe);
  // Core's Directors give the order, the founder first and then each as seated; the chain says who signs.
  const known = yield* Effect.forEach(organization.directors, (person) =>
    Effect.flatMap(safeOf(person), (safe) =>
      safe === null
        ? Effect.die(`the Director ${person} of ${listing.org} has no Safe`)
        : Effect.succeed({ person, safe }),
    ),
  );
  const directors = Arr.filter(known, (each) => Arr.some(board.owners, (owner) => sameAddress(owner, each.safe)));
  if (directors.length !== board.owners.length)
    return yield* Effect.die(`the company Safe of ${listing.org} has an owner Core does not know as a Director`);
  return {
    org: listing.org,
    directorHat: organization.deployment.directorHat,
    threshold: board.threshold,
    directors,
  };
});

export const directorAdd = Effect.fn("org.director.add.propose")(function* (adding: Adding) {
  const organization = yield* companyOf(adding.org);
  yield* founderOnly(organization);
  if (!(yield* belongs(organization, adding.person)))
    return yield* Errors.NotAMember.make({ org: adding.org, person: adding.person });
  const wearer = yield* safeOf(adding.person);
  if (wearer === null) return yield* Errors.MemberHasNoSafe.make({ org: adding.org, person: adding.person });
  if (Arr.contains(organization.directors, adding.person))
    return yield* Errors.AlreadyADirector.make({ org: adding.org, person: adding.person });
  yield* nothingWaiting(adding.org);

  const before = yield* boardNow(organization);
  const hat = BigInt(organization.deployment.directorHat);
  const seats = yield* seatsOf(hat);
  const calls = seatCalls({ hats: SEEDED.hats, gate: organization.deployment.gate, hat, ...seats, wearer });
  return yield* propose({
    operation: "org.director.add",
    payload: adding,
    organization,
    action: "add",
    person: adding.person,
    before,
    // The Gate's config is `min = target`: one more owner leaves the threshold where it is.
    after: { directors: before.directors + 1, threshold: before.threshold },
    call: { to: SEEDED.multiSendCallOnly, data: multiSend(calls), operation: 1, gas: SEAT_GAS },
  });
});

export const thresholdSet = Effect.fn("org.threshold.set.propose")(function* (setting: Setting) {
  const organization = yield* companyOf(setting.org);
  yield* founderOnly(organization);
  const directors = organization.directors.length;
  if (setting.threshold > directors)
    return yield* Errors.ThresholdTooHigh.make({ org: setting.org, threshold: setting.threshold, directors });
  if (setting.threshold === organization.threshold)
    return yield* Errors.ThresholdUnchanged.make({ org: setting.org, threshold: setting.threshold });
  yield* nothingWaiting(setting.org);

  const before = yield* boardNow(organization);
  const call = thresholdCall(organization.deployment.gate, setting.threshold);
  return yield* propose({
    operation: "org.threshold.set",
    payload: setting,
    organization,
    action: "threshold",
    person: null,
    before,
    after: { directors: before.directors, threshold: setting.threshold },
    call: { ...call, operation: 0, gas: THRESHOLD_GAS },
  });
});
