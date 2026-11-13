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
  destroyTimeout: Config.Duration("WORLD_DESTROY_TIMEOUT").pipe(Config.withDefault(Duration.minutes(4))),
  /** A stage is ready after this many answers in a row from its Core (warmup.ts). */
  readyAnswers: Config.Int("WORLD_READY_ANSWERS").pipe(Config.withDefault(20)),
  /** The pause between two readiness probes, and between two sends of a call during the warm-up. */
  probeEvery: Config.Duration("WORLD_PROBE_EVERY").pipe(Config.withDefault(Duration.millis(500))),
  /** How long after a stage is ready a call that Cloudflare's edge answered (not routed yet) is sent again. */
  warmUp: Config.Duration("WORLD_WARM_UP").pipe(Config.withDefault(Duration.seconds(30))),
  /** Where run records are written, outside any world. */
  records: Config.String("RUNNER_RECORDS").pipe(Config.withDefault("records")),
  /** The accounts the inventory after a destroy reads. */
  cloudflareAccount: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  neonOrg: Config.String("NEON_ORG_ID"),
});
export type Settings = Config.Success<typeof Settings>;
