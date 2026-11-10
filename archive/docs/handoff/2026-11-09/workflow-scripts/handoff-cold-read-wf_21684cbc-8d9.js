export const meta = {
  name: 'handoff-cold-read',
  description: 'Two independent readers test the handoff: a cold-start build session and a fact checker of the guide and goal prompt',
  phases: [{ title: 'Read', detail: 'a cold-start reader and a fact checker, read-only' }],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          where: { type: 'string', description: 'the heading or the quoted text' },
          severity: { type: 'string', enum: ['blocks', 'misleads', 'minor'] },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'the command run or the file and line that shows it' },
          fix: { type: 'string' },
        },
        required: ['file', 'where', 'severity', 'problem', 'evidence', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const COMMON = `The repository is /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It prepares a rebuild of Capxul: a typed design book (books/target, packages/book) and a goal prompt that starts the build. READ ONLY: do not edit, commit or run anything that writes outside /tmp. Other agents are editing books/target/budgets, books/target/board and books/target/equity right now, so a transient build problem in those folders is not a finding; say so if you see one. Report only what you verified, each with evidence.`

const [cold, facts] = await parallel([
  () => agent(`${COMMON}

You are a NEW build session with no memory of how this repository was made. You have been given docs/mission/initializer.md as your goal. Read it, then HANDOFF.md and docs/design-book.md, and follow their set-up and checks as far as you can without writing anything (the old repository is already cloned at /home/user/factory; npm install is done). Then plan, concretely, your first two milestones (B0, the durable-execution spike, and B1, the generators): which records you would read, which files you would create, what you would run to prove each exit.
Report everything that would block or mislead you: a path or command that does not exist or fails, an exit check you cannot tell how to run, a term used before it is defined, two documents that disagree, a decision you would need that no record or document makes, anything you would have to ask about. Do not report style.`, { label: 'cold-start', phase: 'Read', schema: FINDINGS }),
  () => agent(`${COMMON}

You are a FACT CHECKER. Check every factual claim in docs/design-book.md, docs/mission/initializer.md and HANDOFF.md against the code and the data: file and folder paths, rule names (packages/book/src/build.ts), gap and eval id patterns (packages/book/src/evals.ts), record kinds and fields (packages/book/src/records/*.ts), the counts (records, evals, problems, gaps by rule, decisions, operations, acceptance lines kept/changed/retired, tests), the worked example's code excerpts against books/target/payments/*.ts, and every command (run the read-only ones: npx tsc -p packages/book, npm test -w @capxul/book, npx tsc -p books, the book build into /tmp, tools/check-frozen.ts, tools/report-judgments.ts to stdout). Also check claims about the old system (apps/docs, apps/factory in /home/user/factory) against that code.
Report each claim that is wrong or out of date, with the true value and where you found it.`, { label: 'fact-check', phase: 'Read', schema: FINDINGS }),
])
return { cold, facts }