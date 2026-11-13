// Every scenario the runner runs, in order. A scenario is registered by adding it here: nothing is found by walking
// the disk, so a scenario that is not listed does not run, and the compiler sees every one.
import { recordExport } from "./examples/record-export.ts";
import type { Scenario } from "./scenario.ts";

export const scenarios: ReadonlyArray<Scenario> = [recordExport];
