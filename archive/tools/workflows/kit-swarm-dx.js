export const meta = {
  name: 'kit-swarm-dx',
  description: 'Write the starter kit\'s DX walkthrough (every activity, today vs swarmD docs vs gap) and its swarmD manager and worker config to the documented API; then a reviewer checks every snippet against the docs',
  phases: [{ title: 'Write' }, { title: 'Review' }],
}
const KIT = '/home/user/hillclimb-kit'
const COMMON = `The hill-climbing starter kit is at ${KIT} (a local git repository; pnpm 12.18.0 and Node 24.22.2 in /opt/node-v24.22.2/bin: export PATH=/opt/node-v24.22.2/bin:$PATH CI=1 VP_NO_UPDATE_CHECK=1). Read its README.md and look at what it has: packages/runtime (one clock, telemetry, errors), packages/api, packages/sdk, packages/cli (the ledger example), packages/book and book/ (the design book), packages/evals (the harness and scoreboard), tools/otlp-sink, and, being built right now by other agents, packages/portal and packages/lint (do not touch any of packages/).
swarmD is not installed here and its package is not published, so work EXCLUSIVELY from swarmD's documentation, which since swarmD #91 is its specification: /home/user/swarmd/apps/docs/content/docs/ (concepts/: managers-and-workers, pairs, policy, templates-and-artifacts, the-record, rooms-and-roles, how-work-flows, connectors; how-to/: define-a-manager, run-a-pair, write-a-project-config, drive-from-code, publish-an-artifact, add-a-domain, connect-github, choose-models, members-and-access; reference/: manager, pairs, ledger, templates, project, protocol, tickets, worker, tools, control-plane, client, cli, configuration, pi) and docs/SPEC.md. Capxul's own swarm design, which applied those docs to one project, is a worked example: /home/user/capxul-next/docs/design/swarm.md (one master manager first, its workers, the hill-climbing loop, the schemas) and swarm-templates.md (the team definition, the handback, verdict and decision-pack formats).
Aaron's direction (8 November 2026): align on the DX before any development; start with ONE manager and its workers, nested managers later; everything on OpenAI for now (models are configuration, set when the build runs); budgets are configuration; skills are passed through to Pi (the agents' house opinions); the kit will be dogfooded by rebuilding swarmD from scratch.`
const OUT = { type: 'object', properties: {
  files: { type: 'array', items: { type: 'string' } },
  activities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, state: { type: 'string', enum: ['works-today', 'swarmd-docs', 'gap'] }, note: { type: 'string' } }, required: ['name', 'state', 'note'] } },
  gaps: { type: 'array', items: { type: 'string' } },
  questionsForAaron: { type: 'array', items: { type: 'string' } },
  notes: { type: 'string' } },
  required: ['files', 'activities', 'gaps', 'questionsForAaron', 'notes'] }
const REV = { type: 'object', properties: {
  refuted: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
  upheld: { type: 'array', items: { type: 'string' } }, kitChecksPass: { type: 'boolean' }, notes: { type: 'string' } },
  required: ['refuted', 'upheld', 'kitChecksPass', 'notes'] }

phase('Write')
const made = await agent(`${COMMON}

YOU OWN ONLY: ${KIT}/docs/dx.md (new), ${KIT}/.swarmd/ (new), and the lines in ${KIT}/vite.config.ts and ${KIT}/tsconfig.json that keep .swarmd/ out of lint, format and typecheck (it imports @swarmd/agent, which is not installed). Do not commit; the orchestrator commits.
1. ${KIT}/.swarmd/: the kit's swarmD configuration, written to the documented API (how-to/write-a-project-config, how-to/define-a-manager, run-a-pair, reference/project, manager, pairs, worker, templates): the project config; one master manager (the build template) with its workers (a maker, a checker, an adversary for money or risky work, a diagnoser, a researcher), their prompts as short files that load the kit's skills by name, their output schemas, concurrency, the budget (per task and an envelope, as configuration) and the models (OpenAI, as configuration). Where the docs leave a field undefined, write it as a commented TODO naming the gap.
2. ${KIT}/docs/dx.md: the DX walkthrough Aaron reviews before any development. For each activity: what a human types or does, what an agent does, what each sees, and its state (works today in the kit, defined by swarmD's docs, or a gap). Activities: start a project from the kit (copy, rename the scope, install, check); idea to book (capture the idea, name the operations with acceptance claims, design the records, build the book to 0 problems, read the gaps and the derived evals); spike a risk; scaffold code from the records; run the evals and read the scoreboard; open the portal; drive the clock (warp, freeze, step) and see a scheduled job fire; see a trace end to end; define the swarm (the files in .swarmd/); start the master on a goal prompt and see its board; a pair takes one task from brief to merge (maker handback, checker verdict, rounds, the gate, the merge); Aaron answers a decision; watch progress; add a lane manager later. Show real commands and code for what exists, the documented API for swarmD, and say plainly where nothing is designed yet. Keep it readable: short sections, one code block each.`, { label: 'write:dx', phase: 'Write', schema: OUT })

phase('Review')
const review = await agent(`${COMMON}

You REVIEW ${KIT}/docs/dx.md and ${KIT}/.swarmd/. The writer's report: ${JSON.stringify(made)}
Check every swarmD snippet and field against the documentation pages, word for word where it names an API: a field, call or command the docs do not define must be marked as a gap, not presented as the API. Run every command the walkthrough marks as working today and confirm it does what the page says. Confirm the kit's checks still pass with .swarmd/ present (pnpm check). Fix what you refute in those files only (and the ignore lines in vite.config.ts and tsconfig.json), do not commit, and report.`, { label: 'review:dx', phase: 'Review', schema: REV })
return { made, review }