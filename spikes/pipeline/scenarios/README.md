# scenarios

The acceptance scenarios of the pipeline spike: one per numbered claim in `../contract/README.md`. They were written
by a separate agent, not by the agent that built the runner and not by the agent that implements the operations,
and the agent that implements the operations may not edit them.

| File | Claim | What it does |
|---|---|---|
| `claim-1-append-seq.scenario.ts` | 1 | Five appends in a fresh world; the seqs must be 1, 2, 3, 4, 5. |
| `claim-2-duplicate-key.scenario.ts` | 2 | Two appends, then the first key again twice (identical, then with another kind and body): each refused with `DuplicateEntry` naming the key, the export the same as before, and the next append gets the next seq. |
| `claim-3-export-entries.scenario.ts` | 3 | Six appends whose bodies cover every shape of json; the export must hold exactly those six, lowest seq first, each as appended. |
| `claim-4-export-fresh.scenario.ts` | 4 | An export with nothing appended; it must answer with no entries. |
| `claim-5-append-event.scenario.ts` | 5 | Three accepted appends and two refused ones, so that the runner's `events` check sees both kinds of call. |
| `record.ts` | | What they share: `append`, `appendRefused`, `exported`, and how entries are compared and shown. |
| `red-records/` | | The run record of each scenario against the empty handlers: the proof that each failed first. |

## What claim 5 does not prove

Nothing any more: this gap is closed by the runner's payload check. Claim 5 says each successful append emits
exactly one `record_appended` event **carrying its key and seq**. An event cannot be seen through the door, so the
claim rests on the runner's generic `events` check (`../runner/events.ts`). That check used to compare only the
**names** of the events recorded under a call's trace id, so an append that emitted
`record_appended { key: "", seq: 0 }` would have passed. The contract now declares what the event carries as a
function of the call (`{ key: payload.key, seq: success.seq }`, in `../contract/record.ts`), and for every
successful call the runner requires the recorded payload to be exactly that, computed from what the scenario sent
and what Core answered. So "exactly one for a success", "none for a refusal" and "carrying its key and seq" are
all proven by the calls this scenario makes, and no scenario had to change.

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
