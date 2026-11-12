// A world's stage: its Alchemy stage name and what the box should be doing (aaron.alchemy-provisioning).

/** Where a world's box runs. `machine` (a long-lived host with a real disk) is not built yet. */
export type Placement = "docker" | "e2b";

/** What a deploy asks of the box: running, or parked (stopped, disk kept). */
export type Want = "running" | "parked";

export interface WorldStage {
  readonly world: string;
  readonly stage: string;
  readonly placement: Placement;
}

/** The stack every world is a stage of. */
export const STACK = "capxul-world";

// Alchemy's stage names are [a-z0-9][-_a-z0-9]*; world ids are lower-case words joined by hyphens.
const WORLD_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_WORLD_ID = 40;

export class InvalidWorld extends Error {
  readonly code = "INVALID_WORLD";
}

/** The stage a world deploys to; refuses an id Alchemy or a hostname could not carry. */
export const worldStage = (world: string, placement: Placement): WorldStage => {
  if (!WORLD_ID.test(world) || world.length > MAX_WORLD_ID) {
    throw new InvalidWorld(
      `world id must be lower-case letters and digits in hyphen-joined words, at most ${MAX_WORLD_ID} characters`,
    );
  }
  return { world, stage: `world-${world}`, placement };
};

/** The Docker name of a world's box, so `docker ps` reads as the world list. */
export const boxName = (stage: WorldStage): string => `capxul-${stage.stage}`;
