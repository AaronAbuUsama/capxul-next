# Finish the original Capxul: retire its old book and harness, then climb

Two lineages now exist, and this package is the second:

- **capxul-next** takes every understanding of the last weeks into a rebuild: a typed design book, Frappe as the
  business system, the hill-climbing kit. It is a separate lineage and is not ported here.
- **The original Capxul** (`Xelmar-tech/infrastructure`) still has to be finished. This package is its code at its
  latest integration branch, `integration/factory` (commit `0d2be303e`, 6 November 2026), which already holds
  protocol-v4-product and everything merged before it. `integration/habitat` has 6 more commits (the devnet's warm
  start, #3893) not yet in it; merge or drop them first.

The job, and only this job: retire the original's old book and test harness, then build the new hill-climbing
machinery onto its existing code, map the system as it is into a design book, and climb its evals until it is done.

## 1. Retire the old book and harness

Read each before removing it; each removal is one pull request into the lane with its reason.

| What | Where | What it was | Retire how |
|---|---|---|---|
| The Build Book | `apps/docs/factory/` (3,210 files: operations, areas, journeys, contracts, decisions, evidence, exemptions, `incomplete.yaml`, `lane.yaml`) | The YAML book of the 215 operations, its evidence and its status | Its content becomes the new book's first records (step 3), then the folder goes |
| Its generator and gates | `packages/tools` (`docs generate-reference`, `docs check`, `docs generated-diff`) | Builds the reference and status from the YAML | Remove the book commands; keep the rest of the tools package |
| Its regeneration bot | `.github/workflows/book-regenerate.yml` and the `book/regenerate/*` branches | Regenerates the book after every lane merge | Delete the workflow and the branches |
| The factory runtime spike | `apps/factory/` | E0: one build-book operation run as a pi-durable agent | Delete (it is a spike) |
| The scenario harness | `packages/scenarios/` (the Acme saga, S1 to S13, on a devnet) | Acceptance oracles run through the CLI | Its stories become the new book's journeys and their evals (step 4), then the package goes |
| The vending bench | `packages/vending-bench/` | An agent benchmark on Capxul's money | Not the book: keep or drop by its own decision |

Keep the product: `apps/cli`, `apps/indexer`, `apps/mcp`, `apps/plugin`, `apps/sandbox`, `apps/docs` (the public
docs, without `factory/`), and `packages/backend`, `sdk`, `sdk-react`, `protocol`, `contracts`, `devnet`,
`aa-gateway`, `observability`, `tools`.

## 2. Build in the new machinery

From the starter kit (`hillclimb-kit.zip`): `packages/book` (the record system, its build, problems, gaps and derived
evals), `packages/evals` (the harness: a fresh world per eval, the real CLI with `--json`, the scoreboard and
`RunResult[]`, budgets measured on a quiet machine, the agent judge for `des:` through an OpenAI-compatible
endpoint), `packages/lint` (the house rules as an Oxlint plugin), `packages/portal` (the site from the book), the
kit's skills in `.swarmd/skills/` (also readable by Claude Code) and its agent profiles. Adapt each to this monorepo:
its pnpm workspace and catalog, its Vite Plus config, its devnet (`packages/devnet`) as the worlds' host, and its CLI
binary as the oracle.

## 3. Map the system as it is into a book

Write the book from behaviour, not from hopes:

1. **Operations.** The 215 operations are already listed with their claims and refusals in `_reference/frozen/
   operations.ts` (made from the old Build Book; `_reference/frozen/flags.ts` holds the CLI's flags). Each becomes a
   `defineOperation` whose claims are checked by running the real CLI against the devnet.
2. **Records under them.** The backend's tables, state machines, rpcs, workflows and integrations, and the v4
   contracts, as records, so the build can find the gaps (an unwritten table, an undriven transition, an unused call).
3. **Decisions.** Every judgment the code embodies that is not obvious, as a decision record; the old book's
   `decisions` and `exemptions` are the start.
4. **Known faults as failing evals.** `_reference/findings.md` (what is wrong with the system) and
   `_reference/payments-as-is.md` (payments' reviewed findings, K1 to K18) become claims whose evals fail today.

## 4. Point the harness at the real system and climb

The harness drives `capxul` with `--json` against a fresh devnet world per eval. The Acme saga's stories become the
journeys. Then derive the task tree from the book (one task per operation with its evals), and climb: a maker per
task, a checker on every change, an adversary on every money path, the machine evals deciding. Run it with Claude
Code as the orchestrator (stage 0 of the swarm design, `_reference/swarm.md`), or on swarmD as it is today.

## What is in this package

| Path | What |
|---|---|
| `./` | `Xelmar-tech/infrastructure` at `integration/factory`, `0d2be303e` |
| `FINISH-CAPXUL.md` | This file |
| `_reference/frozen/` | The 215 operations and the CLI's flags, made from the old Build Book |
| `_reference/findings.md`, `payments-as-is.md` | What is wrong with the system, and payments' findings |
| `_reference/design-book.md` | How a typed design book works (from capxul-next) |
| `_reference/swarm.md`, `swarm-templates.md` | How a manager and its pairs run a build, and the templates |

The starter kit is its own zip, `hillclimb-kit.zip`.
