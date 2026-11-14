// The world command line: one small set of commands over the package's Effect API. Results are reported through the
// `Report` service as data; the entry file decides how they are printed. No command ever reports a connection
// string, and the chain's address is reported without the world's token unless `--reveal` asks for it.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { InvalidCompany, InvalidDuration, InvalidMint } from "../failures.ts";
import { inventory } from "../lifecycle/account.ts";
import { create, destroy, list } from "../lifecycle/operations.ts";
import { open } from "../lifecycle/parts.ts";
import { platformDown, platformUp } from "../lifecycle/platform.ts";
import type { World } from "../lifecycle/spec.ts";
import { requireComplete, sweep } from "../lifecycle/sweep.ts";
import { proofNames, prove } from "../proofs/proofs.ts";
import { servePlatformOn } from "../platform/serve.ts";
import { IMAGE_KINDS, pinState } from "../stack/images.ts";
import { HubStage, hubDown, hubUp, ledger, openHub } from "../hub/hub.ts";

/** Where a command's result goes. */
export class Report extends Context.Service<Report, { readonly print: (value: unknown) => Effect.Effect<void> }>()(
  "@capxul/world/cli/commands/Report",
) {}

const report = (value: unknown) =>
  Effect.gen(function* () {
    const out = yield* Report;
    yield* out.print(value);
  });

const UNITS: Readonly<Record<string, (amount: number) => Duration.Duration>> = {
  second: Duration.seconds,
  minute: Duration.minutes,
  hour: Duration.hours,
  day: Duration.days,
};

/** A lifetime as people write it: "90 seconds", "30 minutes", "2 hours", "1 day". */
export const durationOf = (given: string) => {
  const found = /^(\d+)\s*(second|minute|hour|day)s?$/.exec(Str.trim(given));
  const amount = Number(found?.[1]);
  const unit = found?.[2] === undefined ? undefined : UNITS[found[2]];
  return unit === undefined || !Number.isSafeInteger(amount)
    ? Effect.fail(
        InvalidDuration.make({
          given,
          message: `"${given}" is not a duration; write it like "2 hours" or "30 minutes"`,
        }),
      )
    : Effect.succeed(unit(amount));
};

/** Mints as people write them: `0xADDRESS=AMOUNT`, comma separated, amounts in millionths of a USDC. */
export const mintsOf = (given: string) =>
  Effect.forEach(pipe(Str.split(given, ","), Arr.map(Str.trim), Arr.filter(Str.isNonEmpty)), (part) => {
    const found = /^(0x[0-9a-fA-F]{40})=([0-9]+)$/.exec(part);
    const [to, amount] = [found?.[1], found?.[2]];
    return to === undefined || amount === undefined
      ? Effect.fail(
          InvalidMint.make({
            given: part,
            message: `"${part}" is not address=amount, e.g. 0x7099...79C8=250000000 for 250 USDC`,
          }),
        )
      : Effect.succeed({ to, amount: BigInt(amount) });
  });

/** Companies as people write them: `label=Name`, comma separated; the label is 1 to 12 of a-z and 0-9. */
export const companiesOf = (given: string) =>
  Effect.forEach(pipe(Str.split(given, ","), Arr.map(Str.trim), Arr.filter(Str.isNonEmpty)), (part) => {
    const found = /^([a-z0-9]{1,12})=(.{1,140})$/.exec(part);
    const [label, companyName] = [found?.[1], found?.[2]];
    return label === undefined || companyName === undefined
      ? Effect.fail(InvalidCompany.make({ given: part, message: `"${part}" is not label=Name, e.g. acme=Acme Ltd` }))
      : Effect.succeed({ label, name: Str.trim(companyName) });
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
  sites: world.sites,
  rpcUrl: reveal
    ? Redacted.value(world.rpcUrl)
    : world.rpcUrl.pipe(Redacted.value, Str.replace(/\/w-[a-z0-9-]+\.[0-9a-f]{32}\//, "/<token: show --reveal>/")),
  bundlerUrl: reveal
    ? Redacted.value(world.bundlerUrl)
    : world.bundlerUrl.pipe(Redacted.value, Str.replace(/\/w-[a-z0-9-]+\.[0-9a-f]{32}\//, "/<token: show --reveal>/")),
  entryPoint: world.entryPoint,
  paymaster: world.paymaster,
  database: "reached with `sql <world> <statement>`, or in-process through the world's handle; never printed",
});

const name = Argument.String("name").pipe(Argument.withDescription("The world's name"));
const reveal = Flag.Boolean("reveal").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Print the chain's address with the world's token"),
);

const hubFlag = Flag.String("hub").pipe(
  Flag.optional,
  Flag.withDescription("The hub's stage; WORLD_HUB, or fleet, when left out"),
);
const hubStageOf = (given: Option.Option<string>) =>
  Option.match(given, { onNone: () => HubStage, onSome: (stage) => Effect.succeed(stage) });

const createCommand = Command.make(
  "create",
  {
    name,
    owner: Flag.String("owner").pipe(Flag.withDescription("Who the world belongs to")),
    lifetime: Flag.String("lifetime").pipe(Flag.withDescription('How long the world may exist, e.g. "2 hours"')),
    from: Flag.String("from").pipe(
      Flag.optional,
      Flag.withDescription("Make the world from this world's database and chain"),
    ),
    mint: Flag.String("mint").pipe(
      Flag.optional,
      Flag.withDescription(
        "Test USDC to mint from the faucet: address=amount, comma separated, amounts in millionths of a USDC",
      ),
    ),
    company: Flag.String("company").pipe(
      Flag.optional,
      Flag.withDescription(
        "Companies whose Frappe sites the world gets on its bench (WORLD_BENCH): label=Name, comma separated",
      ),
    ),
    reveal,
    hub: hubFlag,
  },
  (input) =>
    Effect.gen(function* () {
      const made = yield* create({
        hub: yield* hubStageOf(input.hub),
        companies: yield* companiesOf(Option.getOrElse(input.company, () => "")),
        name: input.name,
        owner: input.owner,
        lifetime: yield* durationOf(input.lifetime),
        mint: yield* mintsOf(Option.getOrElse(input.mint, () => "")),
        ...Option.match(input.from, { onNone: () => ({}), onSome: (from) => ({ from }) }),
      });
      yield* report({ ...addresses(made.world, input.reveal), ms: made.ms });
    }),
).pipe(
  Command.withDescription("Create a private world: database, chain, index, bundler, Core and its companies' sites"),
);

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
  Effect.gen(function* () {
    const swept = yield* sweep({ dryRun: input.dryRun });
    yield* report(swept);
    yield* requireComplete(swept);
  }),
).pipe(Command.withDescription("Destroy every expired world and remove what destroys leave behind"));

const inventoryCommand = Command.make("inventory", {}, () => Effect.flatMap(inventory, report)).pipe(
  Command.withDescription("Count what the two accounts hold, naming what belongs to this stack"),
);

const platformCommand = Command.make("platform").pipe(
  Command.withDescription("What every world shares: the Neon project and the registry of names"),
  Command.withSubcommands([
    Command.make("up", {}, () => Effect.flatMap(platformUp, report)),
    Command.make("down", {}, () => Effect.flatMap(platformDown, report)),
    Command.make(
      "serve",
      { port: Flag.Int("port").pipe(Flag.withDefault(8790), Flag.withDescription("The loopback port to serve on")) },
      (input) => servePlatformOn(input.port),
    ).pipe(
      Command.withDescription(
        "Serve the blueprint's platform group on this machine's loopback, signed in by WORLD_OWNER with CAPXUL_PLATFORM_TOKEN (and WORLD_SECOND_OWNER with CAPXUL_SECOND_PLATFORM_TOKEN), until stopped",
      ),
    ),
  ]),
);

const hubCommand = Command.make("hub").pipe(
  Command.withDescription("The fleet hub: one container application of each kind, which every world on it shares"),
  Command.withSubcommands([
    Command.make(
      "up",
      {
        hub: hubFlag,
        owner: Flag.String("owner").pipe(Flag.withDescription("Who the hub belongs to")),
        lifetime: Flag.String("lifetime").pipe(Flag.withDescription('How long the hub may exist, e.g. "7 days"')),
      },
      (input) =>
        Effect.gen(function* () {
          const stage = yield* hubStageOf(input.hub);
          const up = yield* hubUp({ stage, owner: input.owner, lifetime: yield* durationOf(input.lifetime) });
          yield* report(up);
        }),
    ).pipe(Command.withDescription("Deploy a hub, or move a live hub's expiry")),
    Command.make("down", { hub: hubFlag }, (input) =>
      Effect.flatMap(Effect.flatMap(hubStageOf(input.hub), hubDown), report),
    ).pipe(Command.withDescription("Destroy a hub; refused while a world is on it")),
    Command.make("show", { hub: hubFlag }, (input) =>
      Effect.gen(function* () {
        const hub = yield* openHub(yield* hubStageOf(input.hub));
        const held = yield* ledger(hub);
        yield* report({
          hub: hub.stage,
          owner: hub.owner,
          expiresAt: hub.expiresAt,
          doorUrl: hub.doorUrl,
          worlds: held,
        });
      }),
    ).pipe(Command.withDescription("A hub's owner, expiry, door and the worlds its ledger holds")),
  ]),
);

const imagesCommand = Command.make("images", {}, () =>
  Effect.flatMap(Effect.forEach(IMAGE_KINDS, pinState), report),
).pipe(
  Command.withDescription(
    "Each image's pin, the fingerprint of its inputs now, and whether a deploy uses the pinned digest (src/stack/images.ts)",
  ),
);

const proveCommand = Command.make(
  "prove",
  { proof: Argument.String("case").pipe(Argument.withDescription(`One of: ${proofNames}`)) },
  (input) => Effect.flatMap(prove(input.proof), report),
).pipe(Command.withDescription("Run one of the package's proofs and write its record"));

export const world = Command.make("world").pipe(
  Command.withDescription("Create, destroy, list and sweep private worlds"),
  Command.withSubcommands([
    createCommand,
    destroyCommand,
    listCommand,
    showCommand,
    sqlCommand,
    sweepCommand,
    inventoryCommand,
    platformCommand,
    hubCommand,
    imagesCommand,
    proveCommand,
  ]),
);
