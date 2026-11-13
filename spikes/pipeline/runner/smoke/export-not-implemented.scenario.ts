// The runner's own smoke scenario. It is not an acceptance scenario and is never run with scenarios/: it only
// proves the runner end to end against the EMPTY handlers. It calls `record.export` and passes when the call
// dies as "not implemented". Delete it once real scenarios pass against a real implementation.
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Core, expect, scenario } from "../scenario.ts";

export default scenario(
  "smoke: export is not implemented",
  Effect.gen(function* () {
    const core = yield* Core;
    const exit = yield* Effect.exit(core["record.export"]());
    yield* expect(Exit.isFailure(exit), "record.export answered, so the handlers are not the empty implementation");
    if (Exit.isSuccess(exit)) return;
    const said = Cause.pretty(exit.cause);
    yield* expect(Cause.hasDies(exit.cause) && said.includes("not implemented: record.export"), `record.export failed, but not as "not implemented": ${said}`);
  }),
);
