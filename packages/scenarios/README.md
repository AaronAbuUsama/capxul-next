# scenarios

The acceptance scenarios of the thin line (roadmap step 1.5). Each scenario proves one claim of the blueprint
(`packages/blueprint/claims.md`) black-box: from the claim's starting world, through Capxul's door, reading only what
the operations answer. The runner (`packages/runner`) runs each in a fresh world and applies its generic checks to
every call: declared events, spans, and the timings it records. So a scenario never checks those itself.

The scenarios are written by an agent other than Core's builder, before the build, and each must fail against Core's
empty handlers, which answer every call with `NotImplemented`. A builder never changes this package.

| File | What it holds |
|---|---|
| `src/door.ts` | The door: everything below. The runner imports it. |
| `src/scenario.ts` | The format: `scenario`, `example`, `expect`, `ExpectationFailed`, and the `Scenario` the runner reads. |
| `src/client.ts` | `Capxul`, the one service a scenario is handed: a typed client with one function per blueprint operation. |
| `src/registry.ts` | `scenarios`, every scenario the runner runs, in order. |
| `src/examples/` | Examples: scenarios that prove no claim, to show the format and to try the runner. |
| `test/registry.test.ts` | Unique names; each scenario proves a claim the blueprint declares, from its starting world; no claim twice. |

## Declaring a scenario

A scenario is an Effect program that needs `Capxul` and nothing else. Name the claim it proves by its operation and
its number in claims.md; its name and starting world come from the claim.

```ts
// src/org-create/claim-1.ts
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";

export const orgCreate1 = scenario(
  { operation: "org.create", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const founded = yield* capxul["org.create"]({ ... }, { as: "dana" });
    yield* expect(founded._tag === "Founded", `org.create answered ${founded._tag}`);
  }),
);
```

Then register it: import it in `src/registry.ts` and add it to `scenarios`. Nothing is found by walking the disk.
Put each in `src/<operation with dots as dashes>/claim-<n>.ts`.

- A call fails with the operation's declared refusals, or `NotSignedIn`; a scenario that expects a refusal catches
  it by tag (`Effect.flip`, `Effect.catchTag`). A call that got no answer, or that the server died in, is a defect.
- `{ as: "dana" }` makes a call as that person of the world's cast; without it a call acts as the world's owner.
- `expect(holds, message)` fails the scenario with `ExpectationFailed` and the message, which the run record shows.
- `example(name, given, run)` declares an example. Examples prove no claim and are not counted in step 1.5.

## The client

`Capxul` stands in for the SDK's client (roadmap step 1.9): when the SDK lands it supplies this service, and the
scenarios do not change. Until then the runner supplies it, from the blueprint's Rpc groups, with each call sent
under its own trace id and recorded for the checks.

## Checks

`pnpm types` and `pnpm test`. The example `src/examples/record-export.ts` fails against the empty handlers
(`NotImplemented`), as every real scenario must.
