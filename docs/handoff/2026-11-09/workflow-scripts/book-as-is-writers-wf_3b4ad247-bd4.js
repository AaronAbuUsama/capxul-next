export const meta = {
  name: 'book-as-is-writers',
  description: 'Write the as-is lanes that stopped on the usage limit (writers only; reviews follow in a later wave)',
  phases: [{ title: 'Write', detail: 'one writer per lane, from the old code' }],
}

const CONTEXT = `You are booking the OLD Capxul system "as it is" into a typed design book.
- READ FIRST: /home/user/capxul-next/books/as-is/CONVENTIONS.md (folders, ids, export names, fidelity rules). Then look at the reviewed example concept /home/user/capxul-next/books/as-is/payments/ (data.ts, procedures.ts, commands.ts, flows.ts, index.ts) and the schema in /home/user/capxul-next/packages/book/src/records/*.ts.
- Old code, read only: /home/user/factory (branch integration/factory).
- Most other concepts are already booked in books/as-is/<concept>/. Many of them import records your lane owns by conventional name: run cd /home/user/capxul-next && npx tsc -p books 2>&1 | grep -E "<your folder or file>" to see exactly which names other files expect from your lane, and define every one of them (or, when a name is wrong by the conventions, note it in your report; never rename another lane's import yourself). books/as-is/payments/neighbors.ts lists stand-ins for other concepts' records: define each one your lane owns with the same id and export name.
- Record what the old code does, with was: ["path:line"] evidence on every record. Do not fix the old design; do not invent budgets, worlds or measurements. Be complete within your lane.
- Write only the files of your lane; overwrite any partial file a stopped earlier writer left in your folder. Do not commit.`

const WRITE = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    records: { type: 'integer' },
    satisfied: { type: 'integer', description: 'how many names other files expected from your lane that now resolve' },
    unresolved: { type: 'array', items: { type: 'string' } },
    designFindings: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['files', 'records', 'satisfied', 'unresolved', 'designFindings', 'notes'],
}

const results = await parallel(args.lanes.map((l) => () =>
  agent(`${CONTEXT}\n\nYOUR LANE: ${l.name}\n${l.brief}\n\nWrite every file of your lane now. Typecheck and fix your errors until every name other files expect from your lane resolves. Report files, records, the count of expected names now resolving, anything still unresolved, and the old design's faults you saw (designFindings, with path:line).`,
    { label: `write:${l.name}`, phase: 'Write', schema: WRITE }).then((w) => ({ lane: l.name, write: w }))))
return results.filter(Boolean)
