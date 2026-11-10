# Decisions

Every decision the rebuild rests on, where it is recorded, and who made it.

## Accepted by Aaron (7 November 2026)

All 21 recommendations on the [decision board](https://claude.ai/artifact/UWq8hpB2bh5uTJCAWvRRYu)
were accepted as recommended.

| Id | Decision | Recorded in |
|---|---|---|
| A1 | Effect 4 on Node, one Postgres; Ponder on the same Postgres | this page |
| A2 | Effect Workflow and Cluster on Postgres for durable work, behind a spike; DBOS is the fallback | this page |
| A3 | Behaviour split three ways: boundary (an operation is implemented by one rpc or one Core SDK flow), state (tables and state machines; other concepts through procedures), time (one durable process per long-lived object) | this page, `docs/spec/50-design-book.md` |
| A4 | The Core SDK owns every flow and all signing; the CLI calls one SDK method per command | this page |
| P1–P10 | The ten policies: claims, orphans, workflows, cross-concept writes, budgets, spans, events, tenancy, pre-v4, book against code | [policy-pack.md](policy-pack.md) |
| W1 | Agents book the old system and design the target without asking; Aaron reviews data model and boundaries per concept | this page |
| W2 | Several short workflows in parallel | this page |
| W3 | swarmD checkers on another model family (an Anthropic key) | this page |
| Y1 | `AaronAbuUsama/capxul-next` attached; work is pushed to a branch | this page |
| Y2 | Keys are asked for through the credential form when a task needs one | this page |
| Y3 | The new staging host is chosen at the spine | this page |
| Y4 | The connector gateway (PostHog through its MCP) is built by another thread | this page |
| — | The ledger replaces Linear for this work | this page |

## Decided by Aaron (8 November 2026)

| Id | Decision | Recorded in |
|---|---|---|
| `system.frozen-behaviour` | **The freeze keeps behaviour, not spelling.** The 215 operations stay as the list of capabilities, and what each acceptance claim requires to happen stays as its evals. The exact flags, `--json` shapes, refusal codes and wording are no longer frozen: the target book designs them as one consistent system. A refusal is a behaviour, and is checked by its code only where the target's error vocabulary keeps it. This supersedes the strict reading of the freeze, and P10's "the frozen text wins" for spelling. | `blueprint/shared/decisions.ts` |
| — | The old system is a reference for behaviour, not a baseline. The evals are not run against it first. Agents read its code for edge cases (contract reverts, money paths, permissions), and never port it. | this page |
| — | The as-is book is closed. The reviewed payments lane (`docs/as-is/payments.md`, K1 to K18), `docs/mission/findings.md` and the lane reports are kept. The unfinished lanes are archived in `docs/as-is/archive/`. | this page |

## Made by Claude while designing, recorded as records

Judgments made while building the books are `decision` records, typed and linked to the records
they affect, so the build lists them and a reviewer can trace each one:

- `blueprint/shared/decisions.ts`: the target architecture (concept map, components,
  vocabulary, integrations, contracts), explained in [target-architecture.md](target-architecture.md).
- `blueprint/<concept>/decisions.ts`: each concept's target design.

The archived as-is book records no decisions: it recorded what the old code does.
