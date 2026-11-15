# blueprint-tools

How the blueprint is written and checked. Nothing here is a fact about Capxul: those are all in
`packages/blueprint`, which imports this package's door, `src/index.ts`.

| Where | What |
|---|---|
| `src/language/` | What a declaration is: `operation.ts` (a verb), `lifecycle.ts` (a thing's life, `Machine`), `promise.ts` (what a verb promises, today `Claim`), `starting-point.ts` (a named state a journey begins from), `gather.ts` (how a generated index composes its parts) |
| `src/checks/` | The delta check (`pnpm delta:check`): every verb has every format, or is on its ratchet; the formats; the declared names; the ratchets counted (`pnpm ratchets`) and the scorecard, both written inside `pnpm generate` |
| `src/render/` | How the blueprint's folders read as data (`layout.ts`, which `pnpm generate` uses to write the blueprint's indexes), and its pages, `packages/blueprint/generated/` (`pnpm claims`) |

The blueprint depends on this package for its language. What here reads the blueprint's own declarations (the
formats, the delta check, the pages) imports the blueprint's door by its path, `../../../blueprint/src/index.ts`,
rather than as a dependency: pnpm refuses a cycle of workspace dependencies (`ERR_PNPM_TASK_CYCLE` in `pnpm -r`). So
this package's door exports only the language, the declared names and the layout, never what imports the blueprint,
and those parts are reached only by this package's own entries and tests. The ratchets' counters read lint's
unmigrated lists the same way, through its door `../../../lint/src/door.ts` (lint depends on the blueprint). For the
same reason `pnpm generate` writes the counts and the scorecard by running this package's `ratchets --write` after
`packages/generate`, not from inside it.

```sh
pnpm --filter @capxul/blueprint-tools claims        # rewrite packages/blueprint/generated/
pnpm --filter @capxul/blueprint-tools delta:check   # also the root's `pnpm delta:check`
pnpm --filter @capxul/blueprint-tools ratchets      # also the root's `pnpm ratchets`; --write and --check in `pnpm generate`
```
