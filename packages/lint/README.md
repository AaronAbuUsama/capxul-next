# @capxul/lint

The Capxul lint plugin (`tooling.plugin`). Today it holds only `src/generated/facts.ts`, which `packages/generate`
writes from the blueprint: each concept's dependencies, door, backend and SDK files and line budget, each workflow's
steps and waits, and the span names with their `Spans` constants. The ten rules that read it come with T0
(`docs/design/tooling.md` section 3).

Never edit `src/generated/`: change the records and run `pnpm generate`. `pnpm generate:check` refuses a hand edit or a
stale file, and compiles this package.

Written by: `packages/generate` (the facts), the tooling lane (the rules). Read by: `pnpm generate:check`.
