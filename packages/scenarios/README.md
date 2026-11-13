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
| `src/<operation>/claim-<n>.ts` | The thin line's scenarios: one per claim of claims.md, 53 in all. |
| `src/support/` | What scenarios share: reading the world back through the operations, signing with the cast's test keys, waiting for background work, and the site's documents and reports (`books.ts` reads the books with the blueprint's site vocabulary, `Site`, which it re-exports). |
| `src/examples/` | Examples: scenarios that prove no claim, to show the format and to try the runner. |
| `test/registry.test.ts` | Unique names; each scenario proves a claim the blueprint declares, from its starting world; no claim twice. |
| `test/claims.test.ts` | Every claim of the twelve operations is proved by a scenario. |
| `test/empty-handlers.test.ts` | Every scenario fails against a Capxul whose every operation answers `NotImplemented`, on that refusal, and none passes or dies. Its chain is empty and each scenario is handed its starting world's example facts. It checks `records/empty-handlers.json` against the run. |
| `records/empty-handlers.json` | The run record of that: step 1.5's proof. Written by `pnpm record`, never by hand. |

## Declaring a scenario

A scenario is an Effect program that needs `Capxul`, and `Given` when it reads its starting world's facts. Name the claim it proves by its operation and
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

- A call fails with the operation's declared refusals, `NotSignedIn`, or `PayloadRejected` when its payload is not of
  its schema and so was never sent; a scenario that expects a refusal catches it by tag (`Effect.flip`,
  `Effect.catchTag`). A call that got no answer, or that the server died in, is a defect.
- `{ as: "dana" }` makes a call as that person of the world's cast; without it a call acts as the world's owner.
- `{ operator: "second" }` signs a call as the second operator; `{ at: view.door }` calls another world's door (one
  the scenario made or restored), as its owner or, with `as`, as one of its people.
- `capxul.chain.<read>(payload, { at? })` reads a world's chain through its door: the blueprint's `Chain.reads`.
- `yield* given(startingWorlds.paymentHeld)` answers the facts of the scenario's starting world, or of a world it is
  made from, typed by that world's schema: what the steps that made it answered, the operators' names, every call
  made in making it (claims.md lists what each world adds).
- `expect(holds, message)` fails the scenario with `ExpectationFailed` and the message, which the run record shows.
- `example(name, given, run)` declares an example. Examples prove no claim and are not counted in step 1.5.

## The client

`Capxul` is the SDK's client (`Sdk.layer(Capxul)`, roadmap step 1.9), which the runner supplies at a stage's doors,
with each call sent under its own trace id and recorded for the checks. `Given` is the starting world and its facts,
which the runner hands (packages/runner/src/given.ts). The site's vocabulary is the blueprint's (`Site`);
`src/support/books.ts` re-exports it under the names the scenarios use.

## Checks

`pnpm types` and `pnpm test`. `pnpm record` rewrites `records/empty-handlers.json` from a run; `pnpm test` fails
when the committed record and a run differ. The example `src/examples/record-export.ts` fails against the empty handlers
(`NotImplemented`), as every real scenario must.
