// Entry: what the shared state still holds for the platform's stacks: every stage of CapxulPlatform and
// CapxulBenchHost, with the logical ids of its resources. After a destroy the stage is gone or holds nothing.
// Usage: bin/run.sh bun src/run-inventory.ts [stage]   (only that stage; prints "<stack>/<stage>: none" if absent)
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HOST_STACK, STACK } from "./names.ts";
import { withState } from "./state.ts";
import { exportLayer, PRODUCERS } from "./telemetry.ts";

Effect.gen(function* () {
  const only = process.argv[2];
  yield* withState("alchemy.run.ts", (state) =>
    Effect.forEach([STACK, HOST_STACK], (stack) =>
      Effect.gen(function* () {
        const stages = yield* state.listStages(stack);
        const wanted = only === undefined ? stages : Arr.filter(stages, (s) => s === only);
        if (only !== undefined && wanted.length === 0) yield* Console.log(`${stack}/${only}: none`);
        yield* Effect.forEach(wanted, (stage) =>
          Effect.flatMap(state.list({ stack, stage }), (fqns) =>
            Console.log(`${stack}/${stage}: ${fqns.length} resources ${Arr.join(fqns, " ")}`),
          ),
        );
      }),
    ),
  );
}).pipe(
  // With OTLP export, as OpenTelemetry's standard settings ask (src/telemetry.ts); flushed when the command ends.
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunServices.layer, exportLayer(PRODUCERS.sites))),
  BunRuntime.runMain,
);
