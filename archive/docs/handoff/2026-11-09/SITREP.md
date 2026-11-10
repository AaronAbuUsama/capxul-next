# Sitrep and handoff: 9 November 2026, about 16:00 UTC

The session was stopped because the account had about 5% of its weekly budget left. Everything is saved on GitHub. A new Claude account starts from this file.

## Where everything lives

| What | Where |
|---|---|
| This handoff, every workflow script of the session, the swarmD deploy runbook, all screenshots | `AaronAbuUsama/capxul-next`, branch `claude/infrastructure-refactor-plan-v41iue`, folder `docs/handoff/2026-11-09/` |
| Capxul rebuild (design book, kit bundles, the mock-up `demo/`, design docs) | `AaronAbuUsama/capxul-next`, same branch (PR #1 open, not merged) |
| Original Capxul: the swarm CLI | `Xelmar-tech/infrastructure`, branch `claude/infrastructure-refactor-plan-v41iue`, draft PR #3935 into `integration/factory` |
| swarmD fixes | `AaronAbuUsama/swarmd` PR #133, **merged into main as 144fb78, NOT deployed** |
| Hill-climbing kit | `capxul-next/kit/hillclimb-kit.bundle` (at ea8ee1a; `git clone kit/hillclimb-kit.bundle`) |
| swarmD rebuild design (abandoned) | `capxul-next/kit/swarmd-next-design.bundle` (48dc637, MAP-SWARMD.md) |
| Mock-up preview | https://claude.ai/artifact/9VCi4xKK5U9ZnXV8F7jPsH (version 3, round B state) |
| Book explorer | https://claude.ai/artifact/NMedAdjczBUadTvFNsmCzw |

## The workstreams

### 1. The clickable mock-up (`capxul-next/demo/`)
- **Done:**
  - Research on Frappe's real screens (`demo/research/`).
  - 18 months of consistent data for Harbourline Studio Ltd, 25 people (`demo/data/generate.mjs`; `node data/validate.mjs` passes 23 of 23; double-entry books).
  - The shell and 8 modules (about 165 screens).
- **Aaron's feedback (14:50), applied in rounds** (`demo/PROGRESS.md` holds the full text):
  - no commands on pages;
  - no agent call-outs: they go to one assistant panel instead;
  - realistic agent work;
  - the FDE's job is setting up Capxul;
  - primary use cases: CRM, lead generation and funnels, projects, acting as HR.
- **Round A** (commit 5768d1e): frame, assistant panel, CRM. Done.
- **Round B** (commit 586262c): acting as HR (HR inbox, onboarding and offboarding, right to work, leave checks, letters), payroll changes, the projects coordinator. Done.
- **Round C** (lead generation and funnel, FDE as setup, new Home walkthroughs): **stopped part-way.** Its partial edits to `core.js`, `crm.js` and `fde.js` are committed as "partial". Rerun it, starting from a fresh check that the app loads:
  `Workflow({scriptPath: 'tools/workflows/erp-demo-feedback.js', args: {round: 'C'}})`
- **Round D** (money, books and governance cleanup, truncated list names, the final check): not started. Run it the same way with `round: 'D'`.
- **Then:** publish `demo/app` as the artifact (`index.html` plus `data.json` and `js/*.js` as files) to the same URL, from the new account (a new artifact).
- **Aaron's ask (15:40):** "I need details: show the difference with what we built." 25 detail screenshots are in `screenshots/pvD` and `screenshots/pvU`. They include a UK payslip (tax code 1257L, NI A, PAYE, NI, pension, YTD), an employee record, the payroll run, invoices, journal, GL, TB, VAT, project plan, tasks and costing, a timesheet, and a deal.

### 2. "What it takes" comparison (Capxul today against Frappe for a 25-person UK company)
- Workflow `tools/workflows/what-it-takes.js`.
- Both researchers finished and wrote `docs/design/frappe/what-it-takes/capxul-today.md` and `frappe-reality.md`, both committed.
- The page builder was stopped. Rerun only the page step from those two files, then publish.

### 3. swarmD (`AaronAbuUsama/swarmd`)
- **PR #133 merged into main (144fb78), with CI green.** It holds:
  - secrets bound to hosts by the owner, with Infisical as the store;
  - events per namespace;
  - reads that survive a bad manager;
  - `GET /version`;
  - namespace archive;
  - the archived-namespace fix 16ee6a0.
- **Not deployed.** The session's safety check blocked the production deploy, so it needs Aaron's approval.
- Runbook: `docs/handoff/2026-11-09/scratchpad/swarmd-deploy-runbook.md`. In short:
  1. `cd packages/server && node scripts/deploy.ts --image registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/swarmd-sandbox@sha256:9d52e1028a2dc8b508265104e5c098caa65f70f5f117a51553be19a463f39c17`
  2. Check `/version`.
  3. `swarmd ns archive bt-check` **immediately**.
  4. Archive the 31 leftover namespaces.
  5. Run the smoke tests.
  6. Rollback if needed: `wrangler rollback 096b6307-0a5a-4462-8c8d-36f0f4a99319`.
- Follow-ups (in the PR body and runbook):
  - `listening()` and `delivered()` should read each manager apart;
  - `redirect: manual` for bound keys;
  - an Infisical 404 reads as `missing_secret`;
  - a GitHub token per installation (#120, so Xelmar-tech attaches).

### 4. Original Capxul: the swarm CLI (`Xelmar-tech/infrastructure` PR #3935, draft)
- CI green at b4e23483bb.
- All 7 review findings fixed and their threads resolved.
- After the swarmD deploy:
  - move the pin to 144fb78 (`pin build --commit`);
  - fix `ns archive`: it sends POST, but swarmD serves PUT, and `/version` has no `features` list;
  - update `doctor`'s `github-events` text;
  - rerun the live evals against `capxul-test`.
- Blocked on Aaron: install the swarmD GitHub App on Xelmar-tech.

### 5. Payments bridge study (how a Capxul payment and a Frappe payment are one thing)
- The research is saved in `docs/design/frappe/bridge-work/` (`frappe.md`, `v4.md`, `prior-art.md`, `design-gateway.md`, `design-bank.md`).
- The synthesis (`payments-bridge.md`: the recommendation, the contract changes, the questions) was never produced. The run ended without a result. Rerun only the synthesis from those five files.

### 6. Capxul-next design book
- At 0 problems and 0 breaches at the last check.
- Rulings recorded up to `aaron.frappe-native`, `aaron.one-product` and `aaron.other-accounts`.
- Pending:
  - the Frappe-native redesign of the book (after the bridge synthesis);
  - refresh `docs/mission/initializer.md` and `HANDOFF.md`;
  - a cold-start critic;
  - merge PR #1;
  - the final zip.
- Surface questions 50 to 55 remain For Aaron.

## Only Aaron can do
1. Approve or run the swarmD deploy (above).
2. Install the swarmD GitHub App on Xelmar-tech.
3. An Infisical universal-auth identity for swarmD. Set `INFISICAL_CLIENT_SECRET` and `INFISICAL_PROJECT_ID` first, then `INFISICAL_CLIENT_ID` last.
4. Rotate the CLIProxy key he pasted on 8 November. It is stored only in the old container at `/root/.cliproxy/key` and is in no repository. The new account needs its own credential through the form.
5. Decide whether sources become a boundary between namespaces (DOC-16).

## Rules the next session must keep
- swarmD: no attribution lines in commits or PRs; tests fail first; STATUS and docs change in the same PR.
- Never print or commit SWARMD_TOKEN, OPENAI_API_KEY or the CLIProxy key.
- pnpm in Capxul repositories; npm in swarmD.
- No model names in commits.
- Publish previews early and often. Aaron wants to see work as it happens, not after hours.
