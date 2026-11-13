# @capxul/generate

The generators (`system.layout`). Every file under any `packages/<package>/src/generated/` is written here, from the
blueprint's records, and nowhere else (`tooling.facts-derivation`).

```bash
pnpm generate          # write every target; delete any other file under a src/generated/ folder
pnpm generate:check    # write nothing: name each file that differs, is missing or no target writes, then compile
                       # every package a target is in. pnpm test runs it, so CI does.
```

`generate:check` is what `sys:generated` claims: regenerating every generated file from the records gives no diff, and
the generated packages compile. It reads the checkout it lives in, so a commit's own copy, run in a clean checkout of
that commit, checks that commit.

- `src/main.ts`: the entry, and the only file that touches the disk, git or a compiler.
- `src/targets.ts`: every target, rendered in memory from the blueprint. To add a target, design it as a record first.
- `src/modules/writer/`: the shared writer, which heads each file `// Generated from blueprint by packages/generate. Do
  not edit. sha256:<hex>` over the rest of it (`tooling.generated-header`), and the comparison of a tree with the
  rendered targets.
- `src/modules/facts/`: `packages/lint/src/generated/facts.ts`, the names the lint rules read (`tooling.plugin`;
  `docs/design/tooling.md` section 3), and the span constants every `spans.ts` shares.
- `src/modules/b1/`: the B1 targets no hand-written code has to change for (`tooling.generated-targets`):
  `src/generated/spans.ts` in backend, sdk and cli; `packages/backend/src/generated/errors.ts` (one `Schema.TaggedError`
  per error); `packages/backend/src/generated/config/<environment>.ts` (one required-only `Config` per environment).

Not built yet, though `tooling.lane-gate` and `docs/design/tooling.md` section 7 design them: the workflow skeletons
(they need `StepTime` and `Timers` from a `packages/runtime` that does not exist), the SDK's error classes, handler
types, transition tables, migrations, `RequestTime` and `Schema.Finite`.

Two runs write the same bytes: keys and lists are sorted by code unit, files end with one newline and lines end in LF.
Generated files are not formatted.

Written by: the generator lane, and whoever designs a new target. Read by: `pnpm test`, the `SYSTEM.generated` eval.
