export const meta = {
  name: 'book-as-is-files',
  description: 'Write, then adversarially review and fix, as-is design-book files for the old payments concept',
  phases: [
    { title: 'Write', detail: 'one writer per file, from the old code' },
    { title: 'Review', detail: 'a fresh reviewer re-reads the old code and fixes the file' },
  ],
}

const CONTEXT = `You are booking the OLD Capxul system "as it is" into a typed design book.
- Old code (read only): /home/user/factory (branch integration/factory). Backend concept: packages/backend/src/payments/. Protocol rows: packages/protocol/src/payments/. SDK: packages/sdk/src/payments/. CLI: apps/cli/src/commands/payment/. Old operation book: apps/docs/factory/operations/*.yaml.
- New repo (write here): /home/user/capxul-next. Book files go in /home/user/capxul-next/books/as-is/payments/.
- READ FIRST: /home/user/capxul-next/books/as-is/payments/CONVENTIONS.md (ids, export names, which file owns what, fidelity rules). Schema: /home/user/capxul-next/packages/book/src/records/*.ts. A complete example of every record kind: /home/user/capxul-next/packages/book/test/fixtures/invitations.ts.
- Other writers are writing the sibling files at the same time. Import their records by the conventional export names from "./<file>.ts"; never define a record another file owns.
- Typecheck with: cd /home/user/capxul-next/books && npx tsc -p . 2>&1 | grep "as-is/payments/<your file>"  — fix every error in YOUR file except "Cannot find module" or "has no exported member" for sibling files that may not exist yet.
- Record what the old code does, with was: ["path:line"] evidence on every record. Do not fix the old design, do not invent budgets or worlds. Be complete within your scope: every table, transition, operation, call that the scope covers.
- Do not touch files other than your own. Do not commit.`

const WRITE = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    records: { type: 'integer' },
    exports: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'object', properties: { export: { type: 'string' }, kind: { type: 'string' }, ownerFile: { type: 'string' }, why: { type: 'string' } }, required: ['export', 'kind', 'why'] } },
    notes: { type: 'string' },
  },
  required: ['file', 'records', 'exports', 'missing', 'notes'],
}

const REVIEW = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    checked: { type: 'integer' },
    findings: { type: 'array', items: { type: 'object', properties: { record: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['record', 'problem', 'evidence', 'fixed'] } },
    missing: { type: 'array', items: { type: 'object', properties: { export: { type: 'string' }, kind: { type: 'string' }, ownerFile: { type: 'string' }, why: { type: 'string' } }, required: ['export', 'kind', 'why'] } },
    designFindings: { type: 'array', items: { type: 'string' }, description: 'what this file shows is tangled or wrong in the OLD design: boundary breaks, duplicate stores, plumbing, dead code; with evidence' },
    notes: { type: 'string' },
  },
  required: ['file', 'checked', 'findings', 'missing', 'designFindings', 'notes'],
}

const writePrompt = (f) => f.doc
  ? `${f.brief}\n\nReturn: file = the path you wrote, records = number of sections, exports = section headings, missing = [] unless you could not find evidence for something, notes = a summary.`
  : `${CONTEXT}\n\nYOUR FILE: books/as-is/payments/${f.file}\nYOUR SCOPE: ${f.brief}\n\nWrite the whole file now. Then typecheck as described and fix your errors. Report every export you defined, and in "missing" every record you needed from a file that should own it (by the conventions) but that you could not be sure exists.`

const reviewPrompt = (f, w) => f.doc
  ? `You are an adversarial reviewer. Another agent wrote ${f.brief.split('\n')[0]}\nThe document is at the path it reported: ${w ? w.file : '(see brief)'}. Re-check EVERY factual claim and count against the old repo at /home/user/factory (branch integration/factory) and the specs in /home/user/capxul-next/docs/spec/. Fix wrong facts and weak reasoning in place. Each policy must have 2 to 4 real options, a rubric grade per option, a recommendation and the evidence with paths. Report each finding with fixed=true when you fixed it.`
  : `${CONTEXT}\n\nYou are an ADVERSARIAL REVIEWER of books/as-is/payments/${f.file}, written by another agent whose report was: ${JSON.stringify(w || {})}.\nScope the file was meant to cover: ${f.brief}\n\nFor every record in the file, re-read the old code at its was: evidence and check every field: tables and fields, states and transitions (from/to), reads and writes, drives, invokes, calls, chain functions, errors, triggers, idempotency, retries. Look for: wrong facts, invented values (budgets, worlds, p95), records the scope covers but the file lacks, wrong rpc-versus-workflow classification, ids or export names that break CONVENTIONS.md. Fix the file in place, then typecheck it as described. Report each finding with fixed=true or false, anything still missing from sibling files, and designFindings: what the old design gets wrong, as evidence for the rebuild.`

const results = await pipeline(
  args.files,
  (f) => agent(writePrompt(f), { label: `write:${f.file}`, phase: 'Write', schema: WRITE }),
  (w, f) => agent(reviewPrompt(f, w), { label: `review:${f.file}`, phase: 'Review', schema: REVIEW }).then((r) => ({ file: f.file, write: w, review: r })),
)
return results.filter(Boolean)
