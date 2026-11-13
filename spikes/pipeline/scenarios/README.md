# scenarios

Empty on purpose. The acceptance scenarios of the pipeline spike are written here by a separate agent, not by the
agent that built the runner and not by the agent that implements the operations.

The rules for whoever writes them:

- A scenario proves one of the numbered acceptance claims in `../contract/README.md`, through the door only: the
  typed client it is handed. It never reads the database.
- **A scenario must fail against the empty handlers first.** Run it before anything is implemented and keep the
  failing run record. A scenario that passes against an empty handler proves nothing and is rejected.
- A scenario holds no check of events, spans or speed. The runner applies those to every call it makes.
- One file per scenario, named `<something>.scenario.ts`, whose default export is `scenario(name, program)` from
  `../runner/scenario.ts`. The program gets `Core` (the client) and `TraceIds` as services, and each scenario runs
  in its own fresh world:

```ts
import * as Effect from "effect/Effect";
import { Core, expect, scenario } from "../runner/scenario.ts";

export default scenario(
  "<the claim, as one sentence>",
  Effect.gen(function* () {
    const core = yield* Core;
    // A call returns the operation's success. A refusal or a defect fails the scenario unless it is handled.
    const answer = yield* core["record.append"]({ key: "<key>", kind: "<kind>", body: { any: "json" } });
    // To expect a typed refusal, flip the call: `refusal` is then the operation's declared error.
    const refusal = yield* Effect.flip(core["record.append"]({ key: "<key>", kind: "<kind>", body: null }));
    yield* expect(/* what the claim says */ true, "<what was seen instead>");
  }),
);
```

Run them all with `./run.sh scenarios` from `spikes/pipeline` (see `../README.md`).
