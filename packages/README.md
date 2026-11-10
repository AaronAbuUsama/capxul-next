# packages

The code, one package per component (decision `system.layout`). Inside a package, `src/<concept>/` mirrors
`blueprint/<concept>/`, and another concept's code is imported only through its `door.ts`.

| Package | What it is |
|---|---|
| `blueprint-engine` | The blueprint's engine: record types, the builder and its checks. Builds `blueprint/`. |
| `portal` | Generates and serves the portal from the blueprint, the plan and the scoreboard. |
| `plan` | The plan CLI (`pnpm plan`), the plan's checks and the task tree. The data is in `plan/`. |
| `evals` | Runs the checks bound to evals and writes the scoreboard (`status/`). |
| `loop` | The agent runner, built on pi-durable. Runs the scripts in `loops/`. |
| `contracts` | The product's contracts (Foundry). |
| `sdk` | The product SDK. |
| `devnet` | The local chain and worlds. |
| `layout` | The layout check (`pnpm layout`): what may be at the top level, file sizes, READMEs. |

Every package has a README; `pnpm layout` fails when one is missing.
