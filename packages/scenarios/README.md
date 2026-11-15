# scenarios

The thin line's journeys and each operation's checks (this package; docs/roadmap.md, "Scenarios are
journeys"). A journey is a story of operations in order, from one of the blueprint's starting points. Every call it
makes is judged by its operation's checks, written once, which run on every call of that operation in every journey.
The runner ([packages/runner](../runner/README.md)) makes the run and adds its generic checks to every call (events,
spans, timings), so neither a journey nor a check judges those.

Journeys and checks are written from the blueprint by an agent other than the builder, and each journey must fail at
its first step against the api's empty handlers, which answer every call `NotImplemented`. A builder never changes
this package ([AGENTS.md](../../AGENTS.md), "How work flows"). Every journey, in order, is
[`src/registry.ts`](src/registry.ts); why the lists are typed per domain is at the top of
[`src/domains.ts`](src/domains.ts).

## Declaring a journey

```ts
const steps = outline({
  found: ["org.create", "dana founds Northwind"],
  sign: ["approval.sign", "dana and eli sign its setup"],
});

export const founding = journey(
  { name: "found Northwind", key: "found", story: "…", given: startingWorlds.fresh, steps },
  Effect.gen(function* () {
    yield* steps.found.run((op) => op.answers("Founded", NORTHWIND_FOUNDING, { as: "dana" }));
    yield* steps.sign.run((op) => /* op.answers("Collected", …), op.answers("Sent", …) */);
  }),
);
```

A step calls one operation and says what each call expects: `op.succeeds`, `op.answers(kind)`, `op.refused(tag)`, or
a wait (`op.until`, `op.whileRefused`); anything else fails the step (`src/tries.ts`). `{ as: "dana" }` acts as a
person of the cast, `{ operator: "second" }` as the second operator, `{ at: view.door }` at another world's endpoint.
`yield* given(startingWorlds.paymentDrafted)` answers a starting point's facts. Reads after the tries (`expect`,
`same`, `src/support/`) are looks: no operation's checks run on them.

Journeys run side by side (roadmap step 4.11). Each declares a `key` (`Cast.JOURNEY_KEYS`) and acts as its own people
in its own company (`yield* Cast`: `{ as: cast.dana }`, `cast.company`, `src/cast.ts`). A check judges only what its own
call caused: the world's history by the call's traces (`CallTraces`), the chain by the journey's own accounts.

## Adding a journey or checks

Each domain of the blueprint has one file, `src/domains/<domain>.ts`, with `checks`, `journeys` (in the order they
run) and `coverage` (the place of each claim of its operations).

- **A journey**: a new file in `src/journeys/`; list it in its domain's `journeys`, and place the claims it checks in
  `coverage`; then `pnpm record`.
- **An operation's checks**: a new file `src/checks/<operation>.ts` declaring `checks({ before, success, refusals })`
  (`src/checks/format.ts`), each a sentence and the Effect that fails when it does not hold; then the domain's `checks`
  and one `coverage` place per claim. The compiler fails until both have every operation the blueprint declares.
- **A domain**: a new `src/domains/<domain>.ts` with the three exports, and its entry in `src/domains.ts`.

## Checks

`pnpm types` and `pnpm test`. `pnpm record` rewrites `records/empty-handlers/` from an in-memory run against the
empty handlers, one file per journey, and removes those of journeys no longer registered; `pnpm test` fails when the
committed files and a run differ. Never edit them by hand.
