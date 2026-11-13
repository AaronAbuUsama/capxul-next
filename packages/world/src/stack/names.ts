// The names every part of the package agrees on. Nothing here touches the outside world.
import * as Schema from "effect/Schema";

/** The Alchemy stack every world and the platform belong to. Every resource's name starts with it. */
export const STACK = "CapxulWorld";

/** The stage that owns what worlds share: the Neon project and the registry of world names. */
export const PLATFORM = "platform";

/** Every world's stage name starts with this, so a world can never be mistaken for the platform. */
export const WORLD_PREFIX = "w-";

/** A world's name as people give it: short, lower case, so that every resource name made from it is valid. */
export const WorldName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,13}[a-z0-9]$/));

export class InvalidWorldName extends Schema.TaggedError<InvalidWorldName>()("InvalidWorldName", {
  name: Schema.String,
  message: Schema.String,
}) {}

/** The stage that holds the world called `name`. A name already carrying the prefix is taken as it is. */
export const stageOf = (name: string): string => (name.startsWith(WORLD_PREFIX) ? name : `${WORLD_PREFIX}${name}`);

/** The world's name without the prefix. */
export const nameOf = (stage: string): string => (stage.startsWith(WORLD_PREFIX) ? stage.slice(WORLD_PREFIX.length) : stage);

/** Whether a stage of the stack is a world. */
export const isWorldStage = (stage: string): boolean => stage.startsWith(WORLD_PREFIX);

/** The image repositories every world shares; the platform owns them. Lower case: Cloudflare's registry asks for it. */
export const IMAGE_PREFIX = `${STACK.toLowerCase()}-`;
export const CHAIN_IMAGE = `${IMAGE_PREFIX}anvil`;
export const INDEX_IMAGE = `${IMAGE_PREFIX}ponder`;
