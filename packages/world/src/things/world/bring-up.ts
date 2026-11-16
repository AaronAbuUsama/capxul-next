// Bringing one world up on its fleet hub, step by step: the claim, its registration on the hub, then the chain's lane
// and the database's lane side by side. Used by the lifecycle (run.ts) and the command line (operations.ts).
import { World as Declared } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { BUNDLER_PATH, TEST_PAYMASTER } from "../../parts/bundler/Keys.ts";
import { setUpBundler, startBundler } from "../../parts/bundler/setup.ts";
import { SEED_HEAD } from "../../parts/chain/contracts.ts";
import { ensureToken, mintAll } from "../../parts/chain/faucet.ts";
import { CORE_MIGRATIONS, SITE_KEY_ID, SITE_SECRET_ID } from "../../parts/api/Api.ts";
import { warmApi } from "../../parts/api/bundle.ts";
import { CoreHost } from "../../parts/api/host.ts";
import { migrate } from "../../parts/database/sql.ts";
import { HubMissing, WorldNotReady } from "../../common/failures.ts";
import { HubStage, openHub, register, worldSecret } from "../cluster/client.ts";
import { makeBranch, projectId } from "../../parts/database/neon.ts";
import { mineStart } from "./cast.ts";
import { steady } from "../../parts/api/steady.ts";
import { tokenOf } from "../cluster/registration.ts";
import { explained } from "../../parts/indexer/starts.ts";
import { BenchStage, grant, makeSites } from "../site/bench.ts";
import type { BenchGrant } from "../../stack/settings.ts";
import { deployStage, recordOutput, recordedOutput, secretOf } from "../../stack/engine.ts";
import { liftBranchExpiry } from "../../stack/cloud.ts";
import { admit, registry } from "../registry/reserve.ts";
import { handle, WorldOutput } from "./handle.ts";
import { adoptChain, chainAnswers, indexReady, open, rpc, rpcControl } from "./client.ts";
import { AdmitEvery, Limits, type World, type WorldSpec } from "./values.ts";
import type { Stopwatch } from "../../common/stopwatch.ts";
import type { Plan } from "./take-down.ts";

/** The steps `world.create` declares (packages/blueprint, src/things/world/verbs/create.ts), each a span of its own. */
const steps = Declared.create.spans;

/**
 * How often the index's readiness is asked while a world comes up: Ponder is ready a few seconds after its start, and
 * a look every 2 s lost a second on average. The `index` step's declared timeout still bounds the wait.
 */
const INDEX_EVERY = "500 millis";

const recordOf = (plan: Plan, status: string, bench: string, hub: string) => ({
  world: plan.stage,
  hub,
  owner: plan.owner,
  expiresAt: plan.expiresAt,
  forkedFrom: Option.getOrElse(plan.forkedFrom, () => "nothing"),
  status,
  bench,
});

/**
 * Lets `child` be made from `parent`: Neon will not fork a branch that has an expiry of its own, so the parent's is
 * taken off, and the parent's record in the shared state says so. The parent still expires: the sweeper reads its
 * recorded expiry, not Neon's.
 */
const makeForkable = Effect.fn("world.makeForkable")(function* (parent: string, child: string) {
  const project = yield* projectId;
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(parent));
  yield* liftBranchExpiry(project, output.branch);
  yield* recordOutput(parent, { ...output, neonExpiry: `lifted so that ${child} could be made from it` });
});

/**
 * Brings the world up on its fleet hub. The name is claimed first, with a place on the hub (waiting for one while the
 * hub is full), and `held` is set the moment the claim holds, so whoever runs this knows whether there is anything of
 * theirs to take down. Owner, expiry and bench are written to the shared state before anything exists, so a world
 * whose creation dies half-way is still found, and deleted, by the sweeper. Then the world is registered on its hub,
 * and two lanes run side by side: the chain's (its chain, the faucet, the bundler and whatever the caller does on the
 * chain, `spec.onChain`) and the database's (its keys on the bench beside its branch, the deploy of Core, the
 * migrations, the index once the chain answers, and Core). Each step is a span `world.create` declares.
 */
export const bringUp = (spec: WorldSpec, plan: Plan, watch: Stopwatch, held: Ref.Ref<Option.Option<string>>) =>
  Effect.gen(function* () {
    const parent = yield* Effect.transposeOption(Option.map(plan.forkedFrom, open));
    const hub = yield* openHub(spec.hub ?? (yield* HubStage));
    if (DateTime.isGreaterThan(DateTime.makeUnsafe(plan.expiresAt), DateTime.makeUnsafe(hub.expiresAt)))
      return yield* HubMissing.make({
        hub: hub.stage,
        message: `the world would expire at ${plan.expiresAt}, after its hub (${hub.expiresAt}); bring the hub up again`,
      });
    // The name and a place on the hub, held together, waiting while the hub is full (src/things/registry/reserve.ts): the
    // wait is the `admit` step's, under its own declared timeout, so a world never starts containers the hub has no
    // room for. A refusal of the name or the quota comes at once.
    const names = yield* registry;
    const { maxPerOwner, maxSites } = yield* Limits;
    const room = { stage: hub.stage, capacity: hub.capacity };
    // The world's first record names the bench its sites go on before its keys there are minted (the `grant`, beside
    // the branch): a create that fails after the claim is taken down by its record, its sites included, and a key
    // minted from the platform's door key needs no revoking, only its sites removing.
    const benchStage = yield* BenchStage;
    const every = yield* AdmitEvery;
    yield* Effect.andThen(
      watch.step(
        "admit",
        admit(names, plan.stage, plan.owner, plan.expiresAt, maxPerOwner, room, every, (holder) =>
          Ref.set(held, Option.some(holder)),
        ),
      ),
      watch.step(
        "claim",
        recordOutput(
          plan.stage,
          recordOf(
            plan,
            "creating",
            Option.getOrElse(benchStage, () => "none"),
            hub.stage,
          ),
        ),
      ),
    ).pipe(Effect.withSpan(steps.claim.name));
    yield* Effect.logInfo(`world ${plan.stage}: claimed for ${plan.owner} until ${plan.expiresAt}`);
    const secret = yield* worldSecret(hub, plan);
    const doorToken = Redacted.make(tokenOf(plan.stage, secret));
    const reach = {
      door: Redacted.make(`${hub.doorUrl}/${Redacted.value(doorToken)}`),
      bundlerUrl: Redacted.make(`${hub.doorUrl}/${Redacted.value(doorToken)}${BUNDLER_PATH}`),
    };
    const call = (method: string, params: ReadonlyArray<unknown>) => rpc(reach, method, params);
    const chainUp = yield* Deferred.make<void>();
    const chainLane = Effect.gen(function* () {
      yield* watch.step(
        "register",
        register(hub, { stage: plan.stage, secret, owner: plan.owner, expiresAt: plan.expiresAt }),
        steps.register.name,
      );
      yield* watch.step(
        "chain",
        Effect.gen(function* () {
          if (Option.isSome(parent)) yield* adoptChain(reach, parent.value, spec.snapshot?.name);
          return yield* chainAnswers(reach);
        }),
        steps.chain.name,
      );
      yield* Deferred.succeed(chainUp, undefined);
      // Everything that makes a world from nothing is sent just after the seed, before the world's own start.
      if (spec.atSeed === true && Option.isNone(parent))
        yield* rpcControl(reach, "evm_setTime", [SEED_HEAD.timestamp + 1]);
      const funded = yield* watch.step(
        "fund",
        Effect.andThen(ensureToken(call), mintAll(call, spec.mint ?? [])),
        steps.fund.name,
      );
      // The bundler's own transactions first, so that everything that makes the world is sent before the caller's
      // (the cast, then the world's start block); then alto starts beside the caller's work.
      const bundler = yield* watch.step(
        "bundler",
        Effect.andThen(
          setUpBundler(call).pipe(Effect.withSpan(steps.bundlerSetUp.name)),
          Effect.all(
            [
              startBundler(reach).pipe(Effect.withSpan(steps.bundlerStart.name)),
              spec.onChain === undefined ? Effect.void : spec.onChain(reach),
            ],
            { concurrency: 2 },
          ).pipe(Effect.map(([started]) => started)),
        ),
      );
      // The world's own first block, at its start, mined once everything that makes the world is on its chain.
      if (spec.startAtMs !== undefined)
        yield* mineStart((method, params) => rpcControl(reach, method, params), spec.startAtMs);
      yield* Effect.logInfo(
        `world ${plan.stage}: the bundler serves ${Arr.join(bundler.entryPoints, ", ")}, paymaster ${TEST_PAYMASTER}`,
      );
      return funded;
    });
    const deployDone = yield* Deferred.make<void>();
    const databaseLane = Effect.gen(function* () {
      // Core's bundle is built (once per process) while the branch is made; the deploy waits for it (bundle.ts).
      yield* warmApi();
      // The branch is made through Neon's API first (src/parts/database/neon.ts); the deploy adopts it by name.
      // The world's keys on its bench, which only the deploy needs, minted beside its branch.
      const granting = watch.step(
        "grant",
        grant(plan.stage, plan.expiresAt, maxSites, { owner: plan.owner, grade: spec.grade ?? "private" }),
        steps.grant.name,
      );
      const branching = watch.step(
        "branch",
        Effect.gen(function* () {
          if (Option.isSome(plan.forkedFrom) && spec.snapshot === undefined)
            yield* makeForkable(plan.forkedFrom.value, plan.stage);
          const project = yield* projectId;
          const forkOf = Option.isSome(plan.forkedFrom)
            ? (yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(plan.forkedFrom.value))).branch
            : undefined;
          const from = spec.snapshot?.branch ?? forkOf;
          return yield* makeBranch(project, plan.stage, from, plan.expiresAt);
        }),
        steps.branch.name,
      );
      const [bench, made] = yield* Effect.all([granting, branching], { concurrency: 2 });
      const deploy = watch
        .step(
          "deploy",
          Effect.gen(function* () {
            const settings = {
              owner: plan.owner,
              grade: spec.grade ?? "private",
              expiresAt: plan.expiresAt,
              forkedFrom: plan.forkedFrom,
              bench,
              operatorToken: Option.fromUndefinedOr(spec.operatorToken),
              hub: { stage: hub.stage, doorUrl: hub.doorUrl },
              doorToken,
              branch: { id: made.id, connectionUri: made.connectionUri },
            };
            return yield* deployStage(plan.stage, Option.some(settings)).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(WorldOutput)),
            );
          }),
          steps.deploy.name,
        )
        .pipe(
          Effect.tap(() => Deferred.succeed(deployDone, undefined)),
          Effect.flatMap((output) => handle(output, { token: doorToken, database: made.connectionUri })),
        );
      const database = { door: reach.door, database: made.connectionUri };
      // The migrations and the index (once the chain answers) need only the branch; Core waits for the deploy.
      const [world] = yield* Effect.all(
        [
          deploy.pipe(
            // A world is up once its Core answers steadily: a new workers.dev address can be answered by Cloudflare's
            // edge with a 404 between two of Core's answers for some seconds (src/parts/api/steady.ts).
            Effect.tap((deployed) =>
              watch.step(
                "core",
                hostCore(deployed, spec, bench).pipe(Effect.andThen(steady(deployed.coreUrl))),
                steps.core.name,
              ),
            ),
          ),
          watch.step("migrate", migrate(made.connectionUri, spec.migrations ?? CORE_MIGRATIONS), steps.migrate.name),
          Effect.andThen(
            Deferred.await(chainUp),
            explained(database, watch.step("index", indexReady(database, INDEX_EVERY), steps.index.name)),
          ),
          // The caller's own work that needs only the deploy (a restore's sites), beside Core's start and the index.
          spec.onDeployed === undefined
            ? Effect.void
            : Effect.andThen(Deferred.await(deployDone), watch.step("site", spec.onDeployed(plan.stage))),
        ],
        { concurrency: 4 },
      );
      yield* Effect.logInfo(`world ${plan.stage}: deployed, migrated, the index is ready and Core answers`);
      return { world, bench };
    });
    const [funded, { world, bench }] = yield* Effect.all([chainLane, databaseLane], { concurrency: 2 });
    const companies = spec.companies ?? [];
    const sites =
      Option.isNone(bench) || Arr.isReadonlyArrayEmpty(companies)
        ? []
        : yield* watch.step("site", makeSites(plan.stage, bench.value, companies));
    if (Arr.isReadonlyArrayNonEmpty(sites))
      yield* Effect.logInfo(
        `world ${plan.stage}: sites ready: ${Arr.join(
          Arr.map(sites, (one) => one.site),
          ", ",
        )}`,
      );
    return { ...world, funded, sites } satisfies World;
  });

/** Starts the world's Core where its host runs it, when a host does (src/parts/api/host.ts); nothing otherwise. */
const hostCore = (world: World, spec: WorldSpec, bench: Option.Option<BenchGrant>) =>
  Effect.gen(function* () {
    const host = yield* CoreHost;
    if (Option.isNone(host)) return;
    const hosted = {
      world,
      operatorToken: spec.operatorToken ?? world.operatorToken,
      bench,
      siteKey: yield* secretOf(world.stage, SITE_KEY_ID, "text"),
      siteSecret: yield* secretOf(world.stage, SITE_SECRET_ID, "text"),
    };
    yield* host.value.start(hosted).pipe(Effect.mapError((message) => WorldNotReady.make({ part: "core", message })));
  });
