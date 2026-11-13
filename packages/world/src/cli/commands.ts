// The world command line: one small set of commands over the package's Effect API. Results are reported through the
// `Report` service as data; the entry file decides how they are printed. No command ever reports a connection
// string, and the chain's address is reported without the world's token unless `--reveal` asks for it.
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { inventory } from "../lifecycle/account.ts";
import { create, destroy, list } from "../lifecycle/operations.ts";
import { open } from "../lifecycle/parts.ts";
import { platformDown, platformUp } from "../lifecycle/platform.ts";
import type { World } from "../lifecycle/spec.ts";
import { sweep, SweepIncomplete } from "../lifecycle/sweep.ts";
import { prove, PROOFS } from "../proofs/proofs.ts";

/** Where a command's result goes. */
export class Report extends Context.Service<Report, { readonly print: (value: unknown) => Effect.Effect<void> }>()(
  "capxul/world/Report",
) {}

export class InvalidLifetime extends Schema.TaggedError<InvalidLifetime>()("InvalidLifetime", {
  given: Schema.String,
  message: Schema.String,
}) {}

const report = (value: unknown) =>
  Effect.gen(function* () {
    const out = yield* Report;
    yield* out.print(value);
  });

const lifetimeOf = (given: string) =>
  Option.match(Duration.fromInput(given as Duration.Input), {
    onNone: () => Effect.fail(new InvalidLifetime({ given, message: `"${given}" is not a duration; write it like "2 hours" or "30 minutes"` })),
    onSome: Effect.succeed,
  });

export class InvalidMint extends Schema.TaggedError<InvalidMint>()("InvalidMint", {
  given: Schema.String,
  message: Schema.String,
}) {}

const mintsOf = (given: string) =>
  Effect.forEach(given.split(",").filter((part) => part.trim() !== ""), (part) => {
    const [to, amount] = part.trim().split("=");
    return to !== undefined && /^0x[0-9a-fA-F]{40}$/.test(to) && amount !== undefined && /^[0-9]+$/.test(amount)
      ? Effect.succeed({ to, amount: BigInt(amount) })
      : Effect.fail(new InvalidMint({ given: part, message: `"${part}" is not address=amount, e.g. 0x7099...79C8=250000000 for 250 USDC` }));
  });

/** A world's addresses as they may be printed: the token is shown only when asked for. */
const addresses = (world: World, reveal: boolean) => ({
  world: world.name,
  owner: world.owner,
  expiresAt: world.expiresAt,
  forkedFrom: world.forkedFrom,
  coreUrl: world.coreUrl,
  testUsdc: world.testUsdc,
  funded: world.funded,
  rpcUrl: reveal ? Redacted.value(world.rpcUrl) : Redacted.value(world.rpcUrl).replace(/\/[0-9a-f]{32}\//, "/<token: show --reveal>/"),
  database: "reached with `sql <world> <statement>`, or in-process through the world's handle; never printed",
});

const name = Argument.String("name").pipe(Argument.withDescription("The world's name"));
const reveal = Flag.Boolean("reveal").pipe(Flag.withDefault(false), Flag.withDescription("Print the chain's address with the world's token"));

const createCommand = Command.make(
  "create",
  {
    name,
    owner: Flag.String("owner").pipe(Flag.withDescription("Who the world belongs to")),
    lifetime: Flag.String("lifetime").pipe(Flag.withDescription('How long the world may exist, e.g. "2 hours"')),
    from: Flag.String("from").pipe(Flag.optional, Flag.withDescription("Make the world from this world's database and chain")),
    mint: Flag.String("mint").pipe(Flag.optional, Flag.withDescription("Test USDC to mint from the faucet: address=amount, comma separated, amounts in millionths of a USDC")),
    reveal,
  },
  (input) =>
    Effect.gen(function* () {
      const lifetime = yield* lifetimeOf(input.lifetime);
      const mint = yield* mintsOf(Option.getOrElse(input.mint, () => ""));
      const made = yield* create({ name: input.name, owner: input.owner, lifetime, mint, ...(Option.isSome(input.from) ? { from: input.from.value } : {}) });
      yield* report({ ...addresses(made.world, input.reveal), ms: made.ms });
    }),
).pipe(Command.withDescription("Create a private world: database, chain, index and Core"));

const destroyCommand = Command.make("destroy", { name }, (input) => Effect.flatMap(destroy(input.name), report)).pipe(
  Command.withDescription("Destroy a world and everything it created"),
);

const listCommand = Command.make("list", {}, () => Effect.flatMap(list, report)).pipe(
  Command.withDescription("List every world in the shared state, with its owner and expiry"),
);

const showCommand = Command.make("show", { name, reveal }, (input) =>
  Effect.flatMap(open(input.name), (world) => report(addresses(world, input.reveal))),
).pipe(Command.withDescription("Show a world's addresses"));

const sqlCommand = Command.make("sql", { name, statement: Argument.String("statement") }, (input) =>
  Effect.gen(function* () {
    const world = yield* open(input.name);
    yield* report(yield* world.sql(input.statement));
  }),
).pipe(Command.withDescription("Run one SQL statement on a world's database"));

const sweepCommand = Command.make("sweep", { dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)) }, (input) =>
  sweep({ dryRun: input.dryRun }).pipe(
    Effect.tapError((failure) => (failure instanceof SweepIncomplete ? report(failure.report) : Effect.void)),
    Effect.flatMap(report),
  ),
).pipe(Command.withDescription("Destroy every expired world and remove what destroys leave behind"));

const inventoryCommand = Command.make("inventory", {}, () => Effect.flatMap(inventory, report)).pipe(
  Command.withDescription("Count what the two accounts hold, naming what belongs to this stack"),
);

const platformCommand = Command.make("platform").pipe(
  Command.withDescription("What every world shares: the Neon project and the registry of names"),
  Command.withSubcommands([
    Command.make("up", {}, () => Effect.flatMap(platformUp, report)),
    Command.make("down", {}, () => Effect.flatMap(platformDown, report)),
  ]),
);

const proveCommand = Command.make(
  "prove",
  { proof: Argument.String("case").pipe(Argument.withDescription(`One of: ${Object.keys(PROOFS).join(", ")}`)) },
  (input) => Effect.flatMap(prove(input.proof), report),
).pipe(Command.withDescription("Run one of the package's proofs and write its record"));

export const world = Command.make("world").pipe(
  Command.withDescription("Create, destroy, list and sweep private worlds"),
  Command.withSubcommands([createCommand, destroyCommand, listCommand, showCommand, sqlCommand, sweepCommand, inventoryCommand, platformCommand, proveCommand]),
);
