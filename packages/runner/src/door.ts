// The package's door. `main.ts` is the command line; everything here is what it, and a later CI job, run.
export { checkCall, failuresOf, stepsOf, CheckedCall, Check, Step, Timing } from "./checks/checks.ts";
export { checkEvents } from "./checks/events.ts";
export { door, runPlan, scenarioPlan, type Plan, type RunFailure } from "./run.ts";
export { RunRecord, slugOf, writeRecord } from "./record.ts";
export { Settings } from "./settings.ts";
