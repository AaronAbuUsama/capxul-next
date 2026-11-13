// Proof: the limits on private worlds are refused with typed errors before anything is created. A world may live
// at most 7 days, and an owner may have at most 5 live worlds.
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { inventory } from "../lifecycle/account.ts";
import { claim, claims, registry, release } from "../lifecycle/claim.ts";
import { expiryOf } from "../lifecycle/expiry.ts";
import { create } from "../lifecycle/operations.ts";
import { describe } from "../lifecycle/run.ts";
import { Limits } from "../lifecycle/spec.ts";
import { insist, observed } from "./checks.ts";

const OWNER = "limit-proof";
const HELD = ["w-p-held1", "w-p-held2", "w-p-held3", "w-p-held4", "w-p-held5"];

const refusal = (exit: Exit.Exit<unknown, unknown>) => (Exit.isSuccess(exit) ? "created" : describe(exit.cause));

export const limits = Effect.gen(function* () {
  const { maxLifetime, maxPerOwner } = yield* Limits;
  const tooLong = yield* Effect.exit(create({ name: "p-forever", owner: OWNER, lifetime: Duration.days(8) }));
  // Five names held by one owner, as five live worlds hold them. The limit is kept on the registry, before anything
  // of a world exists, so the names alone are what the sixth create meets.
  const names = yield* registry;
  const until = expiryOf(yield* DateTime.now, Duration.minutes(10));
  yield* Effect.forEach(HELD, (world) => claim(names, world, OWNER, until, maxPerOwner));
  const sixth = yield* Effect.exit(create({ name: "p-sixth", owner: OWNER, lifetime: Duration.minutes(30) }));
  const held = (yield* claims(names)).filter((entry) => entry.owner === OWNER).map((entry) => entry.name);
  yield* Effect.forEach(HELD, (world) => release(names, world));
  const listing = yield* inventory;
  const made = [...listing.workers.ofThisStack, ...listing.neonBranches.names].filter(
    (name) => name.includes("p-forever") || name.includes("p-sixth"),
  );
  const results = { askedFor8Days: refusal(tooLong), sixthWorldOfOneOwner: refusal(sixth) };
  yield* observed("limits", {
    proof: "a lifetime over the limit and a sixth live world of one owner are both refused before anything is created",
    limits: { maxLifetime: Duration.format(maxLifetime), maxPerOwner },
    results,
    namesTheOwnerHeldAtTheSixthCreate: held,
    resourcesOfTheRefusedWorlds: made,
  });
  yield* insist(results.askedFor8Days.startsWith("LifetimeTooLong"), `8 days: ${results.askedFor8Days}`);
  yield* insist(
    results.sixthWorldOfOneOwner.startsWith("TooManyWorlds"),
    `the sixth world: ${results.sixthWorldOfOneOwner}`,
  );
  yield* insist(held.length === 5 && made.length === 0, "a refused create left something behind");
  return { ...results, resourcesOfTheRefusedWorlds: made };
});
