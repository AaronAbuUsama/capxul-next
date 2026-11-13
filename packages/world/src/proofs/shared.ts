// Proofs about what worlds share: two creates of one name at once, the limits on private worlds, and the sweeper
// over an expired world, a live one and one with no recorded expiry.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { claim, claims, registry, release } from "../lifecycle/claim.ts";
import { describe } from "../lifecycle/describe.ts";
import { expiryOf } from "../lifecycle/expiry.ts";
import { create, destroy, list } from "../lifecycle/operations.ts";
import { decodeJsonText } from "../lifecycle/record.ts";
import { Limits, type WorldSpec } from "../lifecycle/spec.ts";
import { SweepReport } from "../lifecycle/sweep.ts";
import { namesOfWorlds } from "../lifecycle/account.ts";
import { recordOutput } from "../stack/engine.ts";
import { check, conclude, inventoryReport, type Ran, runCommandLine, stackListing, tailOf } from "./support.ts";

const outcomeOf = <A, E>(exit: Exit.Exit<A, E>) => (Exit.isSuccess(exit) ? "created" : describe(exit.cause));
const cleanUp = (names: ReadonlyArray<string>) =>
  Effect.forEach(names, (name) => Effect.ignore(destroy(name)), { discard: true });

/** One world's resources: two Workers, three container applications (chain, index, bundler), three Durable Object
 * namespaces, a bucket, a Hyperdrive configuration and a branch. */
const ONE_WORLD = 11;

const raceSpec = (owner: string): WorldSpec => ({ name: "p-race", owner, lifetime: Duration.minutes(40) });

/**
 * Two creates of the same name started at the same moment. One must win; the other must be refused with the
 * contract's WorldExists before it has created anything, so the accounts hold exactly one world's resources.
 */
export const race = Effect.gen(function* () {
  const before = yield* stackListing;
  const [first, second] = yield* Effect.all(
    [Effect.exit(create(raceSpec("racer-a"))), Effect.exit(create(raceSpec("racer-b")))],
    {
      concurrency: 2,
    },
  );
  const results = [outcomeOf(first), outcomeOf(second)];
  const held = namesOfWorlds(yield* stackListing, ["w-p-race"]);
  const listed = Arr.filter(yield* list, (world) => world.world === "w-p-race");
  const gone = yield* Effect.exit(destroy("p-race"));
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-race"]);
  return yield* conclude(
    "race",
    "of two creates of one name at once, one creates the world and the other is refused before it makes anything",
    [
      check("exactly one create succeeded", Arr.filter(results, (result) => result === "created").length === 1),
      check("the other was refused with WorldExists", Arr.some(results, Str.startsWith("WorldExists"))),
      check("the shared state holds one world of that name", listed.length === 1),
      check("the accounts held one world's resources, not two", held.length === ONE_WORLD),
      check("the destroy succeeded", Exit.isSuccess(gone)),
      check("nothing of the world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    { results, whatTheAccountsHeld: held, inSharedState: listed, inventory },
  );
}).pipe(Effect.ensuring(cleanUp(["p-race"])));

const LIMIT_OWNER = "limit-proof";
const HELD = ["w-p-held1", "w-p-held2", "w-p-held3", "w-p-held4", "w-p-held5"];

/** The limits on private worlds are refused with typed failures before anything is created. */
export const limits = Effect.gen(function* () {
  const before = yield* stackListing;
  const { maxLifetime, maxPerOwner, maxKeep } = yield* Limits;
  const tooLong = yield* Effect.exit(create({ name: "p-forever", owner: LIMIT_OWNER, lifetime: Duration.days(8) }));
  // Five names held by one owner, as five live worlds hold them. The limit is kept on the registry, before anything
  // of a world exists, so the names alone are what the sixth create meets.
  const names = yield* registry;
  const until = expiryOf(yield* DateTime.now, Duration.minutes(10));
  yield* Effect.forEach(HELD, (world) => claim(names, world, LIMIT_OWNER, until, maxPerOwner));
  const sixth = yield* Effect.exit(create({ name: "p-sixth", owner: LIMIT_OWNER, lifetime: Duration.minutes(30) }));
  const held = Arr.map(
    Arr.filter(yield* claims(names), (entry) => entry.owner === LIMIT_OWNER),
    (entry) => entry.name,
  );
  yield* Effect.forEach(HELD, (world) => release(names, world));
  const badName = yield* Effect.exit(
    create({ name: "Not A Name", owner: LIMIT_OWNER, lifetime: Duration.minutes(30) }),
  );
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-forever", "w-p-sixth"]);
  const results = {
    askedFor8Days: outcomeOf(tooLong),
    sixthWorldOfOneOwner: outcomeOf(sixth),
    badName: outcomeOf(badName),
  };
  return yield* conclude(
    "limits",
    "a lifetime over the limit, a sixth live world of one owner and a name the contract refuses are each refused before anything is created",
    [
      check("8 days is refused with LifetimeTooLong", Str.startsWith("LifetimeTooLong")(results.askedFor8Days)),
      check(
        "an owner's sixth world is refused with the contract's WorldQuotaReached",
        Str.startsWith("WorldQuotaReached")(results.sixthWorldOfOneOwner),
      ),
      check(
        "a name the contract refuses is refused with InvalidWorldName",
        Str.startsWith("InvalidWorldName")(results.badName),
      ),
      check("the owner held five names at the sixth create", held.length === 5),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      limits: { maxLifetime: Duration.format(maxLifetime), maxPerOwner, maxKeep: Duration.format(maxKeep) },
      results,
      namesTheOwnerHeldAtTheSixthCreate: held,
      inventory,
    },
  );
});

const decodeSweep = (ran: Ran) => decodeJsonText(SweepReport)(ran.stdout);
const verdictOf = (report: SweepReport, stage: string): string =>
  Option.match(
    Arr.findFirst(report.worlds, (world) => world.world === stage),
    { onNone: () => "not listed", onSome: (world) => world.verdict },
  );

/**
 * The sweeper. Three worlds are made at once: one that expires in four minutes, one that is live, and one whose
 * record has lost its expiry, as a world made by an older tool or by hand would be. The sweeps are the command line
 * run as its own process with an empty home directory, as a schedule would run it: they have the shared state and
 * the keys, and nothing else. Once the expiry has passed, only the expired world may be gone.
 */
export const sweeps = Effect.scoped(
  Effect.gen(function* () {
    const before = yield* stackListing;
    const made = yield* Effect.all(
      [
        create({ name: "p-old", owner: "proof", lifetime: Duration.minutes(4) }),
        create({ name: "p-live", owner: "proof", lifetime: Duration.minutes(40) }),
        create({ name: "p-undated", owner: "proof", lifetime: Duration.minutes(40) }),
      ],
      { concurrency: 3 },
    );
    yield* recordOutput("w-p-undated", { world: "w-p-undated", owner: "proof" });
    const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "world-sweep-home-" });
    const firstRun = yield* runCommandLine(["sweep"], { home });
    const first = yield* decodeSweep(firstRun);
    const wait = Duration.max(
      Duration.zero,
      DateTime.distance(yield* DateTime.now, DateTime.makeUnsafe(made[0].world.expiresAt)),
    );
    yield* Effect.logInfo(`the first world expires in ${Duration.format(wait)}; waiting`);
    yield* Effect.sleep(Duration.sum(wait, Duration.seconds(5)));
    const secondRun = yield* runCommandLine(["sweep"], { home });
    const second = yield* decodeSweep(secondRun);
    const between = yield* stackListing;
    const inSharedState = Arr.map(yield* list, (world) => `${world.world}: ${world.state}`);
    yield* cleanUp(["p-live", "p-undated"]);
    const inventory = inventoryReport(before, yield* stackListing, ["w-p-old", "w-p-live", "w-p-undated"]);
    return yield* conclude(
      "sweep",
      "the sweeper, run with nothing but the shared state, destroys a world once its expiry has passed and keeps a live one and one with no recorded expiry",
      [
        check("both sweeps ran to the end", firstRun.exitCode === 0 && secondRun.exitCode === 0),
        check(
          "before the expiry, the sweep kept all three",
          verdictOf(first, "w-p-old") === "kept: not expired" &&
            verdictOf(first, "w-p-live") === "kept: not expired" &&
            verdictOf(first, "w-p-undated") === "kept: no expiry recorded",
        ),
        check("after the expiry, the sweep destroyed the expired world", verdictOf(second, "w-p-old") === "destroyed"),
        check(
          "after the expiry, the sweep kept the live world and the one with no expiry",
          verdictOf(second, "w-p-live") === "kept: not expired" &&
            verdictOf(second, "w-p-undated") === "kept: no expiry recorded",
        ),
        check(
          "nothing of the expired world was left in the accounts",
          namesOfWorlds(between, ["w-p-old"]).length === 0,
        ),
        check(
          "the two kept worlds were still whole",
          namesOfWorlds(between, ["w-p-live"]).length === ONE_WORLD &&
            namesOfWorlds(between, ["w-p-undated"]).length === ONE_WORLD,
        ),
        check(
          "the shared state held the two kept worlds only",
          inSharedState.length === 2 && !Arr.some(inSharedState, Str.startsWith("w-p-old")),
        ),
        check(
          "once the two kept worlds were destroyed, the accounts hold what they held before",
          inventory.sameAsBefore,
        ),
      ],
      {
        created: Arr.map(made, (world) => ({
          world: world.world.stage,
          expiresAt: world.world.expiresAt,
          ms: world.ms,
        })),
        sweepBeforeTheExpiry: { report: first, logTail: tailOf(firstRun) },
        sweepAfterTheExpiry: { report: second, logTail: tailOf(secondRun) },
        inSharedStateAfterTheSweep: inSharedState,
        inventory,
      },
    );
  }),
).pipe(Effect.ensuring(cleanUp(["p-old", "p-live", "p-undated"])));
