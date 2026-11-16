// What `passed` means for each kind of run, in words (a summary's `what`), and why a journey run against the empty
// handlers did not end as it must (summary.ts).
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { failuresOf } from "./checks/checks.ts";
import type { RunRecord } from "./record.ts";
import type { Expectation } from "./summary.ts";

export const ONE_WORLD =
  "The registered journeys run through the runner in one world, made on a fleet hub by the platform this process serves, its starting worlds made in it once and saved, and the world reset in place to each journey's starting world before the journey. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world the run made, the one world included, was destroyed with nothing of it left in the accounts, but a world handed over to CI's teardown job (RUNNER_TEARDOWN=job), which destroys it.";
export const SHARED_WORLD =
  "The registered journeys run through the runner on a shared world that lives on (roadmap steps 2.3 and 2.4), which the run never resets or changes: before each journey whose starting world is made from a template, the shared world's template snapshot of it is restored into a new world of the run, and a starting world made by its steps is made by them. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world the run made was destroyed with nothing of it left in the accounts; the shared world is left as it was.";
export const WHAT: { readonly [E in Expectation]: string } = {
  pass: "The registered journeys run through the runner, each in fresh private worlds made by the platform this process serves, its starting world made for it. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world it made was destroyed with nothing of it left in the accounts.",
  "not-implemented":
    "The registered journeys run through the runner against Core's deployed empty handlers (a stage deployed with CAPXUL_HANDLERS=empty). Passed when every registered journey was in the run, every journey failed at its first step on the NotImplemented its first step's operation was answered (never passed, never died, no later step reached), every call was answered NotImplemented and passed every generic check, and every stage was destroyed with nothing of it left in the accounts.",
};

/** Every journey at once in one shared world (RUNNER_SHAPE=shared, worlds/side-by-side.ts), `atOnce` of them. */
export const sideBySide = (atOnce: number): string =>
  `Shared world, ${String(atOnce)} at once: the registered journeys run through the runner all at once, those of the shared world in one world made on the cluster by the platform this process serves, each building its own starting company by its steps with its own cast, and those about worlds each in a fresh world of its own; no world is reset or saved. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world the run made was destroyed with nothing of it left in the accounts, but a world handed over to CI's teardown job (RUNNER_TEARDOWN=job), which destroys it.`;

/** Why a journey that should fail at its first step on the empty handlers did not, or null when it did. */
export const whyNotRefused =
  (NOT_IMPLEMENTED: string, EXPECTATION: string) =>
  (record: RunRecord): string | null => {
    const ended = record.ended;
    if (ended === null) return `it did not run to an end: ${record.failure ?? "no failure recorded"}`;
    if (ended.as === "succeeded") return "it passed against the empty handlers";
    if (ended.as === "died") return `it died: ${ended.detail ?? ""}`;
    const onNotImplemented =
      ended.tag === NOT_IMPLEMENTED || (ended.tag === EXPECTATION && Str.includes(NOT_IMPLEMENTED)(ended.detail ?? ""));
    if (!onNotImplemented) return `it failed on ${ended.tag ?? "an untagged failure"}, not on ${NOT_IMPLEMENTED}`;
    if (record.calls.length === 0) return "it made no call";
    if (record.failedStep?.step !== 1)
      return `it failed at step ${record.failedStep?.step ?? "none"}, not at its first`;
    const reached = Arr.filter(record.steps ?? [], (step) => step.step > 1 && step.outcome !== "not reached");
    if (reached.length > 0) return `it reached step ${reached[0]?.step ?? ""} after its first failed`;
    const other = Arr.filter(record.calls, (call) => call.refusal !== NOT_IMPLEMENTED);
    if (other.length > 0)
      return `answered other than ${NOT_IMPLEMENTED}: ${Arr.join(
        Arr.map(other, (call) => `${call.operation} (${call.outcome} ${call.refusal ?? ""})`),
        ", ",
      )}`;
    const failed = failuresOf(record.calls);
    return failed.length === 0 ? null : Arr.join(failed, "; ");
  };
