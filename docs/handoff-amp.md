# Handoff to Amp (refreshed 12 November 2026, 07:30 UTC)

Aaron moved agent orchestration to Amp on 11 November 2026 (decision `build.amp`) and asked on 12 November to hand the
project over now. This page is everything an Amp agent needs to pick the work up with no other context. Read it, then
[AGENTS.md](../AGENTS.md) (the rules), then run `pnpm plan show`.

## 1. The split of work between Claude and Amp

Three things are still being finished on the Claude side. Amp does not start them, and should expect their pull
requests to land into `integration/build` in the next few hours:

| What | Plan task | Who is doing it |
|---|---|---|
| Book a company's first deposit as the founder's capital (thin line row 7), then bring `main` level with `integration/build` | `m2-founder-capital` | Claude cloud thread "Validate the blueprint audit findings" |
| Measure what Ponder plus Postgres costs in one test world; writes a new `docs/mission/world-cost.md` | `m3b-ponder-world-cost` | Claude cloud thread "Measure Ponder cost per world" |
| Keep `plan/` and the book current | (none) | Claude thread on Aaron's Mac, the only writer of `plan/` today |

**When the plan passes to Amp.** Once those two pull requests have merged and `main` is level, the Claude side stops
starting product work, and Amp's lead thread becomes the only writer of `plan/`. Until then, an Amp thread does not run
`pnpm plan …` commands that write; it reads the plan and works on a task from section 6 on its own branch. Only one side
writes the plan at a time, always.

**After the handover Amp owns everything else:** every task in section 6, the breadth waves, the cleanup in section 8,
and keeping the book rebuilt (skill `portal-ops`). Aaron still uses Claude for Claude-only waves when he asks for them.

## 2. Where the code is

- Repository `AaronAbuUsama/capxul-next`. All work is on **`integration/build`** (at `98b1b25` when this was written).
  `main` is at `f180d0d` (PR #19), 19 commits behind; the main catch-up in section 1 levels it.
- Every task: its own branch from the latest `integration/build`, a pull request back into it, every check green, then
  merge. `main` moves only by a merged pull request from `integration/build`. Never force-push.

| Path | What it is |
|---|---|
| `blueprint/` | The design as typed records, one folder per concept plus `shared/` (about 2,700 records, 5,200 evals). |
| `blueprint/shared/rulings.ts` | Aaron's rulings in his own words, and which old decisions they replace. |
| `blueprint/shared/questions.ts`, `waiting.ts` | Questions waiting for Aaron, shown on the book's Questions page. |
| `packages/blueprint-engine` | Builds and checks the blueprint (`pnpm blueprint`, `pnpm frozen`, `pnpm blueprint:ripple`). |
| `packages/contracts` | The real Capxul v4 contracts (Foundry), and the check that the contract records match them. |
| `packages/frappe-app` | The Capxul app installed on every hosted Frappe site (Python, Frappe v16), and its blueprint check. |
| `packages/bench-image` | The production Frappe image (Frappe, ERPNext, HR, CRM, WhatsApp, capxul) and its smoke test. |
| `packages/devnet` | The local chain and worlds; `devnet/cloud/setup.sh` makes a box able to run the stack. |
| `packages/sdk` | The product SDK. |
| `spikes/skeleton` | Proven throwaway code: the Core service stub, CLI and Frappe test stack, with `run.sh`, the end-to-end script. It moves into packages (section 6). |
| `packages/evals`, `evals/`, `status/` | Which check proves which eval, the runner, and the scoreboard. |
| `packages/portal` | The book: a site generated from the blueprint and the scoreboard, with the Questions page. |
| `packages/plan`, `plan/` | The coordinator's plan (`pnpm plan show`) and Aaron's answers (`plan/answers.jsonl`). |
| `.agents/` | Amp's orb `setup` and `resume` scripts, and the coordinator's skills. |
| `.amp/services.yaml` | Serves the book from the coordinator's orb. |
| `docs/mission/` | Reassessments, the decisions note, the breadth plan, the record-kinds spec, world cost. |

## 3. What Aaron decided on 12 November

All five questions of 11 November and the chart-of-accounts question are answered. In plain words:

- **One database design everywhere** (`aaron.postgres-and-ponder`, PR #22). One Postgres holds Capxul's own data (an
  `app` schema, with row-level security per company) and Ponder's chain index (a `ponder` schema), in every environment,
  test worlds included. MariaDB is only for the Frappe sites. Capxul will run on many chains; contracts Capxul does not
  own (Safes, tokens) are indexed once, in one shared place. This replaces `devnet.lean-world` (one SQLite file and a
  home-made chain reader per world) and answers `devnet.core-service-home`: the prototype's Core is rebuilt as the
  backend on Postgres. The thread that wrote it added three details Aaron can still overturn: one database per world on
  one Postgres per host, snapshots by copying a template database, and one Ponder per active world, stopped when the
  world parks. Write-up: https://claude.ai/artifact/MbNQS2XzjeUcA9ZqtVVwHn
- **ERPNext alone holds the chart of accounts** (`books.chart-owner`, PR #21). Capxul keeps no copy of it.
- **A company's first deposit is the founder's capital** (`books.founder-funding`). Being built now (section 1).
- **The real bundler runs in the thin line's test world only** (`thin-line.bundler`): alto with a mock paymaster;
  other test worlds stay without one.
- **The world record is a table in each world's own database** (`devnet.record-home`).
- **One Capxul CLI** (`aaron.one-cli`, his own words): no separate CLI for test worlds; world, clock, snapshot and
  record commands go into the main CLI.
- **The cloud sandbox task is dropped** (`plan.cloud-sandbox-moot`): Amp's orbs replace it.

Aaron also said, about how he wants options put to him: give real options, real trade-offs and your own recommendation,
and keep it even when he pushes back, unless his argument actually changes it.

## 4. Where the product stands

- **The thin line** (`evals/thin-line.md`, journey `thin_line`): the narrowest path through every layer with one company,
  12 tests. **10 of 12 pass** on the real v4 contracts. Row 7 (the books agree with the chain) is being finished on the
  Claude side. Row 6 (signing sends the money through a real UserOperation) is Amp's task `m2-bundler-world`. The table
  in `evals/thin-line.md` still says rows 6 and 7 "wait on a decision"; the decisions are made (section 3).
- That run happened in a cloud container, not on the sites machine; the signing page is a stand-in.
- **The production bench image** is built and tested (22 of 22). Deploying it to the AWS machine needs Aaron.
- **CI** runs every repository check on every pull request, plus the blueprint ripple of the change.
- **The book** rebuilt at `98b1b25`: 2,248 pages, 0 problems, 4 open gaps, every check passing.
- The critical path (`docs/mission/reassessment-2026-11-11.md`): real contracts under the sites (done), the spike into
  packages, the thin line 12 of 12, the production image (done), the thin line on the AWS machine, then breadth, ending
  on Capxul running Capxul's own company.

## 5. Bring the stack up in an orb

`.agents/setup` runs once per orb snapshot: `pnpm install`, then `packages/devnet/cloud/setup.sh`, which installs Foundry
1.7.1 from npm, solc 0.8.28 and 0.8.24 (as solc-js behind a native-looking wrapper), and the Docker Compose plugin, and
starts Docker. `.agents/resume` starts Docker on every wake. In a fresh shell, `source packages/devnet/cloud/setup.sh`
again to get `PATH` and `FOUNDRY_SOLC` (quick once installed).

- **Repository checks** (seconds to minutes, no Docker): the list in AGENTS.md, plus `pnpm check` and `pnpm tasks:check`.
- **Contracts**: `pnpm contracts:prove` (the first forge build is slow with solc-js; later builds are cached).
- **The end-to-end run on real contracts**: `FOUNDRY_SOLC=$CAPXUL_SOLC_0824 spikes/skeleton/run.sh <fresh-company-slug>`.
  It starts anvil (8545), the Core stub (8787) and the Frappe stack (8000) if they are down. The first Frappe bench
  build takes about five minutes. `--only B9` runs one behaviour and what it needs; `--list` prints the checks.
- **Score it**: `pnpm evals -- --journey thin_line` (or eval ids). Only this writes `status/status.json`.
- **The bench image**: `packages/bench-image/README.md`.
- **The book**: `pnpm portal && pnpm portal:serve --port 4391`, or in the coordinator's orb through
  `.amp/services.yaml` (`amp orb services ensure`).

**Not yet proven in an orb.** Amp's docs say Docker Engine is installed with its daemon stopped and Compose is not. They
do not say whether outbound internet is open or whether containers can share the host network. The scripts ran clean
in a Claude cloud container on 11 November. That is why `m1-orb-stack` comes first. If an a1.medium orb (8 GB) runs out
of memory with the Frappe stack, use a1.large.

## 6. Next tasks for Amp, in order

Each is one Amp thread, one branch, one pull request into `integration/build`. The ids are plan tasks (`pnpm plan show`).

1. **`m1-orb-stack`: run the stack in an Amp orb.** Run `.agents/setup`, then `spikes/skeleton/run.sh` once, and report
   whether Docker, Compose and outbound network work. Start the book with `amp orb services ensure`, open its portal
   link, and check that an answer on the Questions page lands in `plan/answers.jsonl`. If the orb cannot run Docker,
   say so plainly: the Frappe test sites need it, and the answer changes where product work runs.
2. **`m2-bundler-world`: thin line row 6.** Give only the thin line's test world the real bundler: alto behind a mock
   paymaster, the company's hats worn by personal Safes, and the payment signed as one real UserOperation through the
   EntryPoint. Done when row 6 (`acc:payment.send/1`) passes in a run. Then the thin line is 12 of 12.
3. **`m2-ponder-v4`: the Ponder app for the v4 contracts, in its own package**, writing to the `ponder` schema of the
   world's Postgres (section 3).
4. **`m2-core-on-postgres`: rebuild the prototype's Core as the backend on Postgres** (needs `m2-ponder-v4`). The
   `app` schema with row-level security per company. `m2-graduate-spike` (moving the rest of the spike into packages,
   CLI commands into the one Capxul CLI) waits on this.
5. **`m3-world-snapshots`: snapshot a world's database by template copy.**
6. **The breadth waves** (`docs/mission/breadth-fan-out-2026-11-11.md`): first its fixes that need nothing from Aaron
   (stable eval ids, stale verdicts on reworded claims, one check file and binding file per concept, load errors that
   name the record), then the slicer, then wave 1.
7. **With Aaron only:** the thin line on the AWS sites machine (needs his go-ahead and credentials).

**Plan items the first coordinator sweep should fix** (coordinator's job, after the handover):

- The critical path in `plan/plan.json` still lists the old agent loop's tasks (`m1-no-command-gate`,
  `m1-eval-coverage`, `m1-model-gateway`, `m1-loop-hardening`). Amp replaced that loop; redraw the path around section 6.
- `m2-lean-service` and the `m3b-world-service` family assume the SQLite lean world that `aaron.postgres-and-ponder`
  replaced; drop or rewrite them.
- Exit g9 ("the orchestration layer is done") was about the home-made loop; Amp makes it moot. Changing an exit is
  Aaron's call: it is part of the milestone change in section 7.

## 7. What is waiting on Aaron

Do not ask again what is already asked. Keep working on the recommended option where the step can be undone.

- **His Amp setup**: sign up, connect GitHub, create a project from `capxul-next`, optionally link a Claude or ChatGPT
  subscription under Model Routing, and open the first thread pointed at this page.
- **One Questions card: `books.annotate-site-chart`** (`blueprint/books/decisions.ts`). With no copy of the chart in
  Capxul, an annotation names the site's own Accounts, Cost Centers and Projects, checked through the site's door.
- **The milestone change** (`docs/mission/reassessment-2026-11-11.md`): close m1 on its met exits (g1 to g7); the next
  milestone is the thin line on real contracts, then on the machine. Not applied; it is his.
- **The AWS sites machine**: deploying needs his credentials and his go-ahead.
- **Four places the code differs from his decisions**: the hat-to-role map is editable on a site
  (`plugs.hat-map-ships`); payroll is on by default; attendance, recruitment and reviews are still inside People
  (`sites.features-reachability`).
- **Later, from the storage decision** (in the plan's note): chain-first keys (`indexing.keys`), and narrowing
  `indexing.transfers` to the Safes Capxul made. **Parked**, he said maybe not now: a way for the site to reach the
  service that does not poll (`plugs.service-calls-site`).
- `CLIPROXY_API_KEY` was never supplied; key rotation after m1.

## 8. Left over to clean up

- **On GitHub**: Aaron asked (11 November, 22:05 UTC) for the 32 `lane/*` branches to be deleted. Claude's cloud git
  access could not delete them. An Amp thread, whose `gh` acts as Aaron, can: delete every `lane/*` branch (their heads
  are listed in pull request #10). `sandbox/stack` and `sandbox/generic` (half-built box images, replaced by orbs) and
  the merged `claude/*` branches can go once Aaron says so.
- **On Aaron's Mac** (not reachable from an orb): leftover processes the Mac sessions were not allowed to stop: the old
  loop host on port 4392, `loop alerts` and `loop watch`, anvil chains on 8545 and 8745, two Core stubs, an old Runs dev
  server, an old Frappe test stack on 8000, and a stopped test container `capxul-box-stack-try` with its volume. None
  affects the book. Clearing them needs a session Aaron starts himself.

## 9. Working rules Amp inherits

AGENTS.md is the rulebook. The ones that cost the most when broken:

- **One writer of `plan/` at a time.** It changes only through `pnpm plan …`, never by hand.
- **Merge only green.** Every check in AGENTS.md passes before a merge. `main` only through a merged pull request from
  `integration/build`. Never force-push. "Ready" is a report, not proof: read the diff.
- **Aaron's standing word on merging** (11 November, 20:06 and 22:32 UTC): a thread may merge its own pull request into
  `integration/build` once every check is green, and may merge `integration/build` into `main` through a pull request.
  AGENTS.md still says a worker never merges and that Aaron approves main; changing AGENTS.md is his call, so it is
  proposed to him, not applied.
- **Decisions for Aaron go on the Questions page** as decision records: two to four options, one recommendation, in
  plain words he can answer in one tap. Never hand him a terminal command. Never record an answer for him.
- **Evidence he can open**: when reporting a pass or a change, link a page he can click through (the rebuilt book, or a
  published page with run output).
- **Safety**: no cloud IAM users or keys, nothing opened to the internet, his existing cloud untouched, nothing deployed
  without his written go-ahead. On his Mac, never touch port 443 (his public share).
- **The old system** (`Xelmar-tech/infrastructure`) is a reference for behaviour only. Never port it.

## 10. History worth knowing

- **The blueprint audit (11 November).** Every finding of an outside audit held (evidence:
  https://claude.ai/artifact/QNjtyttvfv9BgU8Qsf4Rn2) and was fixed in PR #12: a verdict now goes stale when its
  acceptance line's `observes` changes; the `books` concept matches `cut.books`; the guide's false statements are
  gone. Still open: the verdict fingerprint covers the claim and `observes`, not a refusal's starting world or the
  schemas a claim names.
- **Money-path fixes** (Codex's review of #11): a batch transaction's unmatched payments each get a bank line, and a
  payment against an entry another payment already posted is recorded as an unmatched bank line instead of vanishing
  (`packages/frappe-app/capxul/payments.py`, tests via `pnpm frappe:test`).
- **The watcher** (PR #20): a log-key fix, and the payment test mined again.
- **Removed in PR #10**: the home-made agent loop, its Runs UI, the sandbox Worker and the Mac service supervisor. Do
  not rebuild them; Amp does that job.
