// The package's proofs, by name. Each one creates real worlds, checks what it sees, writes what it saw to
// records/<name>.proof.json beside the run records, and leaves nothing behind when it passes.
import * as Effect from "effect/Effect";
import { fails, interrupted, interruptedCheck, keeps, timesOut } from "./failures.ts";
import { fresh } from "./fresh.ts";
import { ProofFailed } from "./checks.ts";
import { limits } from "./limits.ts";
import { race, sweepCheck, sweepSetup } from "./shared.ts";

export const PROOFS = {
  fresh,
  fails,
  timeout: timesOut,
  interrupted,
  "interrupted-check": interruptedCheck,
  keep: keeps,
  race,
  limits,
  "sweep-setup": sweepSetup,
  "sweep-check": sweepCheck,
} as const;

const isProof = (name: string): name is keyof typeof PROOFS => name in PROOFS;

/** Runs one proof by name. */
export const prove = (name: string) =>
  isProof(name)
    ? PROOFS[name]
    : Effect.fail(new ProofFailed({ message: `no proof called ${name}; there are: ${Object.keys(PROOFS).join(", ")}` }));
