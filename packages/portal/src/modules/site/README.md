# site

A built `Book` in, every page of the portal out, as plain typed data (`types.ts`). Nothing here knows about HTML,
Markdown or files: `render` draws a page model, `twins` prints it, `check` reads the result back.

```ts
const site = buildSite({ book, commit, concepts, conceptOf, waits, frozen, frozenOperations, direction });
```

## Pages

| Page id | Model | From |
|---|---|---|
| `index` | `OverviewPage` | counts, the waiting decisions, the concepts |
| `review` | `QuestionsPage` | every decision `waits` holds |
| `design` | `ArchitecturePage` | the hand-drawn diagram, then from the book: what runs where, the layers, one request traced, the Frappe boundary, what the book is silent on |
| `build` | `BuildPage` | every operation with its evals and its stand, by stand and by concept |
| `docs` | `CataloguePage` | the index of the catalogues |
| `docs/<name>` | `CataloguePage` | one catalogue: commands, events, errors, spans, then one index per kind of record |
| `eval`, `eval/<kind>` | `CataloguePage` | the four levels and their kinds with counts; every eval of one kind beside its subject |
| `concept/<id>` | `ConceptPage` | one concept and the records its folder exports |
| `operation/<id>` | `OperationPage` | one operation: the SDK call, a skeleton per return shape, its trace, its evals by kind |
| `<kind>/<id>` | `RecordPage` | every other record of a kind that has pages |

A child kind (transition, call, function, chainEvent) is an anchored section on its parent's page; the system is
the Overview. A page id gives three files: `<id>/index.html`, `<id>.md` and `data/<id>.json`.

## The stand: what this slice implements

`docs/design/portal.md` ("The stand") defines five stands, `specify | decide | build | observe | done`, computed
from the book **and the latest verdict per eval** read from `integration/build`.

This slice has no verdicts to read, so it implements the first three, from the book alone (`standOf` in
`internal/context.ts`). The targets are the operation and the one record it is `implementedBy`:

1. `specify` while a target has a problem or a gap;
2. `decide` while a decision that waits for Aaron names a target in its `affects`;
3. `build` otherwise.

How it differs from the design: `observe` and `done` are never given, because no eval has a verdict; and the
`specify` rule looks only at the operation and its direct implementer, not at everything the implementer reaches
(its tables, machines and calls). Both change when the ledger publishes verdicts and the reach is walked.

## What is generated, and from what

- A **JSON skeleton** (`internal/skeleton.ts`) is generated from a schema: a literal as itself, every other value as
  `<type>`. It is never a recorded response, and its label on the page says so.
- The **SDK call** is TypeScript generated from the implementing record: its `sdk` name and its input and output
  schemas as types. An rpc names no method, and the text says so.
- The **trace** (`internal/trace.ts`) is the implementing record's steps; under an rpc step, what that rpc's record
  lists. Where the book lists nothing, the row says "the book names none".
- A **count is a link**: a `Tile` carries the list it counts, and a catalogue's tile is the length of its table.
- **Eval kinds and levels** take their words from `docs/spec/30-capxul-evals.md` (`internal/evalKinds.ts`); the
  counts are computed from the book's derived evals.
- The **Frappe boundary** (`internal/boundary.ts`) is found through three hand-written pointers in
  `content/direction.ts`: the component id, the outside system an integration names, and the word `DocType`.

## Rules

- Hand-written words come in through `SiteInput.direction` (`content/direction.ts`), never from this module.
- Which decisions wait is the caller's predicate (`books/target/shared/waiting.ts`), shared with the judgments
  report, so the two lists cannot disagree.
- The same input gives the same site: no clock, no randomness, the book's own order.
