// The package's proofs, by name. Each one creates real worlds, checks what it sees, and writes its record, with its
// outcome and every check, to records/<name>.proof.json; each leaves the accounts as it found them.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import { ProofFailed } from "../common/failures.ts";
import { bundler } from "./cases/bundler.ts";
import { clock } from "./cases/clock.ts";
import { commands } from "./cases/commands.ts";
import { fails, interrupted, interruptedRun, keeps, timesOut } from "./cases/endings.ts";
import { fresh } from "./cases/fresh.ts";
import { hubProof } from "./cases/hub.ts";
import { resetProof } from "./cases/reset.ts";
import { patience } from "./cases/patience.ts";
import { limits, race, sweeps } from "./cases/shared.ts";
import { site } from "./cases/site.ts";
import { snapshot } from "./cases/snapshot.ts";

export const PROOFS = {
  commands,
  fresh,
  fails,
  timeout: timesOut,
  interrupted,
  keep: keeps,
  race,
  limits,
  sweep: sweeps,
  bundler,
  site,
  snapshot,
  patience,
  clock,
  hub: hubProof,
  reset: resetProof,
  // Not a proof by itself: the run that `interrupted` starts as its own process and interrupts.
  "interrupted-run": interruptedRun,
};
export type ProofName = keyof typeof PROOFS;

const isProof = (name: string): name is ProofName => Arr.contains(Rec.keys(PROOFS), name);

/** The names of the proofs, as the command line lists them. */
export const proofNames = Arr.join(Rec.keys(PROOFS), ", ");

/** Runs one proof by name. */
export const prove = (name: string) =>
  isProof(name)
    ? PROOFS[name]
    : Effect.fail(ProofFailed.make({ message: `no proof called ${name}; there are: ${proofNames}` }));
