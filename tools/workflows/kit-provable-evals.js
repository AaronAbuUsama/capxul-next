export const meta = {
  name: 'kit-provable-evals',
  description: 'Give the starter kit\'s unverifiable evals their runners (agent judge on OpenAI, table, system, SDK-flow), waive resume by decision, and make speed budgets trustworthy; then a reviewer',
  phases: [{ title: 'Build' }, { title: 'Review' }],
}
const KIT = '/home/user/hillclimb-kit'
const COMMON = `The hill-climbing starter kit is at ${KIT} (a local git repository; run every command with export PATH=/opt/node-v24.22.2/bin:$PATH CI=1 VP_NO_UPDATE_CHECK=1; pnpm 12.18.0). Read its README.md, packages/evals (the harness: how evals are listed, run and turned into RunResult[] and the scoreboard), book/ (the ledger's design book, its decisions and eval bodies) and packages/book (the record system and how evals are derived). Today 25 of 202 evals are unverifiable: 14 des: (decided by an agent, the design reviewer), 4 tbl: (no runner: the store's schema and every writer's code), 4 sys: (static checks for packages/lint; nothing generated yet), 2 flw: (no CLI command runs them: they serve another surface) and 1 wfl:.../resume (the scheduler runs in the API's process; nothing durable to resume). Also, speed-budget evals (bud:, flw:/budget, rpc:/budget) failed on a busy machine and passed on a quiet one: measured under load they are noise.
Aaron's direction (8 November 2026): make them provable now; everything on OpenAI (OPENAI_API_KEY is set in the environment; never print, log or write it; models are configuration).
Another agent is writing ${KIT}/docs/dx.md, ${KIT}/.swarmd/ and the ignore lines in vite.config.ts and tsconfig.json at the same time: do not touch those. Commit locally with explicit paths only (git add <your paths>; never git add -A), with clear messages.`
const OUT = { type: 'object', properties: {
  done: { type: 'array', items: { type: 'string' } },
  commandsRun: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, result: { type: 'string' } }, required: ['command', 'result'] } },
  stillUnverifiable: { type: 'array', items: { type: 'string' } },
  decisions: { type: 'array', items: { type: 'string' } },
  notes: { type: 'string' } },
  required: ['done', 'commandsRun', 'stillUnverifiable', 'decisions', 'notes'] }
const REV = { type: 'object', properties: {
  refuted: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
  upheld: { type: 'array', items: { type: 'string' } }, checkPasses: { type: 'boolean' }, notes: { type: 'string' } },
  required: ['refuted', 'upheld', 'checkPasses', 'notes'] }

phase('Build')
const made = await agent(`${COMMON}

YOUR TASK: give every unverifiable eval a runner, or a recorded reason it is waived, and make the speed budgets trustworthy. Keep the harness small (its line budget) and the house rules (one clock, typed errors, no throw).
1. des: an agent judge. For each operation, one OpenAI call (the model from configuration, for example JUDGE_MODEL with a sensible default you check exists with GET /v1/models) given the operation's record (title, about, acceptance claims, refusals) and the CLI's actual --json output and exit codes from that run, returning a structured verdict {agrees: boolean, findings: [...]}. The verdict's decider is agent; it never overrides a machine eval; its evidence is saved. Without a key it stays unverifiable with that reason. Run it and show the verdicts.
2. tbl:<table>/schema: read the SQLite schema the store really creates (from a fresh store) and compare it with the table record (fields, key, indexes). tbl:<table>/writers: a static check of which handlers and processes write each table, against the record's writers.
3. sys: imports from packages/lint's rules (or its facts), sys:loc from a line count per concept or package against its budget, and say what sys:generated needs (it stays unverifiable until a generator exists; record that as a decision).
4. flw: the two SDK flows no CLI command runs: a runner that calls the SDK directly against a fresh API.
5. wfl:.../resume: record a decision in book/ that the example's scheduler is not durable (it runs in the API's process; a restart re-reads due transfers from the store), so this eval is waived with that reason, and make the harness report a waived eval as waived, not unverifiable.
6. Speed budgets: a budget verdict counts only from a quiet run with enough samples. Measure the machine's load (for example the one-minute load average against the CPU count) and the sample count; on a busy machine, or with too few samples, report the budget as noisy, not fail. Record the rule as a decision.
Then run pnpm check and pnpm evals (on a quiet machine if you can: wait briefly if the load is high, and say what the load was), regenerate the portal, and report the new counts.`, { label: 'build:runners', phase: 'Build', schema: OUT })

phase('Review')
const review = await agent(`${COMMON}

You REVIEW the new runners. The builder's report: ${JSON.stringify(made)}
Try to refute: does each runner check what its eval claims (the schema compared field by field, the writers really derived from code, the SDK flow really exercised), can the agent judge be gamed or leak the key (grep the repository and the evidence files for the key's first characters taken from the environment, never printing it), is a noisy budget never silently a pass, is the harness still within its line budget, and does pnpm check pass from a fresh clone (git clone ${KIT} to a temporary folder you create, pnpm install --frozen-lockfile, pnpm check)? Fix what you refute in the builder's files, commit with explicit paths, and report.`, { label: 'review:runners', phase: 'Review', schema: REV })
return { made, review }