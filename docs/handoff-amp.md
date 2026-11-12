# Handoff to Amp (11 November 2026)

Aaron moved agent orchestration to Amp on 11 November 2026 (decision `build.amp`). The home-made machinery (the agent
loop, its Runs UI, the Cloudflare sandbox Worker, the Mac service supervisor) was deleted; the plan, the book and the
coordinator's skills stay, rewritten for Amp. This page is what an Amp agent
needs to pick the work up with no other context. The rules are in [AGENTS.md](../AGENTS.md).

## 1. Where the code is

- Repository `AaronAbuUsama/capxul-next`. All work is on **`integration/build`**. `main` holds only the original design
  book (PR #1, 8 November); `integration/build` is a few hundred commits ahead and merges into it cleanly.
- `main` moves only through a pull request from `integration/build` that Aaron approves. Never push to `main`.
- Every task: its own branch from `integration/build`, a pull request back into it, CI green, then merge.

| Path | What it is |
|---|---|
| `blueprint/` | The design as typed records, one folder per concept plus `shared/` (about 2,700 records, 5,200 evals). |
| `packages/blueprint-engine` | Builds and checks the blueprint (`pnpm blueprint`, `pnpm frozen`, `pnpm blueprint:ripple`). |
| `packages/contracts` | The real Capxul v4 contracts (Foundry), and the check that the contract records match them. |
| `packages/frappe-app` | The Capxul app installed on every hosted Frappe site (Python, Frappe v16), and its blueprint check. |
| `packages/bench-image` | The production Frappe image (Frappe, ERPNext, HR, CRM, WhatsApp, capxul) and its smoke test. |
| `packages/devnet` | The local chain and worlds; `devnet/cloud/setup.sh` makes a cloud box able to run the stack. |
| `packages/sdk` | The product SDK. |
| `spikes/skeleton` | Proven throwaway code: the Core service stub, CLI and Frappe test stack, with `run.sh`, the end-to-end script. It moves into packages (decisions 3 and 4 below). |
| `packages/evals`, `evals/`, `status/` | Which check proves which eval, the runner, and the scoreboard. |
| `packages/portal` | The book: a site generated from the blueprint and the scoreboard, with the Questions page. |
| `packages/plan`, `plan/` | The coordinator's plan (`pnpm plan show`) and Aaron's answers (section 5). |
| `docs/mission/` | Today's reassessment, decisions, breadth plan and record-kinds spec. |

## 2. Bring the stack up in an orb

`.agents/setup` runs once per orb snapshot: `pnpm install`, then `packages/devnet/cloud/setup.sh`, which installs Foundry
1.7.1 from npm, solc 0.8.28 and 0.8.24 (as solc-js behind a native-looking wrapper), and the Docker Compose plugin, and
starts Docker. `.agents/resume` starts Docker on every wake. In a fresh shell, `source packages/devnet/cloud/setup.sh`
again to get `PATH` and `FOUNDRY_SOLC` (it is quick once installed).

- **Repository checks** (seconds to minutes, no Docker): the list in AGENTS.md.
- **Contracts**: `pnpm contracts:prove` (the first forge build is slow with solc-js; later builds are cached).
- **The end-to-end run on real contracts**: `FOUNDRY_SOLC=$CAPXUL_SOLC_0824 spikes/skeleton/run.sh <fresh-company-slug>`.
  It starts anvil (8545), the Core stub (8787) and the Frappe stack (8000) if they are down. The first Frappe bench
  build takes about five minutes. `--only B9` runs one behaviour and what it needs; `--list` prints the checks.
- **Score it**: `pnpm evals -- --journey thin_line` (or eval ids). Only this writes `status/status.json`.
- **The bench image**: `packages/bench-image/README.md`.
- **The book**: `pnpm portal && pnpm portal:serve --port 4391`. In an orb, expose the port through `.amp/services.yaml`
  (not written yet).

**Not yet proven in an orb.** Amp's docs say Docker Engine is installed with its daemon stopped, and that Compose is not
installed. They do not say whether outbound internet is open or whether Docker containers can share the host network. The
setup scripts ran clean in a Claude cloud container on 11 November; the first Amp task should be to run them in an orb and
run `spikes/skeleton/run.sh` once (section 6, task 0). If the orb is a1.medium (8 GB) and the Frappe stack runs out of
memory, use a1.large.

## 3. Where the product stands

- **The thin line** (`evals/thin-line.md`, journey `thin_line`): the narrowest path through every layer with one company.
  **10 of 12 primary tests pass** on the real v4 contracts (run `run-20261111182634`). Row 6 (signing sends the money
  through a real UserOperation) and row 7 (the books agree with the chain) wait on decisions 1 and 2 below.
- What that run did not cover: it ran in a cloud container, not on the sites machine; the signing page is a stand-in;
  there is no bundler.
- **The production bench image** is built and tested (22 of 22). Deploying it to the AWS machine needs Aaron.
- **CI** runs every repository check on every pull request, plus the blueprint ripple of the change.
- The critical path (`docs/mission/reassessment-2026-11-11.md`): real contracts under the sites (done), the spike into
  packages, the thin line 12 of 12, the production image (done), the thin line on the AWS machine, then breadth, ending
  on Capxul running Capxul's own company.

## 4. What is waiting on Aaron

Do not ask again what is already asked; keep working on the recommended option where the step can be undone.

- **Five decisions** in `docs/mission/decisions-2026-11-11.md`, each with a recommendation: (1) a real bundler for the
  thin line's payment; (2) how the money that funds a Safe enters its books; (3) where the spike's Core service goes;
  (4) where the spike's CLI goes; (5) where the record lives. 1 and 2 unlock rows 6 and 7.
- **Answered on 11 November, 21:58-21:59 UTC**: `sites.bench-image` accepted (one locked, tested bundle), and ruling
  `aaron.operation-done`: an operation is done when its L1 evals pass, its alerts stay quiet on the shared world on the
  machine, and each of its alerts has been seen to fire once on a planted fault.
- **The breadth plan** (`docs/mission/breadth-fan-out-2026-11-11.md`, option E, recommended): journeys in waves; each
  journey cut into one slice per concept; one agent per slice; one agent at a time inside a concept. Six fixes come
  first (stable eval ids, stale verdicts on reworded claims, one check and binding file per slice, a slicer, CI (done),
  load errors that name the record).
- **Code that differs from his decisions**: the hat-to-role map is editable on a site (`plugs.hat-map-ships`); payroll
  is on by default, and attendance, recruitment and reviews are still inside People (`sites.features-reachability`).
- **The milestone change** in the reassessment: close m1 on its met exits; the next milestone is the thin line on real
  contracts, then on the machine.
- **The AWS sites machine**: deploying needs his credentials and his go-ahead.

## 5. The plan and the coordinator

Aaron kept `plan/` (11 November, 22:05 UTC): it is how the coordinator and Aaron talk. The lead Amp agent is the
coordinator and hill-climbs it with the skills in `.agents/skills/` (`coordinate`, `dispatch`, `plan-tasks`,
`ask-aaron`, `portal-ops`). It changes `plan/plan.json` only through `pnpm plan …`, starts one orb thread per task with
`amp -ox`, and Aaron's answers reach `plan/answers.jsonl` through the book's Questions page.

Open, his call: plan tasks blocked on him show on Questions as plain text without option buttons, unlike blueprint
decisions, so a choice for him reads better as a decision record than as a plan need (the `ask-aaron` skill says so).

## 5b. The blueprint audit (11 November)

An outside audit of the blueprint was checked against `integration/build` at `222d334`, and every finding held
(evidence: https://claude.ai/artifact/QNjtyttvfv9BgU8Qsf4Rn2). Aaron said "fix all"; the fixes landed in one pull
request from the thread "Validate the blueprint audit findings":

- **Fixed:** a verdict now goes stale when its acceptance line's `observes` changes, not only its claim (engine:
  `evals.ts`, `status.ts`, `ripple.ts`); the 16 recorded acceptance passes were run again to record it.
- **Fixed:** the `books` concept now says what `cut.books` ruled (ERPNext owns the chart, reports and exports).
- **Fixed:** the `devnet` and `shared-world` environments and the `backend` component now describe the lean world
  (`devnet.lean-world`: one SQLite service, chain reader folded in, a bundler only in the canary world).
- **Fixed:** `docs/blueprint-guide.md`'s three false statements and `docs/blueprint.md`'s swarmD factory text; the
  trial balance mapping in `cut.ts`; payroll's "UK filing" wording (now `aaron.jurisdiction-open`).
- **On the Questions page, waiting for Aaron** (`blueprint/shared/questions.ts`): `thin-line.bundler` and
  `books.founder-funding` (thin line rows 6 and 7), `devnet.core-service-home` (withdrawn on 12 November, replaced by
  `system.one-storage-design`: one storage and indexing design everywhere), `devnet.cli-split`,
  `devnet.record-home` (the spike's move into packages), `books.chart-owner` (whether Core keeps its own copy of
  the chart; the `books` tables and the head feed still model the copy until he answers). Also `plan.cloud-sandbox-moot`: drop plan task `m1-cloud-sandbox`, which Amp makes moot and which still sits on the critical path.
- **Plan:** g2 and g4 evidence refreshed to what is actually checked (g4's wording is a milestone exit, so his);
  `m1-cloud-sandbox` dropped (Amp replaces it); what is left of `m3b-bench-image` and `m2-contracts-under-sites` is in
  the plan's notes.
- **Still open:** the verdict fingerprint covers the claim and `observes`, not a refusal's starting world or the
  schemas a claim names.

Fixed since (Codex's review of #11, 11 November): two money-path bugs in `packages/frappe-app/capxul/payments.py`. A
batch transaction's unmatched payments now each get a bank line (keyed by payment id, not only the transaction hash),
and a payment against an entry another payment already posted is recorded as an unmatched bank line instead of
vanishing. Unit tests in `packages/frappe-app/tests` (`pnpm frappe:test`).

## 6. Next tasks (each one Amp thread, one pull request into integration/build)

0. **Prove an orb runs the stack**: run `.agents/setup`, then `spikes/skeleton/run.sh`, and report whether Docker,
   Compose and outbound network work. Start the book with `amp orb services ensure` and check its portal link and that
   an answer on the Questions page lands in `plan/answers.jsonl`. Then delete the `lane/*` branches (section 7).
1. **The breadth fixes** that need nothing from Aaron: stable eval ids, stale verdicts on reworded claims, one check
   file and binding file per concept, load errors that name the record (`docs/mission/breadth-fan-out-2026-11-11.md`,
   section 5).
2. **The slicer**: given a journey, its breadth records by concept, with their evals and waiting decisions.
3. **Move the Frappe-side checks out of `spikes/skeleton/run.sh`** into per-concept check files, keeping every binding.
4. After decisions 3 to 5: graduate the spike's Core service and CLI into packages.
5. After decisions 1 and 2: rows 6 and 7 of the thin line.
6. With Aaron: the thin line on the AWS machine (needs his go-ahead and credentials).

## 7. Left over

- **On GitHub**: Aaron asked (11 November, 22:05 UTC) for the 32 old `lane/*` branches to be deleted. The Claude cloud
  thread could not (its git access may push only its own branch). An Amp thread can, since `gh` there acts as Aaron:
  delete every `lane/*` branch. Their heads are listed in pull request #10 in case one is wanted back. The unmerged
  branch `sandbox/stack` (a half-built box image, superseded by orbs) can go with them once Aaron says so.
- **On Aaron's Mac** (not reachable from a cloud agent): a stopped test container (`capxul-box-stack-try`) and its
  volume, and an old test stack (Frappe on port 8000, chains on 8545 and 8745, a leftover `loop watch`).
