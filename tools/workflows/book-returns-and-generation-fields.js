export const meta = {
  name: 'book-returns-and-generation-fields',
  description: 'Check the frozen --json shapes and close their breaches; add the row-policy and wait-key fields the generators need; each with an adversarial reviewer',
  phases: [
    { title: 'Make', detail: 'a returns fixer and a generation-fields designer' },
    { title: 'Review', detail: 'an adversarial reviewer per maker' },
  ],
}

const COMMON = `Repository: /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It prepares the Capxul rebuild: a typed design book. Read docs/design-book.md first (how the book works), then books/target/CONVENTIONS.md and docs/decisions/policy-pack.md (P1 to P10; P9 drops everything pre-v4; P10 makes an operation's designed v4 block the specification where it exists). The old system, evidence only and read only, is cloned at /home/user/factory (branch integration/factory). Every judgment is a decision record (defineDecision) in the owning concept's decisions.ts, with options, the choice and why. Checks: npx tsc -p packages/book && npm test -w @capxul/book; npx tsc -p books; node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/<your-name> (0 problems); node --experimental-strip-types tools/check-frozen.ts (0 breaches). Never edit books/frozen/. Another agent works in parallel on other files (named in your task); stay out of them. Do not commit.`

const MAKE = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' }, description: 'each change: the record, what changed and why' },
    decisions: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object', additionalProperties: { type: 'integer' } },
    buildProblems: { type: 'integer' },
    checkBreaches: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['task', 'changed', 'decisions', 'counts', 'buildProblems', 'checkBreaches', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    refuted: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
    upheld: { type: 'array', items: { type: 'string' } },
    buildProblems: { type: 'integer' },
    checkBreaches: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['task', 'refuted', 'upheld', 'buildProblems', 'checkBreaches', 'notes'],
}

const TASKS = [
  {
    key: 'returns',
    make: `${COMMON}

YOUR TASK: THE FROZEN --json SHAPES. The frozen surface includes what each command prints with --json. books/frozen/operations.ts holds each operation's returns (frozen[id].returns: fields with their meaning) and, where it has one, its designed v4 block. tools/check-frozen.ts does not yet compare them with the target operation records' returns (an Effect Schema Struct; its top-level keys are schema.fields). A cold read found at least 15 operations whose target shape drops or renames frozen fields, for example auth.verify (frozen setupState is nested under setup), bank.details (frozen currency, state, visibility, fields, destination, developerFeePercent; target items, unverified) and inbox.pay (frozen approval, payments; target request), with no decision naming the change.
1. Extend tools/check-frozen.ts: for every operation, every frozen returns field (the designed block's where it has one, by P10, else the page's) must be a top-level key of the target returns, unless a decision record on that operation names the field and says why; report each breach. Keep the existing checks.
2. For every breach, restore the frozen field in the target returns (and in the flow's or rpc's output it comes from, so the shape is real), or, only where the field cannot exist in the target (a pre-v4 fact P9 drops; the designed block replaces it), record a decision in the owning concept naming the field. Renaming a frozen field is a breaking change to the public surface: restore the frozen name. You may edit any concept's operations.ts, flows.ts, area rpc files and decisions.ts; do NOT edit any concept's data.ts or processes.ts, or packages/book (the other agent's).
3. Run every check. Report each operation you changed and how.`,
    review: (made) => `${COMMON}

You are the ADVERSARIAL REVIEWER of the --json shape fixes. The fixer's report: ${JSON.stringify(made)}
Try to refute each change: does the restored field really reach the output (the flow's or rpc's output schema carries it, and a step produces it), or was a key just added to the operation's returns? Is every dropped or renamed frozen field backed by a decision with a real policy basis (P9 or the designed block), and is the frozen name kept where a field survives? Run tools/check-frozen.ts and confirm the returns section covers all 215 operations. Fix what you refute (same files the fixer could edit), and report each refuted and upheld change.`,
  },
  {
    key: 'generation-fields',
    make: `${COMMON}

YOUR TASK: THE FIELDS THE GENERATORS NEED. A cold read found two things the build session's generators (B1) cannot get from the records, because they are only prose:
(a) Row-level policy exceptions. TableSpec (packages/book/src/records/data.ts) has tenancy, tenantField and a free-text scope. Some tables admit a second party, in prose: payments/data.ts (the payee's tenant also reads a Payment, lines ~120 and ~198), requests/inbox.ts (~50, the addressed payer), media/data.ts (~49) and media/files.ts (~82, the row-level policy's one exception), documents/data.ts (~92, a session whose Safes...). Search every table's scope and about for others.
(b) Wake routing keys. A workflow wait (WorkflowSpec waits in packages/book/src/records/behaviour.ts) names its routing key only in its about (shared decision rules.process-wakeups: the opener and subject, the Payment id, or chain and hash).
Do this, book first:
1. Add to TableSpec an optional structured field for extra admissions (for example admits: [{ field: the column whose tenant is also admitted, or a join described by its table and column, reads: boolean, writes: boolean, about }]); and to a wait an optional key: the event properties (by name) that route an event to the waiting instance. Choose the exact shapes; keep both optional so the as-is book is unaffected. Add a target rule or gap so a chain, signal or indexer wait without a key, and a scope that mentions an admission without the field, are visible (choose which, and say why). Add tests in packages/book/test/build.test.ts. Update docs/spec/50-design-book.md (its record rows and rule tables) and add a decision record in books/target/shared/decisions.ts for the schema change, revising rules.process-wakeups in place to say the key is now a field.
2. Fill the fields: every table with an admission, and every wait in every concept's processes.ts. Each key must name properties the waited event actually carries (read the event's props schema).
You may edit packages/book, books/target/shared/decisions.ts, docs/spec/50-design-book.md, and every concept's data.ts, processes.ts and any area file that defines a table; do NOT edit operations.ts, flows.ts or tools/check-frozen.ts (the other agent's).
3. Run every check. Report what you added and filled.`,
    review: (made) => `${COMMON}

You are the ADVERSARIAL REVIEWER of the generation fields. The designer's report: ${JSON.stringify(made)}
Try to refute: does each wait's key name properties its event's props schema really carries, and would routing by that key reach exactly one waiting instance (not every instance of the process)? Does each table's admission match what the prose and the operations need (a payee reads its Payment; nothing more is admitted than the prose says)? Is any table that needs an admission left without one, or any wait left without a key? Are the new rule and the tests sound? Fix what you refute (same files the designer could edit), and report each refuted and upheld item.`,
  },
]

return await pipeline(
  TASKS,
  (t) => agent(t.make, { label: `make:${t.key}`, phase: 'Make', schema: MAKE }),
  (made, t) => agent(t.review(made), { label: `review:${t.key}`, phase: 'Review', schema: REVIEW }).then((r) => ({ made, review: r })),
)
