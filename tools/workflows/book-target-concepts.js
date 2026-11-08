export const meta = {
  name: 'book-target-concepts',
  description: 'Design target concepts of the rebuild as typed records, one designer per concept, every judgment a decision record',
  phases: [{ title: 'Design', detail: 'one designer per target concept, checked by the target build' }],
}

// Run with args: { concepts: [{ id: "payments", brief: "..." }, ...] }. Two to four concepts per run.
// Each designer checks its own work with the target build (stage "target"), which enforces the
// accepted policies; a separate reviewer is optional and costs a second agent per concept.

const CONTEXT = `You design one concept of the TARGET Capxul rebuild as typed design-book records. The target is what will be built; it is not a copy of the old system.

Read first, in this order:
1. /home/user/capxul-next/books/target/CONVENTIONS.md (folders, ids, export names, the target rules you must satisfy).
2. /home/user/capxul-next/docs/decisions/README.md and target-architecture.md (the accepted decisions A1 to A4 and P1 to P10, and the target concept map: what your concept owns, what it absorbs from the old system, what it may depend on). The shared records are in books/target/shared/ (components, concepts, errors, integrations, v4 contracts, decisions).
3. The schema: /home/user/capxul-next/packages/book/src/records/*.ts and packages/book/src/budgets.ts; the reading guide docs/spec/50-design-book.md.
4. Evidence about the old system: books/as-is/<old concept>/ where it exists (it records what the old code does, with was: pointers), docs/as-is/payments.md, docs/as-is/lane-reports/*.json (reviewers' findings and keep lists), and the old code itself, read only, at /home/user/factory (branch integration/factory). Where the as-is book has no folder for an old concept, read the old code directly.
5. The frozen operations: /home/user/capxul-next/books/frozen/operations.ts (generated; never edit) and the helpers in books/frozen/index.ts.

Design rules (they are the accepted decisions; the target build enforces most of them):
- Every frozen operation your concept owns (by the concept map) gets one target operation record, built from frozenText(id), keeping its command and text. Acceptance is {claim, observes, was} (P1): keep each claim verbatim; only when a claim names an internal mechanism, rewrite it as an observable claim and record the rewrite in a decision. implementedBy is one rpc, or one Core SDK flow when the command needs several steps (A4: the CLI calls exactly one SDK method).
- Tables: tenancy and tenantField leading the key and every index unless crossTenant (P8). Only what the target needs: consolidate the old duplicate stores, drop pre-v4 shapes (P9), drop plumbing (P2, P3).
- State machines: every write to a status is a named transition; each machine sends exactly one event, <machine>_transitioned, defined in your data.ts (P7).
- A long-lived business object (a payment, a payout, an invitation with an expiry) is one durable workflow with instance { per: its table }, its signals (the rpcs that resume it) and its waits (signal, timer, chain, person, indexer) (A3, A2). Background sweeps are singleton workflows. A workflow is durable work no caller waits on (P3).
- Another concept's tables are written only through its procedures, and only for writes that must commit together with yours (the same money fact); everything else goes through the outbox, a workflow triggered by a transition (P4). Depend only on concepts the concept map allows.
- Budgets: budget(class) from packages/book/src/budgets.ts; an override says why (P5). Spans are made by the runtime at boundaries; list only extra spans (P6).
- Errors come from books/target/shared/vocabulary.ts; refusals use given worlds you name (a world is a named devnet snapshot; name it after what it holds, e.g. "org-with-funded-safe") and list each world you introduce in your decisions.
- Every judgment you make is a decision record (defineDecision) in your concept's decisions.ts, with options, the choice and why, and affects listing the records.

Write your files AS YOU GO, not all at the end: data.ts first, then procedures.ts, the area files, processes.ts, flows.ts, operations.ts, decisions.ts, so that work survives if you are stopped. Write books/target/<concept>/: data.ts, procedures.ts, one file per area (rpcs), processes.ts (durable workflows), flows.ts (Core SDK flows), decisions.ts, index.ts (the shape of books/target/shared/index.ts: export the module list), and the target operation records for your concept's frozen operations in books/target/<concept>/operations.ts.
Check: cd /home/user/capxul-next && npx tsc -p books, then build the target book (node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target-<concept>) after adding your concept's module to books/target/index.ts if it is not listed. Fix every problem in your own records until none remain; links to concepts not designed yet are allowed only by the conventional export names, and you list them. Other designers work on other concepts at the same time: never edit their folders. Do not commit.`

const OUT = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    records: { type: 'integer' },
    operations: { type: 'integer' },
    oldFunctions: { type: 'integer', description: 'how many old rpcs and workflows this concept replaces' },
    newBehaviour: { type: 'integer', description: 'rpcs, flows, procedures and workflows in the target design' },
    decisions: { type: 'integer' },
    problemsLeft: { type: 'array', items: { type: 'string' } },
    pendingLinks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['concept', 'files', 'records', 'operations', 'oldFunctions', 'newBehaviour', 'decisions', 'problemsLeft', 'pendingLinks', 'summary'],
}

const results = await parallel(args.concepts.map((c) => () =>
  agent(`${CONTEXT}\n\nYOUR CONCEPT: ${c.id}\n${c.brief || ''}`, { label: `design:${c.id}`, phase: 'Design', schema: OUT })
    .then((r) => ({ concept: c.id, result: r }))))
return results.filter(Boolean)
