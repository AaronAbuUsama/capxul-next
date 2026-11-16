# The logbook: where what happened is kept

For agents and people. The rules are in [AGENTS.md](../../AGENTS.md), "Three sources, one owner for every fact"; the
decisions are "State is not in git", "The logbook", "One write token for agents" and "No `state` branch" in
[docs/decisions.md](../decisions.md) (Aaron, 16 November 2026). Why it is built this way, measured, is the design note
[docs/design/state-store.md](../design/state-store.md).

**Not built yet.** The logbook is roadmap item K.2, in milestone 5 (Cleanup). Until it lands, read
"Until the logbook exists" below; the rest of this page says what it will be, so that nothing written today has to be
moved twice.

## The rule

A declaration is reviewed, so it lives in git. A fact about what happened is recorded, so it lives in the logbook.
Nothing is in both.

| In git | In the logbook |
|---|---|
| Source code, the blueprint's declarations, the starting worlds' definitions | Runs: each run's progress, its calls, timings and checks, from CI or a container |
| Generated files, which hold declarations only | Verdicts: what a CI run proved, written only by CI |
| The seeded chain state, rebuilt by `pnpm seed` | The state and evidence of each goal, milestone and item of the plan |
| The ratchets' counts and lists, which count the source at that commit | Tasks, made and closed as work goes |
| The plan: each goal, milestone and item, what it needs and the proof that makes it done | Asks for Aaron and his answers; threads; sitreps |
| Design notes, decisions, guides | The records of items already Done, imported from the `records/` folders |

What goes in neither: the run's detail (spans, logs, events), which is telemetry in Axiom, with each CI run's OTLP
archived in R2 by its digest; and anything secret.

A generated file never holds state. If the roadmap's tables showed each item's state, every verdict would make
`pnpm generate:check` fail until someone committed the new table.

## Until the logbook exists

- **Commit no record.** No file under a `records/` folder is added or changed from 16 November 2026. Runs in your
  container write to a temporary folder: `RUNNER_RECORDS=$(mktemp -d) packages/runner/run.sh ...`.
- **Cite a CI run as proof.** The Proof column names `ci:<workflow> run <run id>`, for example
  `ci:world.yml run 43796480962`, and the Evidence says which job and attempt and which head commit, as item 3.6 does.
  The run's detail is the artifact it uploaded, named after the run: `world-<run id>-<attempt>` (and `-teardown`) for
  `world.yml`, `shared-<run id>-<attempt>` and `platform-<run id>` for `platform.yml`, `drift-<run id>` for
  `drift.yml`. Artifacts are kept 90 days, long enough for K.2 to import them.
- **A run from your container is evidence, never proof.** Say what it showed in your pull request's text; prove the
  item with a CI run.
- **Records already committed stay** as the proofs of items already Done until K.2 imports them, repoints the
  roadmap and deletes them from the tree. History is not rewritten.
- **Running state for the sitrep** (asks, threads, sitreps) stays where it is today, in the sitrep page's own store,
  until K.2 moves it. It never goes on a branch.

## Reading it

Everything is read through the same verbs, generated from the blueprint, whoever asks: an agent through the CLI, CI
and the runner through the SDK, Aaron's app through the SDK. For example (the exact verbs are K.2's blueprint delta):

- `capxul run show <run>`: a run's progress, its journeys, steps, checks and timings, and where its detail is.
- `capxul verdict list --proof <name>`: the verdicts of one proof, newest first, each with the job that wrote it.
- `capxul plan show`: the plan from the blueprint, joined with each item's state and evidence from the logbook.
- `capxul task`, `capxul ask`, `capxul sitrep`: the running work.

Reads need no key. The run's detail is read from Axiom by its trace ids, or from R2 by the digest the verdict names.

## How CI writes a verdict

Only a GitHub Actions job of this repository can write a verdict, and it carries no key to do it:

1. The proving job asks GitHub for an OIDC token whose audience is the logbook (`permissions: id-token: write`).
2. It calls `verdict.record` with the verdict and the token.
3. The logbook checks the token's signature against GitHub's keys and its claims: this repository, a declared proving
   workflow (`job_workflow_ref`), and the verdict's own commit, run and attempt. Anything else is refused, and nothing
   is written.
4. A verdict from a pull request's run is recorded at once and counted when its commit lands on `master`, which the
   `check` job on `master` reports the same way. An item is Done when a counted, passing verdict of the proof it names
   exists.

Agents write with one token that the network proxy adds and no agent sees. It can write runs marked untrusted, tasks,
asks, threads and sitreps, never a verdict. Aaron's app signs in through Cloudflare Access.

## Where its declarations will live

- **Its things and verbs**: in the blueprint, `packages/blueprint/src/things/<thing>/`, one file per verb, each with
  its payload, answer, refusals, who may call it (`allowed`), steps, logs and budget, and the machine of each thing:
  `run` (already begun as a pipeline thing, with its verb `verdict`), `verdict` as a thing of its own, `task`, `ask`,
  `thread`, `sitrep`.
- **The plan** (goals, milestones, items): declared in the blueprint, changed by pull request; the roadmap's tables
  generated from it.
- **The word**: "logbook" is in the glossary (`packages/blueprint/src/glossary.ts`).
- **Where it runs**: a Cloudflare Worker on SQLite Durable Objects, with its files in the R2 bucket `capxul-logbook`,
  deployed with Alchemy as a long-lived stage. It is one of the three things allowed to outlive the work that made it,
  with the platform's stage and the shared world.
