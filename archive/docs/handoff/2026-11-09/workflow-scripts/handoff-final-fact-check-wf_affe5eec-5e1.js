export const meta = {
  name: 'handoff-final-fact-check',
  description: 'One read-only fact check of the final handoff documents against the code and Aaron\'s behaviour-not-spelling decision',
  phases: [{ title: 'Check', detail: 'one read-only fact checker' }],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, where: { type: 'string' }, severity: { type: 'string', enum: ['blocks', 'misleads', 'minor'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
      required: ['file', 'where', 'severity', 'problem', 'evidence', 'fix'] } },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}
return await agent(`Repository /home/user/capxul-next, branch claude/infrastructure-refactor-plan-v41iue, head 0fce1c2. READ ONLY: edit, commit and write nothing outside /tmp.
On 8 November 2026 Aaron decided (decision system.frozen-behaviour in books/target/shared/decisions.ts; docs/decisions/README.md): the freeze keeps behaviour, not spelling. The 215 operations stay as the list of capabilities and what each acceptance claim requires stays as the evals; flags, --json shapes, refusal codes and wording are the target's to design; a refusal is a behaviour, checked by its code only where the target's vocabulary keeps it. The old system is a reference for behaviour, not a baseline (no eval run against it). The as-is book is closed and archived in docs/as-is/archive/. books/frozen/flags.ts is reference.
Check these files: CLAUDE.md, README.md, HANDOFF.md, docs/design-book.md, docs/mission/initializer.md, books/target/CONVENTIONS.md, docs/decisions/README.md, docs/mission/remaining-work.md, docs/spec/50-design-book.md.
1. Any sentence that still says the old spelling is frozen surface to keep, that the frozen text wins on spelling, that evals run against the old system, or that the as-is book is live (books/as-is) contradicts the decision: report each.
2. Every number, path, command, rule name and eval id against the code: run npx tsc -p packages/book, npm test -w @capxul/book, npx tsc -p books, node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/fc-final (read findings.json and evals.json), node --experimental-strip-types tools/check-frozen.ts, node --experimental-strip-types tools/report-judgments.ts (to stdout). Report each wrong or stale claim with the true value.
3. Anything a new build session would trip on when starting B0 from docs/mission/initializer.md (a path that does not exist, two documents that disagree).
Report only verified findings, each with evidence. Do not report style.`, { label: 'fact-check-final', phase: 'Check', schema: FINDINGS })