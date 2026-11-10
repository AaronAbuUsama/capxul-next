export const meta = {
  name: 'book-target-assemble',
  description: 'Assemble the target book: resolve every cross-concept item by owning group, then build it to zero problems',
  phases: [
    { title: 'Resolve', detail: 'one fixer per group of concepts, editing only its own folders' },
    { title: 'Build', detail: 'one builder takes the whole target book to zero problems and measures it' },
  ],
}

// Run with args: { groups: [{ name, folders: ["books/target/payments", ...], concepts: ["payments", ...] }] }.
// The items are in docs/decisions/assembly-items.md (from the designers), docs/decisions/concept-reports.json,
// and docs/decisions/target-architecture-review.json (owner changes the review made after some designs).

const CONTEXT = `You are assembling the TARGET design book of the Capxul rebuild in /home/user/capxul-next/books/target/.
Read first: books/target/CONVENTIONS.md, docs/decisions/README.md, docs/decisions/target-architecture.md, docs/spec/50-design-book.md, and the schema in packages/book/src/records/*.ts.
The cross-concept items: docs/decisions/assembly-items.md (each designer's open items and pending links), docs/decisions/concept-reports.json (their full reports), and docs/decisions/target-architecture-review.json (the architecture review's findings; it changed some operation owners after designs were written: org.member.invite moved to budgets, dev.mail.notices to devnet; check books/target/shared/foundation.ts OPERATION_OWNERS and the operations each concept's operations.ts books).
Build: cd /home/user/capxul-next && npx tsc -p books && node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target-assembly (stage "target"; findings.json lists problems and gaps).
Every judgment you make is a decision record in the owning concept's decisions.ts (or books/target/shared/decisions.ts for shared records), with options, the choice and why. Never weaken a frozen claim or drop a frozen operation; never edit books/frozen/. Do not commit.`

const RESOLVE = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    resolved: { type: 'array', items: { type: 'string' } },
    declined: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, why: { type: 'string' } }, required: ['item', 'why'] } },
    forOthers: { type: 'array', items: { type: 'string' }, description: 'items that need a change outside your folders' },
    notes: { type: 'string' },
  },
  required: ['group', 'resolved', 'declined', 'forOthers', 'notes'],
}

const BUILD = {
  type: 'object',
  properties: {
    records: { type: 'integer' }, evals: { type: 'integer' }, problems: { type: 'integer' }, gaps: { type: 'integer' },
    gapsByRule: { type: 'object', additionalProperties: { type: 'integer' } },
    decisions: { type: 'integer' },
    operationsBooked: { type: 'integer', description: 'frozen operations with a target operation record (of 215)' },
    missingOperations: { type: 'array', items: { type: 'string' } },
    changes: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['records', 'evals', 'problems', 'gaps', 'gapsByRule', 'decisions', 'operationsBooked', 'missingOperations', 'changes', 'notes'],
}

phase('Resolve')
const resolved = await parallel(args.groups.map((g) => () =>
  agent(`${CONTEXT}\n\nYOUR GROUP: ${g.name}. You may edit ONLY these folders: ${g.folders.join(', ')}. Other fixers edit the other folders at the same time.\nWork through every assembly item that concerns your concepts (${g.concepts.join(', ')}): links that now resolve to real records (replace a links.ts stand-in with a plain import once the target exists), interface gaps other concepts asked of you (an input, a field, a procedure, an event), operations the architecture review moved to or from your concepts (book the moved-in operation with frozenText; remove a moved-out one), and the shared changes others asked for if your group owns books/target/shared. Resolve each item in your folders or decline it with a reason. Typecheck. Report what you resolved, what you declined and why, and what needs a change outside your folders.`,
    { label: `resolve:${g.name}`, phase: 'Resolve', schema: RESOLVE })))

phase('Build')
const built = await agent(`${CONTEXT}\n\nYou are the BUILDER. The fixers' reports: ${JSON.stringify(resolved.filter(Boolean))}\n\nRegister every concept folder in books/target/index.ts. Apply the forOthers items the fixers could not. Then build the whole target book with stage "target" and fix until it has ZERO problems, editing any folder; each non-trivial fix is a decision record. Check that every one of the 215 frozen operations (books/frozen/operations.ts) has exactly one target operation record, and book any that is missing in its owner's operations.ts. Report the final counts: records, evals, problems, gaps by rule, decision records, operations booked, and every change you made.`,
  { label: 'build', phase: 'Build', schema: BUILD })
return { resolved, built }
