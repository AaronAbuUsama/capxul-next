export const meta = {
  name: 'handoff-freeze-flags-and-journeys',
  description: 'Freeze every frozen command\'s CLI flags from the old CLI, and book the old journeys as journey records; each checked by a reviewer',
  phases: [
    { title: 'Make', detail: 'a flags freezer and a journeys designer' },
    { title: 'Review', detail: 'a reviewer per maker' },
  ],
}

const COMMON = `Repository: /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It prepares the Capxul rebuild: a typed design book. Read docs/design-book.md first (how the book works), then HANDOFF.md. The old system, evidence only and read only, is cloned at /home/user/factory (branch integration/factory). Other agents are editing books/target/budgets, books/target/board and books/target/equity right now: do not edit those folders, and a transient problem there is not yours. Every judgment is a decision record (defineDecision, packages/book/src/records/outcomes.ts) with options, the choice and why. Checks: npx tsc -p books; node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/<your-name> (0 problems); node --experimental-strip-types tools/check-frozen.ts. Do not commit.`

const MAKE = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object', additionalProperties: { type: 'integer' } },
    mismatches: { type: 'array', items: { type: 'string' }, description: 'things that did not line up (a frozen command missing from the CLI, an old journey step with no target operation), each with what you did' },
    decisions: { type: 'array', items: { type: 'string' } },
    buildProblems: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['task', 'files', 'counts', 'mismatches', 'decisions', 'buildProblems', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    errors: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
    checked: { type: 'string', description: 'what you checked and how many' },
    buildProblems: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['task', 'errors', 'checked', 'buildProblems', 'notes'],
}

const TASKS = [
  {
    key: 'flags',
    make: `${COMMON}

YOUR TASK: FREEZE THE CLI FLAGS. The frozen surface includes the CLI's flags, but books/frozen/operations.ts (generated from the old book's YAML by tools/freeze-operations.py) holds flags only for some operations. The full definitions are in the old CLI: /home/user/factory/apps/cli/src (commands/, command.ts, runtime/, e.g. runtime/running-command-flags.ts).
1. Write a generator, tools/freeze-flags.ts (node --experimental-strip-types) or tools/freeze-flags.py, that reads the old CLI's own declarations (parse the source with the TypeScript compiler API if it is installed, or run the CLI's own help/manifest if it prints one without network or credentials) and writes books/frozen/flags.ts: for every one of the 215 frozen commands (match frozen[id].command exactly), its positional arguments (name, required, variadic) and its flags (long name, short alias, whether it takes a value, the value's type or choices, required, default, repeatable, the help text word for word), plus the global flags every command takes, once. Keep the old CLI's words; invent nothing. Running the generator again must reproduce the file byte for byte.
2. Add a helper to books/frozen/index.ts: frozenFlags(id).
3. List every mismatch: a frozen command the CLI does not have, a CLI command the frozen book does not have, a flag the frozen designed block lists that the CLI does not declare.
4. Add a section to tools/check-frozen.ts that checks books/frozen/flags.ts covers all 215 frozen commands (it cannot yet compare flags with the target, because operation records do not map flags to flow inputs: that mapping is the build session's first B1 step, book first). Run the checks.`,
    review: (made) => `${COMMON}

You REVIEW the frozen flags another agent extracted. Its report: ${JSON.stringify(made)}
Pick at least 25 commands across areas (payment, org, invoice, payroll, bank, agent, dev, auth, contact, equity) and compare books/frozen/flags.ts with the old CLI's source for each, flag by flag: names, aliases, value or boolean, required, default, help text. Run the generator again and check the output is byte-identical. Check every one of the 215 frozen commands has an entry. Fix what is wrong (in the generator, then regenerate). Report each error found and whether you fixed it.`,
  },
  {
    key: 'journeys',
    make: `${COMMON}

YOUR TASK: BOOK THE JOURNEYS. The target book has no journey records, so the journey evals (jrn:, fun:), the live journey-conversion eval and the devnet smoke journey have nothing to derive from. The old book has 13 journeys: /home/user/factory/apps/docs/factory/journeys/*.yaml (each a key, its operations in order, chapters). The journey record is defineJourney (packages/book/src/records/outcomes.ts): steps of {operation, as (a system actor of books/target/shared/foundation.ts system_capxul), proves (the target event that proves the step for the funnel: the owning machine's <machine>_transitioned event, or "success")}, and variants.
1. Write books/target/journeys.ts: one defineJourney per old journey, keeping its key as the id (dots or dashes instead of underscores if the id pattern needs it) and its steps in order, each step the target operation record of that frozen operation (import from books/target/<concept>/operations.ts) taken by the right actor, proved by the event the target sends when that step's operation succeeds (read the operation's flow, rpcs and the transitions they drive). Steps the old journey lists as optional reads and changes along the way can be left out of the funnel if they are not steps of the journey; record that choice.
2. Put this file's decision records in the same file (one writer per file): one for how journeys map onto the target, and one for any step you changed or dropped.
3. Register it in books/target/index.ts (add the module to the records list; keep the existing order otherwise).
4. Build to 0 problems. Report the jrn: and fun: evals derived and any unproven-step gaps.`,
    review: (made) => `${COMMON}

You REVIEW the journey records another agent booked in books/target/journeys.ts. Its report: ${JSON.stringify(made)}
For each of the 13 journeys, compare it with its old YAML in /home/user/factory/apps/docs/factory/journeys/ and with the target: every step is the right target operation, taken by an actor the system lists, in an order a person could actually follow, and its proving event really is sent when that operation succeeds (trace the operation's flow, its rpcs, the transitions they drive and those transitions' emits). A step proved by an event its operation does not send is an error. Fix errors in books/target/journeys.ts only, and keep the build at 0 problems. Report each error and whether you fixed it.`,
  },
]

return await pipeline(
  TASKS,
  (t) => agent(t.make, { label: `make:${t.key}`, phase: 'Make', schema: MAKE }),
  (made, t) => agent(t.review(made), { label: `review:${t.key}`, phase: 'Review', schema: REVIEW }).then((r) => ({ made, review: r })),
)