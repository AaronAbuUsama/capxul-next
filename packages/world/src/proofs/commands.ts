// Proof: one command creates a private world and another destroys it, run exactly as the README documents them,
// each as its own process. Between the two, the world is opened from the shared state alone and every part of it
// is asked to answer: chain, index, Core and database.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { balanceOf } from "../chain/faucet.ts";
import { CORE_HEALTH } from "../core/health.ts";
import { destroy, list } from "../lifecycle/operations.ts";
import { indexStatus, open, rpc, rpcHex } from "../lifecycle/parts.ts";
import { fromJsonText } from "../lifecycle/record.ts";
import { FUNDED, OPENING } from "./checks.ts";
import { check, conclude, inventoryReport, runCommandLine, stackListing, tailOf } from "./support.ts";

const Ms = Schema.Record(Schema.String, Schema.Finite);
const Created = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  coreUrl: Schema.String,
  ms: Ms,
});
const Destroyed = Schema.Struct({ world: Schema.String, resourcesDestroyed: Schema.Finite, ms: Ms });
const Health = Schema.Struct({ core: Schema.String, world: Schema.String });
const One = Schema.Tuple([Schema.Struct({ one: Schema.Int })]);

const NAME = "p-cli";

export const commands = Effect.gen(function* () {
  const before = yield* stackListing;
  const createArgs = ["create", NAME, "--owner", "proof", "--lifetime", "30 minutes", "--mint", `${FUNDED}=${OPENING}`];
  const createRun = yield* runCommandLine(createArgs, { viaPnpm: true });
  const created = yield* Schema.decodeUnknownEffect(Created)(fromJsonText(createRun.stdout));
  const world = yield* open(NAME);
  const chainId = yield* rpcHex(world, "eth_chainId");
  const funded = yield* balanceOf((method, params) => rpc(world, method, params), FUNDED);
  const index = yield* indexStatus(world);
  const core = yield* HttpClient.get(`${world.coreUrl}${CORE_HEALTH}`).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Health)),
    Effect.scoped,
  );
  const [database] = yield* world.sql("select 1 as one").pipe(Effect.flatMap(Schema.decodeUnknownEffect(One)));
  const destroyRun = yield* runCommandLine(["destroy", NAME], { viaPnpm: true });
  const destroyed = yield* Schema.decodeUnknownEffect(Destroyed)(fromJsonText(destroyRun.stdout));
  const listed = Arr.filter(yield* list, (entry) => entry.world === world.stage);
  const inventory = inventoryReport(before, yield* stackListing, [world.stage]);
  return yield* conclude(
    "commands",
    "`world create` makes a private world whose chain, index, Core and database answer, and `world destroy` removes all of it",
    [
      check("the create command succeeded", createRun.exitCode === 0),
      check(
        "the world has its owner and an expiry",
        created.owner === "proof" && created.expiresAt === world.expiresAt,
      ),
      check("the chain answers as the seeded chain", chainId === "0x14a34"),
      check("the faucet funded the address asked for", funded === OPENING),
      check("the index is running and ready", index.running && index.ready === 200),
      check("Core answers its health check for this world", core.world === world.stage),
      check("the database answers", database.one === 1),
      check("the destroy command succeeded", destroyRun.exitCode === 0 && destroyed.resourcesDestroyed > 0),
      check("the shared state holds nothing of the world", listed.length === 0),
      check("nothing of the world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      commands: {
        create: `pnpm --filter @capxul/world world ${Arr.join(createArgs, " ")}`,
        destroy: `pnpm --filter @capxul/world world destroy ${NAME}`,
      },
      createMs: created.ms,
      destroyMs: destroyed.ms,
      resourcesDestroyed: destroyed.resourcesDestroyed,
      answers: { chainId, fundedHolds: funded.toString(), index: { running: index.running, ready: index.ready }, core },
      createLogTail: tailOf(createRun),
      destroyLogTail: tailOf(destroyRun),
      inventory,
    },
  );
}).pipe(Effect.ensuring(Effect.ignore(destroy(NAME))));
