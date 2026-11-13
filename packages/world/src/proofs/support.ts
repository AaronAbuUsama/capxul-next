// What every proof shares: its checks and its record, the inventory it takes before and after, and the world
// command line run as its own process, as a person or a schedule runs it.
import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { ProofFailed } from "../failures.ts";
import { inventory, namesOfWorlds, ofThisStackOnly, type StackListing } from "../lifecycle/account.ts";
import { type Check, writeProof } from "../lifecycle/record.ts";

/** The package's own folder, where `./run.sh` is, and the repository's, where the documented pnpm command runs. */
export const PACKAGE = `${import.meta.dirname}/../..`;
const REPOSITORY = `${PACKAGE}/../..`;

/** One check of a proof: what it insists on, and whether that held. */
export const check = (what: string, held: boolean): Check => ({ check: what, held });

/**
 * Writes the proof's record, with its outcome and every check, and fails the proof unless every check held. The
 * record is written either way: a proof that fails says on record which check did not hold.
 */
export const conclude = Effect.fn("world.proof.conclude")(function* (
  name: string,
  proof: string,
  checks: ReadonlyArray<Check>,
  observations: unknown,
) {
  const { outcome, failed } = yield* writeProof(name, proof, checks, observations);
  if (Arr.isReadonlyArrayNonEmpty(failed)) {
    const which = Arr.join(
      Arr.map(failed, (one) => one.check),
      "; ",
    );
    return yield* ProofFailed.make({ message: `${name}: did not hold: ${which}` });
  }
  return { proof: name, outcome, record: `records/${name}.proof.json` };
});

/** What the two accounts hold of this stack now. */
export const stackListing = Effect.map(inventory, ofThisStackOnly);

/** What a world creates, without the image repositories every world shares, which belong to the platform. */
export const worldResources = (listing: StackListing) => Rec.remove(listing, "imageRepositories");

/**
 * The world stage a resource's name carries, if any: `<kind>-w-<name>-<16 random>` for a Cloudflare resource,
 * `<project>/w-<name>` for a Neon branch. The platform's own resources carry none.
 */
export const worldStageOf = (name: string): string | undefined =>
  /\/(w-[a-z0-9-]+)$/.exec(name)?.[1] ?? /-(w-[a-z0-9-]+?)-[a-z0-9]{16}$/.exec(name)?.[1];

/**
 * Whether a name belongs to one of `others`: it carries that world's stage, as its own part (`-w-a-`, `/w-a`, `-w-a`
 * at the end), wherever it is: a world's snapshot branch, for one, is named `snap-<stage>-...`.
 */
const ofAny = (name: string, others: ReadonlyArray<string>): boolean =>
  Arr.some(
    others,
    (stage) =>
      Str.includes(`-${stage}-`)(name) ||
      Str.includes(`/${stage}-`)(name) ||
      Str.endsWith(`/${stage}`)(name) ||
      Str.endsWith(`-${stage}`)(name),
  );

/** Every resource, without those of `others`, the worlds a proof did not make. */
const withoutOtherWorlds = (listing: StackListing, others: ReadonlyArray<string>): StackListing =>
  Rec.map(listing, (names) => Arr.filter(names, (name) => !ofAny(name, others)));

/** The world stages a listing's resources carry. */
const worldsIn = (listing: StackListing): ReadonlyArray<string> =>
  Arr.filter(Arr.map(Arr.flatten(Rec.values(worldResources(listing))), worldStageOf), Predicate.isNotUndefined);

const fingerprint = (listing: StackListing): string =>
  Arr.join(
    Arr.map(
      Rec.toEntries(worldResources(listing)),
      ([kind, names]) => `${kind}=${Arr.join(Arr.sort(names, Order.String), ",")}`,
    ),
    "|",
  );

/** Whether two listings hold the same resources of the kinds a world creates, whatever their order. */
export const sameResources = (before: StackListing, after: StackListing): boolean =>
  fingerprint(before) === fingerprint(after);

/**
 * The inventory before and after, and what is left of the named worlds: the evidence that a destroy removed all.
 * The two accounts are shared: another builder's worlds may be made or destroyed while a proof runs. So
 * `sameAsBefore` compares everything but the resources of other worlds (a name that carries another world's stage,
 * a stage seen in either listing);
 * the platform's resources, anything with no world in its name, and the named worlds' own are all compared.
 * `sameAsBeforeAccountWide` is the comparison of everything, and `otherWorlds` names the worlds it set aside.
 */
export const inventoryReport = (before: StackListing, after: StackListing, stages: ReadonlyArray<string>) => {
  const others = Arr.filter(
    Arr.dedupe([...worldsIn(before), ...worldsIn(after)]),
    (stage) => !Arr.contains(stages, stage),
  );
  return {
    before,
    after,
    leftOfTheseWorlds: namesOfWorlds(after, stages),
    sameAsBefore: sameResources(withoutOtherWorlds(before, others), withoutOtherWorlds(after, others)),
    sameAsBeforeAccountWide: sameResources(before, after),
    otherWorlds: others,
  };
};

/** How a run of the command line ended. */
export interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: ReadonlyArray<string>;
}

const lines = <E>(stream: Stream.Stream<Uint8Array, E>) => stream.pipe(Stream.decodeText(), Stream.splitLines);

/**
 * Runs the world command line as its own process and waits for it to end: `./run.sh <args>`, or with `viaPnpm` the
 * documented `pnpm --silent --filter @capxul/world world <args>` from the repository's root. With `interruptWhen`,
 * the process is sent SIGINT as soon as a line of its log contains that text, as a person would press Ctrl-C. With
 * `home`, it runs with that home directory, so it can use nothing this machine kept.
 */
export const runCommandLine = (
  args: ReadonlyArray<string>,
  options: { readonly interruptWhen?: string; readonly home?: string; readonly viaPnpm?: boolean } = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const env = options.home === undefined ? {} : { HOME: options.home };
      const command =
        options.viaPnpm === true
          ? ChildProcess.make("pnpm", ["--silent", "--filter", "@capxul/world", "world", ...args], {
              cwd: REPOSITORY,
              env,
              extendEnv: true,
            })
          : ChildProcess.make("./run.sh", args, { cwd: PACKAGE, env, extendEnv: true });
      const handle = yield* spawner.spawn(command);
      const seen = yield* Deferred.make<void>();
      const log = yield* Ref.make(Arr.empty<string>());
      const stderr = yield* lines(handle.stderr).pipe(
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            yield* Ref.update(log, Arr.append(line));
            const marker = options.interruptWhen;
            if (marker !== undefined && Str.includes(marker)(line)) yield* Deferred.succeed(seen, undefined);
          }),
        ),
        Effect.forkScoped,
      );
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText(), Stream.mkString));
      if (options.interruptWhen !== undefined) {
        yield* Deferred.await(seen).pipe(Effect.raceFirst(Effect.asVoid(handle.exitCode)));
        yield* handle.kill({ killSignal: "SIGINT" }).pipe(Effect.ignore);
      }
      const exitCode = yield* handle.exitCode;
      yield* Fiber.join(stderr);
      return { exitCode, stdout: yield* Fiber.join(stdout), stderr: yield* Ref.get(log) } satisfies Ran;
    }),
  );

/** The last few lines of a run's log, for a record: enough to show how it ended. */
export const tailOf = (ran: Ran, count = 12): ReadonlyArray<string> =>
  pipe(
    ran.stderr,
    Arr.filter((line) => Str.isNonEmpty(Str.trim(line))),
    Arr.takeRight(count),
  );
