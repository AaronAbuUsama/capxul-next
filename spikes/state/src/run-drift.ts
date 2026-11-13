// Entry: checks one stage for drift and exits 0 when it is clean, 2 when the cloud no longer matches what was deployed
// and 1 when the check itself failed. `alchemy drift` in the pinned 2.0.0-beta.85 prints the drift but exits 0, so a
// scheduled job cannot alert on it; this is the same check with the exit code the later releases document.
// Usage: ./run.sh bun src/run-drift.ts <stage>
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Alchemist from "alchemy/Alchemist";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class StageMissing extends Schema.TaggedError<StageMissing>()("StageMissing", { usage: Schema.String }) {}

const DRIFT_FOUND = 2;

Effect.gen(function* () {
  const stage = process.argv[2];
  if (stage === undefined) return yield* new StageMissing({ usage: "run-drift.ts <stage>" });
  const stack = yield* Alchemist.importStack("alchemy.run.ts");
  const scan = yield* Alchemist.Drift.scan({ stack, stage });
  const found = scan.resources.map(({ fqn, status, reason }) => ({ fqn, status, reason }));
  yield* Console.log(JSON.stringify(found, null, 2));
  if (Alchemist.Drift.hasDrift(scan)) yield* Effect.sync(() => (process.exitCode = DRIFT_FOUND));
}).pipe(Effect.scoped, Effect.provide(Alchemist.layer()), BunRuntime.runMain);
