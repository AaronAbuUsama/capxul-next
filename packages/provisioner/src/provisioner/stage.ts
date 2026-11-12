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

// The supervisor's own rule (packages/devnet local-config): 1 to 12 lower-case letters and digits, starting with a
// letter. It also fits Alchemy's stage names ([a-z0-9][-_a-z0-9]*) and a hostname label.
const WORLD_ID = /^[a-z][a-z0-9]{0,11}$/;

export class InvalidWorld extends Error {
  readonly code = "INVALID_WORLD";
}

/** The stage a world deploys to; refuses an id Alchemy or a hostname could not carry. */
export const worldStage = (world: string, placement: Placement): WorldStage => {
  if (!WORLD_ID.test(world)) {
    throw new InvalidWorld("world id must be 1 to 12 lower-case letters and digits, starting with a letter");
  }
  return { world, stage: `world-${world}`, placement };
};

/** The Docker name of a world's box, so `docker ps` reads as the world list. */
export const boxName = (stage: WorldStage): string => `capxul-${stage.stage}`;
