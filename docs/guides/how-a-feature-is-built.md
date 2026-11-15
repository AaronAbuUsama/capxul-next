# How a feature is built

The reasons and the detail behind the rules in [AGENTS.md](../../AGENTS.md), "One owner for every fact" and "How a
feature is built": where each fact lives, how a feature moves from idea to proof, and how it is measured. Agreed with
Aaron on 15 November 2026 ([decisions](../decisions.md), "How a feature is built" and the decisions after it).

Everything is about being measurable: a feature is done when its verdicts prove it and its measures are watched, not
when its code is written.

## Three sources

- **The blueprint** (`packages/blueprint`) says what Capxul does: its operations, refusals, events and starting
  points, as Effect declarations the product imports.
- **The world** (`packages/world`) says what runs where: the Alchemy stacks that create and destroy a world.
- **Verdicts** say what is proven, and **telemetry** says what happened (AGENTS.md, "One owner for every fact").

Every fact has one owner in code, so two places cannot disagree ([decisions](../decisions.md), "One source for every
fact" and "Generated, never typed twice"). The design behind it is [docs/design/blueprint.md](../design/blueprint.md).

## Who owns each fact

| Fact | Its one owner | Generated from it or checked against it |
|---|---|---|
| Operations, payloads, answers, refusals and exit codes, events, claims, starting worlds | The blueprint, in the verb's file under `src/things/<thing>/` | Core's server, the SDK, the CLI, the pages in `packages/blueprint/generated/`, the types of the scenarios' checks |
| A thing's lifecycle (3.4) | The blueprint, the thing's `lifecycle.ts` | The state schema, the closing refusal's `state` field, the `step` function Core moves state with, the SQL CHECK constraint (in a new migration whenever the states change: an applied migration is never edited), the diagram in the thing's page, the runner's path check, coverage |
| Who may call an operation (5.1) | The blueprint: roles declared once, `allowed` on each operation | Core's one standing check, the generated refusal steps |
| An operation's steps and logs (4.1) | The blueprint, the operation's own file (3.6) | The generic checks, the waits a budget leaves out |
| The pipeline's own work: worlds, resets, sites, starting worlds, journeys, the checks, proofs (3.6) | The blueprint, the domain `pipeline` | The runner's and the world's spans (4.7), the proof names in the roadmap |
| Telemetry names: the envelope, producers, step kinds, metrics, datasets, monitors (3.6) | The blueprint, `src/telemetry/` | The attribute constants, each process's resource, the datasets and routing `packages/platform` creates, Axiom's monitors and dashboards |
| Ratchets (3.6) | The blueprint's registry | `pnpm ratchets`, the dashboard's lines |
| The words for things (3.8) | The blueprint's glossary | Folder, package and command names, the docs, lint |
| Contract events and functions (3.1) | The compiled contracts in `packages/contracts` (`forge build`; Foundry runs in CI and in the agents' environment) | One generated ABI module, imported by the blueprint, Core and the indexer |
| Contract addresses on the seeded chain (3.1) | `packages/contracts/deployments/devnet.json` | One generated table, imported by Core and `packages/world` |
| The seeded chain state (3.2) | The contracts and their deploy script | `packages/contracts/state/core.json`, rebuilt by one command and checked in CI |
| A person's account (5.2) | The blueprint: grade groups, account version, the email's normalisation, the derivation | The salt Core sends to `claim`; checked against the contract's `safeAddressFor` |
| Capxul's own names on a company's site (3.1) | The blueprint, `src/common/site.ts` | A generated Python module in `packages/frappe-app` |
| What runs where, and where telemetry goes | `packages/world`, `packages/platform` | |
| What is proven | Verdicts on `proofs` (4.5); run records until then | The roadmap's step states |

The table is in the words the code uses today; the glossary's new words come with the rename ratchet (roadmap item
3.8).

## Why the loop runs in this order

- **A decision first**, because what Capxul promises is Aaron's to change, and the rest is the lead's call.
- **The blueprint delta before any code**, because everything that judges the build is generated from it: the types,
  the pages, the generic checks. The delta says what, never how, so the builder is free in how.
- **Journeys and checks written first, by another agent, failing on empty handlers**, so a journey proves the build
  and not only that someone wrote a test that passes.
- **Measured runs and watching after a deploy**, so a feature stays proven on what the deployed system records, not
  only on the day it merged.

## How it is measured

Every verdict holds, for every call: the operation and its version, the caller, its outcome or refusal, the caller's
and the server's milliseconds beside its budget, the spans of its declared parts, its logs, and the events it sent
with what each carried.

The generic checks read only that record, which is why they can run on every call of every journey without being
written per operation, and why they can run again on what a deployed system records.

Coverage is reported with every run: which moves of each machine, and which refused pairs of a state and an operation,
some journey step reached.

A budget is a target and never fails a run. The measure is the p95 across runs, read against the budget.

### Better over time

Once explainability holds, these are read across runs: tries to green per unit of work, journeys broken and how fast
they recovered, and speed and cost per journey. They are trends to read, not thresholds.

## Changing what works

Until a real caller exists (phase 8), nothing outside the repository calls an operation, so existing operations are
reshaped and renamed directly ([decisions](../decisions.md), "No callers, no compatibility"). From the first real
caller, a change runs side by side, then flips, then retires, each in its own pull request, so a caller is never broken
by a change it did not ask for and the old journeys stay green until nobody calls the old version.

## A new format reaches old work by a ratchet

A new or changed operation is born compliant with every format that exists; old work catches up in parallel and blocks
nothing. A format's roadmap item closes once the format is proven in full on one domain and its ratchet counts what is
left, so the format is usable at once. The list of what is left may only shrink, so it reaches zero without a freeze.
How a ratchet is declared and counted is in [docs/design/blueprint.md](../design/blueprint.md), part 4.
