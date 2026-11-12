// The provisioner's door (aaron.alchemy-provisioning): deploy, park, resume and destroy one world's box. Callers never
// import Alchemy; a breaking Alchemy release changes this package only.
import * as Effect from "effect/Effect";
import { applyStage, type Applied } from "./alchemy.ts";
import { dockerBoxStack, type DockerBoxSpec } from "./docker-box.ts";
import { worldStage, type Placement, type Want } from "./stage.ts";

export { InvalidWorld, worldStage, boxName, type Placement, type Want, type WorldStage } from "./stage.ts";

export interface BoxOutput {
  readonly world: string;
  readonly box: string;
  readonly volume: string;
}

export interface ProvisionerConfig {
  /** Where Alchemy keeps each stage's state (under the repository's git-ignored `var/`). */
  readonly stateDir: string;
  /** The world box image. */
  readonly image: string;
  readonly hostNetwork?: boolean;
  readonly trustCa?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export class UnsupportedPlacement extends Error {
  readonly code = "UNSUPPORTED_PLACEMENT";
}

export interface Provisioner {
  /** Create the world's box and start it; deploying again converges on the same box. */
  readonly deploy: (world: string) => Effect.Effect<Applied<BoxOutput>, unknown>;
  /** Stop the box and keep its disk. */
  readonly park: (world: string) => Effect.Effect<Applied<BoxOutput>, unknown>;
  /** Start a parked box again, disk as it was. */
  readonly resume: (world: string) => Effect.Effect<Applied<BoxOutput>, unknown>;
  /** Remove everything the world's stage made, its disk included. */
  readonly destroy: (world: string) => Effect.Effect<Applied<BoxOutput>, unknown>;
}

/** A deploy's output resolved to plain strings; a destroy has none. */
const asBox = (applied: Applied<unknown>): Applied<BoxOutput> => {
  const out = applied.output as Partial<Record<keyof BoxOutput, unknown>> | undefined;
  if (out === undefined) return { summary: applied.summary, output: undefined };
  if (typeof out.world !== "string" || typeof out.box !== "string" || typeof out.volume !== "string") {
    throw new Error("the world stack returned an unexpected output");
  }
  return { summary: applied.summary, output: { world: out.world, box: out.box, volume: out.volume } };
};

export const provisioner = (placement: Placement, config: ProvisionerConfig): Provisioner => {
  if (placement !== "docker") {
    throw new UnsupportedPlacement(`the ${placement} placement is not built yet; docker is`);
  }
  const stack = (world: string, want: Want) => {
    const spec: DockerBoxSpec = {
      stage: worldStage(world, placement),
      want,
      image: config.image,
      ...(config.hostNetwork !== undefined ? { hostNetwork: config.hostNetwork } : {}),
      ...(config.trustCa !== undefined ? { trustCa: config.trustCa } : {}),
      ...(config.environment !== undefined ? { environment: config.environment } : {}),
    };
    return { stage: spec.stage.stage, stack: dockerBoxStack(spec) };
  };
  const deployAs = (want: Want) => (world: string) =>
    Effect.suspend(() => {
      const { stage, stack: s } = stack(world, want);
      return applyStage(s, stage, "deploy", config.stateDir).pipe(Effect.map(asBox));
    });
  return {
    deploy: deployAs("running"),
    park: deployAs("parked"),
    resume: deployAs("running"),
    destroy: (world) =>
      Effect.suspend(() => {
        const { stage, stack: s } = stack(world, "parked");
        return applyStage(s, stage, "destroy", config.stateDir).pipe(Effect.map(asBox));
      }),
  };
};
