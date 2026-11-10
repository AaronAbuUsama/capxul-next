export const meta = {
  name: 'book-payments-assemble',
  description: 'Close the last authoring gaps in the as-is payments book and write its findings report',
  phases: [{ title: 'Assemble', detail: 'the missing approvals flow, CLI-level errors, a clean build' }, { title: 'Report', detail: 'what the old payments design gets wrong, with evidence' }],
}

const ASSEMBLE = {
  type: 'object',
  properties: {
    built: { type: 'boolean' },
    records: { type: 'integer' }, evals: { type: 'integer' }, problems: { type: 'integer' }, gaps: { type: 'integer' },
    problemsByRule: { type: 'object', additionalProperties: { type: 'integer' } },
    changes: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['built', 'records', 'evals', 'problems', 'gaps', 'problemsByRule', 'changes', 'notes'],
}

const REPORT = {
  type: 'object',
  properties: { file: { type: 'string' }, headline: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['file', 'headline', 'notes'],
}

const [assembled, reported] = await parallel([
  () => agent(`You finish the AS-IS design book of the OLD payments concept, in /home/user/capxul-next/books/as-is/payments/ (13 files plus index.ts; read CONVENTIONS.md there first; schema in /home/user/capxul-next/packages/book/src/records/*.ts). The old code is at /home/user/factory (branch integration/factory), read only.

Build command: cd /home/user/capxul-next && npx tsc -p books && node --experimental-strip-types --no-warnings packages/book/src/main.ts books/as-is/payments/index.ts /tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad/payments-book

Do exactly these, then stop:
1. operations.ts imports flow_client_approvals_prepare from ./flows.ts, which does not exist. The CLI commands payment send, retry, cancel and reschedule call client.approvals.prepare (packages/sdk/src/accounts/approvals.ts:106 and what it calls). Add that flow record to flows.ts, following the conventions and the other flows in that file: component core_sdk, sdk "client.approvals.prepare", steps in order (rpc steps use the existing rpc_* exports in commands.ts, executions.ts, verifications.ts, schedules.ts, movements.ts; if it calls an rpc of another concept, such as an approvals or permissions row that no file books, describe that step as a local step in words and list it in your notes), the errors the SDK itself produces, client-side calls (external.ts), spans, was evidence. No budget.
2. Six refusals fail the rule refusal-not-produced: CLI_USAGE on payment.cancel, get, retry, send, wait, and INVALID_RECIPIENT on payment.send. Operations now take an optional "errors" field: errors the CLI command itself produces. Find where each is produced in the old code (apps/cli for CLI_USAGE; the CLI, the SDK flow or the backend for INVALID_RECIPIENT) and put it where it is produced: the operation's errors, the flow's errors, or the rpc's errors, with was evidence.
3. Build. Fix only AUTHORING problems (dangling, undefined-link, duplicate, not-a-record, machine-state, machine-initial, refusal-not-produced, typecheck errors). Do NOT change records to hide design problems: read-boundary, write-boundary, invoke-boundary, drives-without-write, call-error-not-declared and cycle findings describe the old code and must stay unless a record is factually wrong.
Report the final counts from the build output and findings.json.`, { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE }),

  () => agent(`Write /home/user/capxul-next/docs/as-is/payments.md: the findings report for the OLD payments concept, for Aaron, who owns the product and will use it to decide the target design.

Sources:
- The as-is book files in /home/user/capxul-next/books/as-is/payments/ (read their about fields and comments).
- Seven workflow journals with every writer's and reviewer's report, including designFindings: /root/.claude/projects/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/subagents/workflows/wf_2ba8b158-849/journal.jsonl, wf_5e476a6b-b21, wf_ac554c5f-cd1, wf_1da00197-4a2, wf_f650b705-60a, wf_6490ba05-3ea, wf_dc4cec57-692 (same folder pattern; each line is JSON; the result lines hold the reports).
- A probe build's findings: /tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad/probe/out/findings.json and evals.json (503 records, 722 evals, 56 problems, 354 gaps).
- The policy pack: /home/user/capxul-next/docs/decisions/policy-pack.md.
Verify any claim you use against the old code at /home/user/factory before you write it; drop what you cannot verify.

Structure: a summary of at most 10 bullets; then sections: How a payment actually flows today (the real path through commands, executions, verifications, schedules, with the state machines); Coupling (concept cycles, direct reads of other concepts' tables such as profiles' identities read by 27 rpcs with no #profiles import, cross-concept writes, the six concepts a settlement writes into); Bugs and contradictions found (state machine edges that are wrong, retries that are not, errors that surface as the wrong code, docs that contradict code), each with path:line; Plumbing that the target design removes (counts of intent/load/emit/record operations, crons, scheduled calls); What the target payments design must keep (the money invariants and behaviours that are real); Gaps the build derived (by rule, with what they mean). Plain, direct sentences; tables where they help. Return the path and the summary bullets.`, { label: 'report', phase: 'Report', schema: REPORT }),
])
return { assembled, reported }
