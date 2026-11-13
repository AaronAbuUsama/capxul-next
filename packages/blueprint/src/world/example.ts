// One world as `world.show` answers it, used by the declarations' examples. Not a starting world: those are in
// ../starting-worlds.ts.
import type { WorldView } from "../values.ts";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export const exampleWorld: typeof WorldView.Type = {
  world: "town",
  owner: "ci",
  grade: "private",
  state: "running",
  expiresAt: "2026-11-13T11:00:00Z",
  door: "https://w-town.capxul-world.example.workers.dev",
  chainId: 84532,
  clock: { mode: "frozen", now: "2026-11-13T09:00:00Z" },
  recordHead: 1,
  parent: null,
  cast: [
    { person: "dana", email: "dana@cast.test", signer: address(1), safe: address(11) },
    { person: "eli", email: "eli@cast.test", signer: address(2), safe: address(12) },
    { person: "sam", email: "sam@cast.test", signer: address(3), safe: address(13) },
    { person: "pat", email: "pat@cast.test", signer: address(4), safe: null },
    { person: "olga", email: "olga@cast.test", signer: address(5), safe: address(15) },
  ],
  companies: [],
};

export const exampleAddress = address;
