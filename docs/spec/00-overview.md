# Spec overview

This thread owns the high-level specification. Other threads take each part
deeper and build it. A thread that changes a type here changes it here first.

## The model in one paragraph

**An eval** is a claim that can be checked, with an id. **A verdict** is one
check of one eval at one exact version. **A task** is a goal plus the evals
that define done. Tasks nest, and status rolls up as a query. **An
assignment** is one actor (an agent or a person) working one task. **The work
log** is an append-only list of entries: who did what, on which task, when, at
what cost. **A matter** is a decision, question, risk or commitment.

**A manager** is always on and multiplayer. It owns a scope, mediates
**pairs** of maker and checker, and shows its state through **an artifact**
built from a template. **A worker** finishes one assignment.

**swarmD is the library, and Capxul is its first user.** The ledger and the
manager are swarmD features. The evals, the team and the prompts are Capxul's
use of them.

## What is durable

| Durable Object | Holds | Spec |
|---|---|---|
| `LedgerDO`, one per project | eval catalog, verdicts, tasks, assignments, work log, matters, pairs, refs | [10-swarmd-ledger.md](10-swarmd-ledger.md) |
| `ManagerDO`, one per manager instance (it replaces `RouterDO`) | the manager's conversation, its workers' conversations, its template, its artifact connections | [20-swarmd-managers-and-pairs.md](20-swarmd-managers-and-pairs.md) |
| `SandboxDO`, one per worker instance | the container; the only place a machine verdict is produced | unchanged, plus `eval run` |
| `DirectoryDO` | namespaces, members, the catalog, projects | unchanged, plus `projects` |

## The documents

| File | Contents | Taken deeper by |
|---|---|---|
| [10-swarmd-ledger.md](10-swarmd-ledger.md) | the types, the SQLite tables, the control plane, verdict ingestion, roll-up rules | thread **S1** (swarmd) |
| [20-swarmd-managers-and-pairs.md](20-swarmd-managers-and-pairs.md) | `ManagerDO`, templates (chat, build, lead), the artifact, the pair protocol, signals, tools | threads **S2** and **S3** (swarmd) |
| [30-capxul-evals.md](30-capxul-evals.md) | every eval kind and its id grammar, generated evals, the runner contract, worlds and observation | thread **C2** (capxul-next) |
| [40-capxul-team.md](40-capxul-team.md) | the managers, workers, tools, connectors, secrets and prompt skeletons | thread **C1** and Mission Control |
| [50-design-book.md](50-design-book.md) | the record schema for the whole design (code: `packages/blueprint-engine`) | this thread, then step 2 |

## Decisions taken in this thread (7 November 2026)

1. The primitive is the eval. Status is only a query over verdicts.
2. Five levels:
   - L0 is code. It is not scored, but it must pass before a checker sees the work.
   - L1 is an operation.
   - L2 is a journey.
   - L3 is the system.
   - L4 is live traffic.
3. Who decides a verdict: a `machine`, an `agent` or a `person`. A machine verdict is posted only by a sandbox, from the runner's output. A model never asserts a pass.
4. Tasks nest, and evals roll up. Missions, briefs and units are all tasks.
5. The router becomes a manager. Pairs are mediated by code inside the manager, with typed messages. The manager's model decides only on signals.
6. swarmD hosts the artifact. One query is shown on the web, in Slack and in Pi.
7. The chat manager is redesigned on the ledger. It keeps the behaviour of `slack-router` and its 8 scenarios, not its code.
8. The ledger replaces Linear for this work (confirmed by Aaron, 7 November 2026).
9. The git host is a private GitHub repository, `AaronAbuUsama/capxul-next`.

## Accepted later

All 21 decisions on the decision board, accepted by Aaron on 7 November 2026: see
[docs/decisions/README.md](../decisions/README.md).

## Open

- **Connectors as gateways** (being redesigned in another thread): read and write tools out, events in, the secret kept in swarmD. PostHog is reached through its MCP server. This needs MCP-backed tools in swarmD, which is not built.
- **The stack** (C1).
- **Whether the Capxul devnet fits in a swarmD sandbox.** It needs anvil, the backend, the indexer and the bundler. This is a risk on the critical path; it is sized in 40.
