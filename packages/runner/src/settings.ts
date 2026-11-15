// The runner's declared settings. Each has a default and can be set in the environment (run.sh sets the keys).
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";

/**
 * How many times an observation read is sent when no answer comes back (a transport error): a read a check makes
 * before or after the step's call (`Observing`, never the step's own call), at most `tries` times, the waits between
 * them doubling from `backoff`. A decoded answer or refusal is never sent again (client.ts, `sendObserving`).
 */
export const ObservationRetry = Config.all({
  tries: Config.Int("RUNNER_OBSERVATION_TRIES").pipe(Config.withDefault(4)),
  backoff: Config.Duration("RUNNER_OBSERVATION_BACKOFF").pipe(Config.withDefault(Duration.millis(250))),
});
export type ObservationRetry = Config.Success<typeof ObservationRetry>;

export const Settings = Config.all({
  /** Who the stages of this run belong to. Core reads the same variable at deploy. */
  owner: Config.String("WORLD_OWNER").pipe(Config.withDefault("runner")),
  /** Deploy, migrations and the wait for Core's answers. */
  createTimeout: Config.Duration("WORLD_CREATE_TIMEOUT").pipe(Config.withDefault(Duration.minutes(4))),
  /** The run itself and the generic checks together. */
  useTimeout: Config.Duration("WORLD_USE_TIMEOUT").pipe(Config.withDefault(Duration.minutes(3))),
  /**
   * The same for a scenario in private worlds, whose own calls may make worlds (each about two minutes) and whose
   * checks read several worlds' databases.
   */
  worldUseTimeout: Config.Duration("WORLD_SCENARIO_TIMEOUT").pipe(Config.withDefault(Duration.minutes(20))),
  /**
   * How long the fleet hub a run brings up lives (src/worlds/hub.ts): longer than the run's one world (2.5 hours) and
   * the worlds its journeys make, which may not outlive it. The run takes it down at its end, or CI's teardown job does (`teardown`).
   */
  hubLifetime: Config.Duration("RUNNER_HUB_LIFETIME").pipe(Config.withDefault(Duration.hours(4))),
  /**
   * Who takes down a run in one world at its end: `run`, the run itself (the default); `job`, a later CI job (world.yml,
   * `teardown`), so the check reports its verdict first. With `job` the run still destroys each journey's own worlds
   * and records what it leaves (`oneWorld.handedOver`), but leaves its one world and its own hub up for that job,
   * which destroys every world the run's operators own; each world's expiry and the hub's lifetime back it up.
   */
  teardown: Config.Literals(["run", "job"], "RUNNER_TEARDOWN").pipe(Config.withDefault("run")),
  /** How an observation read is sent again when no answer comes back (`ObservationRetry` above). */
  observation: ObservationRetry,
  /**
   * How a run in one world runs its journeys: `serial`, one after another in the one world, reset in place before each
   * (the default); `shared`, every journey at once, each company journey building its own company in one shared world
   * and each journey about worlds in a world of its own (roadmap 4.8, decision D8), which is not built yet.
   */
  shape: Config.Literals(["serial", "shared"], "RUNNER_SHAPE").pipe(Config.withDefault("serial")),
  destroyTimeout: Config.Duration("WORLD_DESTROY_TIMEOUT").pipe(Config.withDefault(Duration.minutes(4))),
  /**
   * A stage is ready after this many answers in a row from its Core (warmup.ts). Five since no run has ever recorded
   * a relapse (an answer missed after the first), which the readiness record still counts (docs/design/run-time.md, 6c).
   */
  readyAnswers: Config.Int("WORLD_READY_ANSWERS").pipe(Config.withDefault(5)),
  /** The pause between two readiness probes, and between two sends of a call during the warm-up. */
  probeEvery: Config.Duration("WORLD_PROBE_EVERY").pipe(Config.withDefault(Duration.millis(500))),
  /** How long after a stage is ready a call that Cloudflare's edge answered (not routed yet) is sent again. */
  warmUp: Config.Duration("WORLD_WARM_UP").pipe(Config.withDefault(Duration.seconds(30))),
  /**
   * How a journey's calls reach Core: `sdk`, through the SDK's client; `cli`, through the command line (`--via=cli`),
   * each call the `capxul` command that makes it, run in this process (packages/cli, src/call.ts).
   */
  via: Config.Literals(["sdk", "cli"], "RUNNER_VIA").pipe(Config.withDefault("sdk")),
  /** Where run records are written, outside any world. */
  records: Config.String("RUNNER_RECORDS").pipe(Config.withDefault("records")),
  /**
   * The tokens a stage's two doors accept: the world's door token and the operator's token. Core reads the same
   * variables at deploy; run.sh makes a fresh pair for each run. Never logged or recorded.
   */
  doorToken: Config.Redacted("CAPXUL_DOOR_TOKEN"),
  platformToken: Config.Redacted("CAPXUL_PLATFORM_TOKEN"),
  /**
   * The second operator the starting world `nothing` promises: its name and its platform token. run.sh makes the
   * token; until the platform knows it, the second operator's calls are refused with NotSignedIn.
   */
  secondOwner: Config.String("WORLD_SECOND_OWNER").pipe(Config.withDefault("runner-2")),
  secondPlatformToken: Config.option(Config.Redacted("CAPXUL_SECOND_PLATFORM_TOKEN")),
  /** The shared world a run on it uses, and `./run.sh shared` makes or renews (src/shared/). */
  shared: Config.String("WORLD_SHARED").pipe(Config.withDefault("shared")),
  /** How long from now each renewal gives the shared world: the most a world may live. */
  sharedLifetime: Config.Duration("WORLD_SHARED_LIFETIME").pipe(Config.withDefault(Duration.days(7))),
  /** How long the shared world's own hub lives when it is brought up, or up again: the most a hub may live. */
  sharedHubLifetime: Config.Duration("SHARED_HUB_LIFETIME").pipe(Config.withDefault(Duration.days(30))),
  /** The accounts the inventory after a destroy reads. */
  cloudflareAccount: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  neonOrg: Config.String("NEON_ORG_ID"),
});
export type Settings = Config.Success<typeof Settings>;
