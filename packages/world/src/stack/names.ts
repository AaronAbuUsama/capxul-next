// The names every part of the package agrees on. Nothing here touches the outside world, and nothing here imports
// another package: the Workers' bundles include this file.
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** The Alchemy stack every world and the platform belong to. Every resource's name starts with it. */
export const STACK = "CapxulWorld";

/** The stage that owns what worlds share: the Neon project and the registry of world names. */
export const PLATFORM = "platform";

/** Every world's stage name starts with this, so a world can never be mistaken for the platform. */
export const WORLD_PREFIX = "w-";

/** Whether a stage of the stack is a world. */
export const isWorldStage = (stage: string): boolean => Str.startsWith(WORLD_PREFIX)(stage);

/** The stage that holds the world called `name`. A name already carrying the prefix is taken as it is. */
export const stageOf = (name: string): string => (isWorldStage(name) ? name : `${WORLD_PREFIX}${name}`);

/** The world's name without the prefix. */
export const nameOf = (stage: string): string => (isWorldStage(stage) ? Str.slice(WORLD_PREFIX.length)(stage) : stage);

/** The image repositories every world shares; the platform owns them. Lower case: Cloudflare's registry asks for it. */
export const IMAGE_PREFIX = `${Str.toLowerCase(STACK)}-`;
export const CHAIN_IMAGE = `${IMAGE_PREFIX}anvil`;
export const INDEX_IMAGE = `${IMAGE_PREFIX}ponder`;
export const BUNDLER_IMAGE = `${IMAGE_PREFIX}alto`;

/** The steps of a world's life. Each has a declared timeout, and each one that ran has its duration in the record. */
export const STEPS = [
  "admit",
  "claim",
  "grant",
  "register",
  "branch",
  "deploy",
  "migrate",
  "chain",
  "fund",
  "bundler",
  "index",
  "core",
  "site",
  "use",
  "park",
  "unsite",
  "destroy",
  "release",
] as const;
export const StepName = Schema.Literals(STEPS);
export type StepName = typeof StepName.Type;
