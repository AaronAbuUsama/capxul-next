// The runner's declared settings. Each has a default and can be set in the environment (run.sh sets the keys).
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";

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
  destroyTimeout: Config.Duration("WORLD_DESTROY_TIMEOUT").pipe(Config.withDefault(Duration.minutes(4))),
  /** A stage is ready after this many answers in a row from its Core (warmup.ts). */
  readyAnswers: Config.Int("WORLD_READY_ANSWERS").pipe(Config.withDefault(20)),
  /** The pause between two readiness probes, and between two sends of a call during the warm-up. */
  probeEvery: Config.Duration("WORLD_PROBE_EVERY").pipe(Config.withDefault(Duration.millis(500))),
  /** How long after a stage is ready a call that Cloudflare's edge answered (not routed yet) is sent again. */
  warmUp: Config.Duration("WORLD_WARM_UP").pipe(Config.withDefault(Duration.seconds(30))),
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
  /** The accounts the inventory after a destroy reads. */
  cloudflareAccount: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  neonOrg: Config.String("NEON_ORG_ID"),
});
export type Settings = Config.Success<typeof Settings>;
