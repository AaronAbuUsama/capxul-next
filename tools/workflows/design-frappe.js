export const meta = {
  name: 'design-frappe',
  description: 'Redesign Capxul around Frappe, book first: two lanes (given as args), each a designer then an adversarial reviewer',
  phases: [{ title: 'Design' }, { title: 'Review' }],
}
// args: { lanes: [{ key, own, task }] }
const COMMON = `Repository: /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It PREPARES the Capxul rebuild as a typed design book; no product code is written here. Read first: docs/design-book.md, books/target/CONVENTIONS.md, and Aaron's rulings in books/target/shared/rulings.ts. The governing ones (his latest, 8 November 2026): aaron.erp-on-capxul (Capxul's protocol is designed around Frappe, which is its UI, 'the head'; an organization's data lives in Frappe's shapes from the moment it starts, whether or not a head is connected; fork as little as possible, ideally none), aaron.frappe-shape (accounting and payroll sync with Frappe at the bare minimum; CRM and Projects are fundamental, in every organization; other apps come at start-up or through the FDE agent; the redesign is on the main line, book first, before the build), aaron.books-first-principles, aaron.crm-frappe-shape, aaron.projects, aaron.fde-agent, aaron.frappe-head, and its SUPERSEDED list (rewrite each superseded record to its ruling). Also system.frozen-behaviour (the 215 operations and what their acceptance claims require are kept; spelling is free; a rewritten claim keeps the frozen claim first in its was and has a decision).
THE MAP: docs/vision/erp.md was written from Frappe's real sources and checked by a reviewer. It was framed as speculative thinking before Aaron's latest ruling; use its mapping, its fact-to-voucher map and its 27 core checks as your starting point, now as main-line design. Frappe's sources may still be cloned at /tmp/erpnext, /tmp/hrms, /tmp/crm and /tmp/frappe; if not, clone them again with git clone --depth 1 from github.com/frappe. The skills fde-frappe:frappe-stack, fde-frappe:implement-erpnext and fde-frappe:build-on-frappe help (load them with the Skill tool).
Write your lane's design to docs/design/frappe/<your lane key>.md (that file only, among the docs), and change the records you own book first. Checks you must leave passing: npx tsc -p books; node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/<lane> (0 problems); node --experimental-strip-types tools/check-frozen.ts (0 breaches). Do NOT run tools/plan-tasks.ts or edit docs/mission/tasks.json, rulings.ts or judgments.md. Every judgment is a decision record in your concept's decisions.ts; mark one that needs Aaron by saying so in its why. Another workflow redesigns other concepts at the same time: stay inside what you own and put what others must change in forOthers. Do not commit.`
const OUT = { type: 'object', properties: {
  files: { type: 'array', items: { type: 'string' } },
  decisions: { type: 'array', items: { type: 'string' } },
  answersForAaron: { type: 'array', items: { type: 'string' } },
  questionsForAaron: { type: 'array', items: { type: 'string' } },
  forOthers: { type: 'array', items: { type: 'string' } },
  buildProblems: { type: 'integer' }, checkBreaches: { type: 'integer' }, notes: { type: 'string' } },
  required: ['files', 'decisions', 'answersForAaron', 'questionsForAaron', 'forOthers', 'buildProblems', 'checkBreaches', 'notes'] }
const REV = { type: 'object', properties: {
  refuted: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
  upheld: { type: 'array', items: { type: 'string' } }, buildProblems: { type: 'integer' }, checkBreaches: { type: 'integer' }, notes: { type: 'string' } },
  required: ['refuted', 'upheld', 'buildProblems', 'checkBreaches', 'notes'] }

return await pipeline(
  args.lanes,
  (l) => agent(`${COMMON}\n\nYOUR LANE: ${l.key}. You own ONLY: ${l.own}.\n\n${l.task}`, { label: `design:${l.key}`, phase: 'Design', schema: OUT }),
  (made, l) => agent(`${COMMON}\n\nYou are the ADVERSARIAL REVIEWER of the ${l.key} lane (it owns ${l.own}). Its report: ${JSON.stringify(made)}\nTry to refute it against Frappe's real doctypes (read them) and the baseline: is each shape true to Frappe, does sync work both ways without double-posting or a second source of truth for money (Capxul stays the system of record for money and identity), does every money path still settle exactly once with the right authority and tenancy, is every frozen operation's behaviour kept (check-frozen), is each ruling applied as Aaron said it, and is anything left for the build to freestyle? Fix what you refute in the lane's files only, keep 0 problems and 0 breaches, and report.`, { label: `review:${l.key}`, phase: 'Review', schema: REV }).then((r) => ({ made, review: r })),
)
