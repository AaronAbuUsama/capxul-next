// The one place Alchemy's programmatic API is called: plan, then apply, one stage at a time.
import * as Alchemist from "alchemy/Alchemist";
import { AlchemyContext } from "alchemy/AlchemyContext";
import type { ConfiguredStack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface Applied<Output> {
  readonly summary: Alchemist.PlanSummary;
  readonly output: Output | undefined;
}

/** Alchemy's services, with its state under `stateDir` (git-ignored `var/`) rather than the caller's directory. */
const services = (stateDir: string) =>
  Layer.merge(
    Alchemist.layer(),
    Layer.succeed(AlchemyContext, { dotAlchemy: stateDir, dev: false, adopt: false, updateStateStore: false }),
  );

/** Deploy or destroy one stage of `stack`; the stage's state-store lease is held until the apply ends. */
export const applyStage = <Output, Req>(
  stack: ConfiguredStack<Output, Req>,
  stage: string,
  operation: "deploy" | "destroy",
  stateDir: string,
): Effect.Effect<Applied<unknown>, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const plan = yield* Alchemist.plan({ stack, stage, operation } as const);
      const output: unknown = yield* Alchemist.apply(plan);
      return { summary: plan.summary, output };
    }),
  ).pipe(Effect.provide(services(stateDir))) as Effect.Effect<Applied<unknown>, unknown>;
