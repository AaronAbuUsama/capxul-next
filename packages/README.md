# packages

The code, one package per component (decision `system.layout`). Inside a package, `src/<concept>/` mirrors
`books/target/<concept>/`, and another concept's code is imported only through its `door.ts`.

| Package | What it is |
|---|---|
| `book` | The blueprint's engine: record types, the builder and its checks. Builds the blueprint (today in `books/`). |
| `portal` | Generates and serves the portal from the blueprint, the plan and the scoreboard. |
| `evals` | Runs the checks bound to evals and writes the scoreboard (`status/`). |
| `loop` | The agent runner, built on pi-durable. Runs the scripts in `loops/`. |
| `contracts` | The product's contracts (Foundry). |
| `sdk` | The product SDK. |
| `devnet` | The local chain and worlds. |

Every package has a README; `pnpm layout` fails when one is missing.
