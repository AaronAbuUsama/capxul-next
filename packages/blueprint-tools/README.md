# blueprint-tools

How the blueprint is written and checked. Nothing here is a fact about Capxul: those are all in
`packages/blueprint`, which imports this package's door, `src/index.ts`.

| Where | What |
|---|---|
| `src/language/` | What a declaration is: `operation.ts` (`verb(...)`, a verb a door serves, with who may call it, its spans, logs and the log of each refusal), `kinds.ts` (`refusal(...)` with its exit code, `event(...)`, and `kindOf`, which knows each by its mark), `work.ts` (a verb no door serves), `lifecycle.ts` (a thing's life, `Machine`), `promise.ts` (what a verb promises), `starting-point.ts`, `ratchet.ts` (what a ratchet is), `glossary.ts`, `gather.ts` |
| `src/checks/` | The formats (`formats(blueprint)`: machine, allowed, spans, logs, budget, promises, telemetry) and the delta check over them; the declared names; the ratchets counted and the scorecard; the count of the glossary's old words |
| `src/render/` | How the blueprint's folders read as data (`layout.ts`), and its pages (`renderPages(layout, blueprint)`) and glossary page, which `pnpm generate` writes |

It imports nothing of the blueprint (roadmap item 3.10): the blueprint passes itself in, to `formats(blueprint)` and
`renderPages(layout, blueprint)`, from its own tests and from `packages/generate`, whose entries run the commands:

```sh
pnpm delta:check   # every operation has every format, or is on that format's unmigrated list
pnpm ratchets      # every ratchet counted; --write and --check inside `pnpm generate`
pnpm words         # the old words' ratchet; `--where <word>` lists where one is
```
