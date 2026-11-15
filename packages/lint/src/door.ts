// The lint package's door: what other packages may read of it. Today only the typed-once rules' unmigrated lists,
// which `pnpm ratchets` (packages/generate, src/ratchets.entry.ts) counts as ratchets R1 to R3.
export { unmigrated } from "./unmigrated.ts";
