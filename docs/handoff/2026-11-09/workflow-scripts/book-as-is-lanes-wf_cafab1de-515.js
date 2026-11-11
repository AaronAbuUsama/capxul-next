export const meta = {
  name: 'book-as-is-lanes',
  description: 'Book lanes of the old system as-is: a writer, then an adversarial reviewer who fixes',
  phases: [
    { title: 'Write', detail: 'one writer per lane, from the old code' },
    { title: 'Review', detail: 'a fresh reviewer re-reads the old code and fixes the lane' },
  ],
}

const CONTEXT = `You are booking the OLD Capxul system "as it is" into a typed design book.
- READ FIRST: /home/user/capxul-next/books/as-is/CONVENTIONS.md (folders, ids, export names, fidelity rules). Then look at the reviewed example concept /home/user/capxul-next/books/as-is/payments/ (data.ts, procedures.ts, commands.ts, flows.ts, index.ts) and the schema in /home/user/capxul-next/packages/book/src/records/*.ts.
- Old code, read only: /home/user/factory (branch integration/factory).
- Other lanes are writing other folders at the same time. Import their records by the conventional export names; never define a record another lane owns. books/as-is/payments/neighbors.ts lists stand-ins for other concepts' records: if your lane books one of those concepts, define each of its listed records with the same id and export name.
- Record what the old code does, with was: ["path:line"] evidence on every record. Do not fix the old design; do not invent budgets, worlds or measurements. Be complete within your lane.
- Write only the files of your lane. Do not commit.`

const WRITE = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    records: { type: 'integer' },
    missing: { type: 'array', items: { type: 'string' }, description: 'records you import by conventional name that another lane must define' },
    notes: { type: 'string' },
  },
  required: ['files', 'records', 'missing', 'notes'],
}

const REVIEW = {
  type: 'object',
  properties: {
    checked: { type: 'integer' },
    findings: { type: 'array', items: { type: 'object', properties: { record: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['record', 'problem', 'evidence', 'fixed'] } },
    designFindings: { type: 'array', items: { type: 'string' }, description: 'what the OLD design gets wrong here, with path:line evidence: boundary breaks, duplicate stores, plumbing, dead code, bugs, docs that contradict code' },
    keep: { type: 'array', items: { type: 'string' }, description: 'behaviours and money rules the target design must keep, with evidence' },
    notes: { type: 'string' },
  },
  required: ['checked', 'findings', 'designFindings', 'keep', 'notes'],
}

const results = await pipeline(
  args.lanes,
  (l) => agent(`${CONTEXT}\n\nYOUR LANE: ${l.name}\n${l.brief}\n\nWrite every file of your lane now. Typecheck as the conventions say and fix your errors. Report the files, the record count, and every record you import by conventional name from a lane that may not have written it yet.`,
    { label: `write:${l.name}`, phase: 'Write', schema: WRITE }),
  (w, l) => agent(`${CONTEXT}\n\nYou are the ADVERSARIAL REVIEWER of lane ${l.name}. Its brief: ${l.brief}\nThe writer reported: ${JSON.stringify(w || {})}\n\nFor every record in the lane's files, re-read the old code at its was: evidence and check every field: tables and fields, states and transitions, reads, writes, drives, invokes, calls, chain functions, errors, triggers, idempotency, retries, flows' steps, operations' implementedBy and refusals. Look for wrong facts, invented values, records the lane's scope covers but its files lack, wrong rpc-versus-workflow classification, ids or export names that break the conventions. Fix the files in place and typecheck. Report each finding (fixed true or false), the old design's faults this lane shows (designFindings), and what the target must keep (keep).`,
    { label: `review:${l.name}`, phase: 'Review', schema: REVIEW }).then((r) => ({ lane: l.name, write: w, review: r })),
)
return results.filter(Boolean)
