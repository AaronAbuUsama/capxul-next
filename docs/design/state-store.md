# The logbook: state out of git

Status: open. Written 16 November 2026 by a 📐 designer thread for the 🎼 conductor, from Aaron's words of that day:
"saving stuff to the repo is actually kind of bad. I want to stop doing that and purge it all." He refused a `state`
branch that agents would write to. Nothing here is agreed until Aaron says yes in writing; the decisions it needs are
in section 7.

**The recommendation in one paragraph.** Git keeps what we write and review: source, declarations, generated files,
the seeded chain, design notes. Everything that _happens_ goes to one store outside git, **the logbook** (not "ledger", which the glossary retires): a Cloudflare
Worker whose state is SQLite-backed Durable Objects, with blobs in R2 and the run detail in Axiom, as already agreed.
Its things (run, verdict, task, ask, thread, sitrep, and the live state of the plan's goals and milestones) are
declared in the blueprint like any other, machines included, so the CLI and the SDK get its verbs generated and
agents, CI and Aaron's app all make the same calls. Only CI can write a verdict, and it proves who it is with GitHub's
OIDC token, which the logbook verifies itself: no stored key, no `proofs` branch, no hourly re-verification. Existing
records move to R2, the roadmap's proofs are repointed, and the records are deleted from the tree. History is **not**
rewritten: measured below, it would free about 3.5 MB of an 80 MB clone, break 431 branches and need a force-push.

## 1. What lives in git today, measured

Measured on `master` at a1d26ff, 16 November 2026. "Tip" is the checked-out tree; "pack" is what a clone downloads
(compressed, every reachable version).

### State: written by runs and agents, not by review

| What | Files at tip | Bytes at tip | Commits touching it | Who writes it | Who reads it |
|---|---|---|---|---|---|
| `packages/runner/records` | 212 | 44.0 MB | 36 | agents, by hand from runs in their containers; CI uploads the same as an Actions artifact and commits nothing | the roadmap's Proof column (by path), `status-feed`, people |
| `packages/world/records` | 80 | 0.65 MB | 29 | agents, from `world` proof commands | the roadmap (0.1 to 1.16) |
| `packages/platform/records` | 145 | 0.36 MB | 17 | agents, from drift, rehearsal and site-pool runs | the roadmap (1.8, 1.17, 2.1 to 2.5), decision "One runner, one world" |
| `packages/scenarios/records` | 9 | 7 KB | 20 | the scenario author, from empty-handler runs | the roadmap (3.6) |
| `packages/frappe-app/records` | 3 | 31 KB | 1 | an agent | the roadmap (0.8) |
| `spikes/world-speed/records`, `spikes/containers/records` | 96 | 1.34 MB | 2 | agents | the roadmap (0.6), decisions |
| **All records** | **545** | **46.4 MB** | **155 commits** (143 by Claude, 10 by Aaron, 2 by Amp) | | |
| `docs/roadmap.md`: Status, Evidence and Proof columns | 1 | 56 KB | 143 (67 of `master`'s 203 merges) | leads and the conductor, by hand | `status-feed`, people, the sitrep |
| `packages/status-feed` | code only | | 9 | | builds the dashboard's files into `var/` (not committed) from the roadmap and the records |

The records are 72% of the tip's 64.7 MB. Of `master`'s 203 first-parent commits, 46 touched records and 17 changed
nothing but records, the roadmap or the decisions: a pull request, a `gate` run and a landing slot each, to say what
happened.

### Source: written and reviewed, stays in git

- **The seeded chain** (`packages/contracts/state/core.json` 5.75 MB, `pin.genesis.json`, `deployments/devnet.json`):
  rebuilt by `pnpm seed`, checked by `pnpm seed:check`. It is an input every world starts from, owned by the
  contracts. Source.
- **Generated files** (`generated/` folders, `docs/design/README.md`): derived and checked by `pnpm generate:check`.
  Source, as long as nothing generated depends on what happened (section 6 keeps it that way).
- **Ratchet counts** (`packages/blueprint/generated/ratchets.json`, `old-words.json`, the lint `unmigrated` lists):
  these look like state but are not: each is a count of the source at that commit, and a pull request that changes the
  source must change the count with it. Source.
- **Design notes, decisions, the plan's declarations**: reviewed text. Source.

### The costs, checked

| Cost the conductor named | Measured | Holds? |
|---|---|---|
| Bloat in every clone | Records are 44 MB of a 65 MB checkout, but JSON compresses about 13 to 1: their 698 versions in history are **3.5 MB of the 80 MB pack**. The pack's weight is elsewhere: 41 MB of screenshots under `archive/docs/handoff` from the older lines, 2 MB of design shots, 2 MB of kit bundles | For the checkout, yes. For the clone and history, mostly no |
| A pull request, gate and landing slot per state update | 17 of 203 merges to `master` were state only; 46 carried records; 67 changed the roadmap | Yes |
| 147 commits touching records | 155 | Yes |
| Churn that forces leads to re-merge `master` | Every roadmap edit is a conflict risk on the one file every lead edits at its slice's landing | Yes |
| Anyone with push can write a passing record | 143 of 155 record commits are agents' hand commits from their containers; nothing tells them from CI's | Yes: the reason step 4.5 exists |
| The sitrep's data in an artifact database, the roadmap's state in git | Both true: two stores for one picture | Yes |
| Special cases for records | `.oxlintrc.json` (two edges for record files), `packages/lint/src/docs.ts` (Markdown under `records/`, one README listed), `packages/blueprint-tools/src/checks/word-files.ts` (`records` skipped by the old-words count), `world.yml` and `platform.yml` (`paths-ignore` for records) | Yes, five places |

Costs the conductor missed:

1. **Proof by path is fragile.** 34 roadmap rows cite 49 distinct record paths. A rename or a move breaks the proof
   silently; `status-feed` treats a file's existence as the step's proof.
2. **CI's records are already off git, and expire.** `world.yml`, `platform.yml` and `drift.yml` write records to
   `$RUNNER_TEMP` and upload them as Actions artifacts, kept 90 days at most. The trusted runs' records are the ones
   that vanish; the untrusted ones are kept forever. Step 3.6 already cites a CI run id instead of a path.
3. **The Evidence column is state written as prose.** The longest cells of the roadmap (1.6, 2.3, 3.6) are run
   reports. They grow with every attempt and are re-merged by every lead.
4. **Records are not queryable.** "Every call's p95 against its budget across the last 20 runs" means opening 20
   one-megabyte JSON files; nothing indexes them.
5. **The rule "everything you make is destroyed" has no home for something meant to last.** The shared world and the
   platform stage are already exceptions, written in prose; a store is a third.

## 2. What the store holds

| Thing | Its states (machine) | Written by | Kept |
|---|---|---|---|
| `run` | started, preparing, running, judging, judged, torn down; failed from any | the runner (CI or a container) | its row forever; live progress while it runs |
| `verdict` | recorded, counted, not counted (`NotCounted`, already declared in `run/values.ts`) | CI only (section 4) | forever, a few kilobytes each |
| run detail | none: a blob | the runner, uploaded to R2 by digest | 180 days (decision 5 of proof and telemetry) |
| telemetry | none | every producer, through the door | Axiom's retention (as agreed) |
| `task` | open, claimed, in review, done, dropped | leads and builders; done only by a merge or a verdict | forever |
| goal, milestone, step: their **state** | not started, in progress, done, claimed | derived from verdicts and merges, never typed | forever |
| goal, milestone, step: their **declaration** | none | the blueprint, by pull request (the plan; section 8) | git |
| `thread`, `ask`, `sitrep` (the sitrep note's things) | as in `docs/design/sitrep.md`, section 1 | agents through the CLI; Aaron's answers through the app | forever |
| legacy file | none: imported, frozen | the migration, once | forever, marked legacy |

The line between git and the logbook is one rule: **a declaration is reviewed, so it lives in git; a fact about what
happened is recorded, so it lives in the logbook.** A step's name, needs and proof name are declarations. Its state, its
evidence and its done time are facts.

## 3. Options

Costs are list prices as of writing, against the cap of $10 a day for Cloudflare and Neon together. The volume they
assume: 50 runs a day, each writing about 1,000 rows (one per call, step and check) and one 20 MB OTLP archive; a few
hundred task, ask and sitrep writes a day; the app and agents reading a few thousand times a day.

| Option | Trust (who can write a verdict) | Cost a day at that volume | Latency from a runner or container | How agents and the app use it | One owner? |
|---|---|---|---|---|---|
| **A. Logbook Worker on SQLite Durable Objects, blobs in R2** | The Worker verifies GitHub's OIDC token for CI writes; agents carry a write token scoped to their kinds | Under $0.10: inside the Workers Paid plan already paid for Containers (1M requests, 50M rows written and 5 GB a month included); R2 about $0.09 at 180 GB held | 20 to 80 ms; one object per run, placed near CI (`weur`) | Rpc through the door, verbs generated from the blueprint; the app can also watch a run live over a WebSocket | Yes: declared things, one server, one store |
| B. Neon tables in a long-lived project | Same Worker in front, or Postgres roles | 0.25 CU always on is about $0.85; with scale to zero less, but each cold start costs 0.3 to 0.7 s | 5 to 50 ms warm | SQL from the Worker; the app needs the Worker anyway | Yes, but it shares a vendor and a sweeper with the per-world branches it must never be swept with |
| C. D1 | As A | Near nothing (5M reads and 100k writes a day free) | 30 to 100 ms | SQL from a Worker | Yes |
| D. Axiom alone | Anyone with the ingest key can write any event; no write-time check | Within the plan's ingest | 0.5 to 2 s a query | APL queries | No: a sink with retention, not a record. It already holds the detail, which is its job |
| E. GitHub Actions artifacts and checks | Trusted (only a workflow sets a check) | Free, against Actions minutes | 200 to 500 ms an API call, 5,000 calls an hour | REST across many runs; artifacts expire in 90 days; attestations need Enterprise Cloud on a private repository | No: a notary, not a store |
| F. Git, as `proofs` (step 4.5) or a `state` branch | Only with the check of E beside it | Free | a fetch and a push; conflicts between writers | git | Refused by Aaron for state; for verdicts it keeps every cost of section 1 but the checkout's size |
| G. A tracker (Linear, GitHub Projects) for tasks | Its own users | Free to low | 200 to 500 ms | Its API, not ours | No: a second owner of the plan |

**Recommended: A.** Durable Objects over D1 for two reasons. A machine's move is a read, a check and a write; inside
one object it is one transaction with no race, and the blueprint's `step` function runs there unchanged, as it does in
Core. And a run's object can push progress to the app while the run is going, which D1 cannot. D1 would be the
fallback if a query across every row became the main read; at our volume one object holding the index answers those
with its own SQL.

The layout:

- **`Logbook`**, one object: the index of every run, verdict, task, ask, thread, sitrep and plan state, as SQLite tables
  generated from the blueprint's schemas. Point-in-time recovery of 30 days comes with SQLite objects; a nightly job
  exports every table as JSON lines to R2, so the history outlives the vendor and can be read offline, which is what
  git gave.
- **`Run`**, one object per run: live progress while the run goes, then folded into `Logbook` at its verdict and left
  idle. Sharding is by run, so no single object takes a run's write load.
- **R2 bucket `capxul-logbook`**: run detail (today's `record.json`, `summary.json`), the OTLP archive, the nightly
  export, and the imported legacy records, each by its SHA-256.
- **Axiom**: unchanged. The logbook's own calls are spans like any other.

Where it runs: deployed by `packages/platform` with Alchemy, as the platform's long-lived stage is, on a `workers.dev`
name first (no DNS record), and later on a name under capxul.com once its DNS is on Cloudflare (step 2.1). It is
staging infrastructure for the pipeline, not production. Spend: well under a dollar a day.

## 4. Verdicts only CI can write

The `proofs` branch of step 4.5 is replaced by the logbook's `verdict.record` verb, which accepts one caller: a GitHub
Actions job of this repository.

1. The proving job asks GitHub for an OIDC token with the logbook as its audience (`permissions: id-token: write`; CI
   already takes its AWS role this way).
2. It calls `verdict.record` with the verdict (the schema in `proof-and-telemetry.md`, section 2) and the token.
3. The Worker verifies the token's signature against GitHub's published keys and its claims: `repository` is this
   repository; `job_workflow_ref` names a declared proving workflow (`world.yml`, `prove.yml`, `drift.yml`,
   `platform.yml`); `sha`, `run_id` and `run_attempt` equal the verdict's. Any mismatch is a refusal, declared like any
   other, and nothing is written.
4. The verdict is stored with the token's claims beside it, so anyone can see exactly which job wrote it.

What this protects against: a hand-written or edited verdict (no agent can mint the token); a container's run passed
off as CI's; a verdict copied to another commit. What it does not: a change to the proving workflow or the generic
checks inside the pull request whose run made the verdict. The `pull_request` event runs the workflow file of the
merge commit, so the pull request can change it. Two answers, both cheap:

- A verdict from a `pull_request` run is **recorded** at once and **counted** only when its commit lands: the job of
  `check.yml` on a push to `master` (itself OIDC) tells the logbook which commits are now on `master`. By then the change
  has been reviewed, so the reviewer sees any change to what judges it, as today.
- A `CODEOWNERS` entry for `.github/workflows/`, `packages/scenarios/` and `packages/runner/src/checks/`, as the
  proof-and-telemetry note already proposes, names that reviewer.

This also removes three pieces of step 4.5: the orphan branch, the notarising check (the logbook trusts the token
directly; a commit status `proof/<name>` can still be set for people to see, but nothing depends on it), and the hourly
re-verification in `status-feed` (verified once, at write time, by the only writer allowed). The logbook needs no GitHub
credential of its own.

Runs from agents' containers write `run` rows with `trusted: false`. They are evidence to compare against, never a
verdict, as agreed.

## 5. One set of verbs for everyone

The logbook is a door like Core's `/platform` and `/world`: its things and verbs are declared in the blueprint
(`src/things/<thing>/`, one file per verb, each with its payload, answer, refusals, `allowed` roles, steps, logs and
budget), and served by an Effect Rpc server. Then everything else is generated, as for any operation:

- **The CLI**: `capxul run show`, `capxul verdict list --proof journeys/thin-line`, `capxul task claim`,
  `capxul ask open`, `capxul sitrep say`, `capxul step show 4.5`. Agents use these from their containers.
- **The SDK**: the same verbs, typed, for the runner, the proving workflows and Aaron's app.
- **The pages** in `packages/blueprint/generated/`, each verb's refusals and machine diagram included.

Who may call what is the blueprint's `allowed`, with three roles: `ci` (OIDC: runs, verdicts, landed commits),
`agent` (a write token injected by the network proxy, never seen by the agent: runs marked untrusted, tasks, asks,
threads, sitreps), `aaron` (the app, through Cloudflare Access: answers asks, reads everything). Reads are open to all
three. The rule "a declared name is imported, never written as a string" keeps every caller on the same words.

## 6. The roadmap, the plan and the app

Aaron agreed that the plan is declared in the blueprint (goals, milestones, tasks) and the roadmap's tables generated
from it; a local thread on his machine is designing that, and the visual app on HeroUI Pro. This note fits it with one
constraint:

**A generated file holds declarations only, never state.** If the roadmap's generated table carried each step's state,
every verdict would make `pnpm generate:check` fail until someone committed the new table, and state would be back in
git by the side door. So:

- The blueprint declares each goal, milestone and step: what, needs, lane, the proof name that makes it done. The
  generated roadmap shows those.
- The logbook holds each one's state, done time and evidence, derived from verdicts and merges, plus tasks, which are
  made and closed at run time and are not declared.
- The app, the CLI (`capxul plan show`) and the sitrep read the plan from the blueprint (through the SDK's generated
  declarations) and the state from the logbook, and join them. The Evidence column's prose becomes notes on a step in
  the logbook, written by its lead.
- `status-feed` is retired: its job (state from proof) becomes the logbook's, computed when a verdict is counted.
- The sitrep note's `state` branch (`sitrep.md`, section 2) is replaced by the logbook; its things, verbs and screens
  stay. The Claude artifact page can keep its snapshot publisher, now reading the logbook.

For the local thread: the things `task`, `ask`, `thread` and `sitrep` and the state of goals and milestones should be
declared with the logbook as their store from the start, and the app should read them through the SDK, not from files.

## 7. The migration

In order, each a pull request that changes no behaviour of the product:

0. **Now, before the logbook exists: stop adding.** No new record is committed from today. A step's proof names its CI
   run (`world` run 43796480962, as step 3.6 already does) or a `check:`; a container's run is cited in its pull
   request's text only. CI already uploads its records as artifacts; they last 90 days, longer than the logbook takes to
   build. This needs one line of AGENTS.md and Aaron's yes.
1. **The logbook, as one lane** (it touches the blueprint, `packages/platform` and the runner): the things declared with
   their machines, journeys and checks written first by another agent, the Worker and its objects, `verdict.record`
   with OIDC, the runner's upload, `world.yml` writing its verdict. Needs 4.4 as step 4.5 does, which it replaces.
2. **Import.** One command walks every `records/` folder, uploads each file to R2 by its digest, and writes a legacy
   record row: its path, digest, the commit that added it and that commit's author. Legacy rows are marked
   `legacy: committed by hand`, never verdicts. Run once by CI (`prove.yml`), so the import is itself on record.
3. **Repoint.** The Proof column names `proof:<name>` for steps with a verdict, and `legacy:<path>` for the rest, which
   the logbook resolves to the imported file. A test fails a roadmap that names a path that does not resolve. 34 rows,
   49 paths.
4. **Delete from the tree.** Every `records/` folder goes, with the five special cases of section 1. The runner writes
   to `$RUNNER_RECORDS` (a temporary folder) everywhere, as CI already does, and uploads. Rung 1 then fails any
   `records/` folder, so state cannot creep back.

**History.** "Purge it all" can mean the tree or the history. The tree is step 4. The history is a rewrite of every
commit with `git filter-repo`, then a force-push. Measured, it is not worth it:

- It frees about 3.5 MB of an 80 MB clone. The clone's weight is screenshots from the older lines (41 MB), which a
  rewrite of `master` alone does not reach either.
- `main` and `integration/build` share that history, and AGENTS.md forbids touching them. GitHub keeps every object
  any branch reaches, so rewriting `master` alone removes nothing from the server or from a fresh clone, which fetches
  every branch.
- The repository has 431 branches. Every one would have to be rebased onto the new history or abandoned; merging an
  old one back would bring the records back with it.
- AGENTS.md forbids a force-push, and every lead's slice would break at once.

**Recommended: delete from the tree, keep the history.** Agents that want a small clone can use
`git clone --filter=blob:none --single-branch -b master`, which downloads old versions only when asked. If Aaron still
wants the history rewritten, it is one planned event: every lane landed, every open branch listed and closed, `main`
and `integration/build` included by his written yes, the force-push allowed once in writing, done in one sitting. Not
recommended.

## 8. What changes, needing Aaron's written yes

Decisions (`docs/decisions.md`):

1. **"Proof and telemetry"**: the logbook replaces the orphan branch `proofs`; the check is no longer the notary, the
   OIDC token is; "legacy records, kept where they are" becomes "imported to the logbook and deleted from the tree".
2. **A new decision, "State is not in git"**: a declaration is reviewed and lives in git; a fact about what happened is
   recorded in the logbook; a generated file holds declarations only. With the history kept, as recommended.
3. **A long-lived logbook**: the standing rule "every world, stage and site you make is destroyed" gains a third named
   exception, after the platform's stage and the shared world.
4. **One new credential**: the agents' write token, held by the Worker and injected by the network proxy. CI needs
   none (OIDC); Aaron's app uses Cloudflare Access.
5. **The word "logbook"** joins the glossary (`packages/blueprint/src/glossary.ts`): the store of what happened.
6. **The sitrep's `state` branch** (`docs/design/sitrep.md`, section 2) is dropped for the logbook.

AGENTS.md lines:

- "Three sources, one owner for every fact": verdicts are "made only by CI, kept in the logbook, written with GitHub's
  OIDC token", not "on the orphan branch `proofs`, each notarised by a GitHub check"; the sentence on run records
  standing in for verdicts gains "and no new one is committed".
- "Who owns each fact": the row "What is proven" becomes "Verdicts in the logbook; legacy records imported to it"; a new
  row, "What happened (runs, tasks, asks, threads, sitreps, the plan's state)", owner the logbook.
- The ladder: rung 1 adds "a `records/` folder anywhere".
- Standing rules: the logbook's exception to "nothing is left running", and the agents' token.

The roadmap: step 4.5 is rewritten as the logbook's lane (section 7, step 1), and step 4.3 reads its trends from the
logbook rather than the `proofs` branch.

## Not decided here

- The exact verbs and payloads: the lane's blueprint delta, signed off by its lead.
- Whether the plan's state is joined in the app or served joined by the logbook: the local thread's call, with this
  note's one constraint.
- Retention of untrusted runs' detail in R2: 30 days is proposed, to be set from what the app actually reads.
