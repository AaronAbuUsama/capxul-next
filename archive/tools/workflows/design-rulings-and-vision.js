export const meta = {
  name: 'design-rulings-and-vision',
  description: 'Apply Aaron\'s core rulings book first (escrow, money-waiting email, seats, contact permissions, portal generator), and think through the ERP vision without changing records; each with a reviewer',
  phases: [{ title: 'Design' }, { title: 'Review' }],
}
const COMMON = `Repository: /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It PREPARES the Capxul rebuild as a typed design book; no product code is written here. Read first: docs/design-book.md, books/target/CONVENTIONS.md, and Aaron's rulings in books/target/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.crm-frappe-shape, aaron.books-first-principles, aaron.contacts-permissions, aaron.seats, aaron.money-waiting, aaron.portal-generator, and its SUPERSEDED list: each superseded record is rewritten to its ruling, book first). Also system.frozen-behaviour in books/target/shared/decisions.ts: the 215 operations and what their acceptance claims require are kept; spelling is free; a rewritten claim keeps the frozen claim first in its was and has a decision.
THE MAIN LINE (Aaron, 8 November 2026): what is built now is the baseline of the new product (the rebuilt Capxul) and the starter kit. The long-term vision is an agentic ERP that runs on stablecoins, an opinionated front end to Capxul tailored to real business, built on Frappe and ERPNext (forking only what must feel integrated, accounting most likely, ideally nothing). That vision is SPECULATIVE: its thinking is on the main line so the baseline supports it, its work is not. Never redesign a concept into Frappe's shape on the main line unless it touches Capxul's core, and then only as a question for Aaron.
The old system, read only, is /home/user/factory (branch integration/factory); its v4 contracts are under packages/contracts/v4.
Checks you must leave passing: npx tsc -p books; node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/<lane> (0 problems); node --experimental-strip-types tools/check-frozen.ts (0 breaches). Do NOT run tools/plan-tasks.ts or edit docs/mission/tasks.json (the orchestrator regenerates it). Every judgment is a decision record; mark one that needs Aaron by saying so in its why. Do not commit.`
const OUT = { type: 'object', properties: {
  files: { type: 'array', items: { type: 'string' } },
  decisions: { type: 'array', items: { type: 'string' } },
  answersForAaron: { type: 'array', items: { type: 'string' }, description: 'plain-language answers to the questions Aaron asked' },
  questionsForAaron: { type: 'array', items: { type: 'string' } },
  forOtherLane: { type: 'array', items: { type: 'string' } },
  buildProblems: { type: 'integer' }, checkBreaches: { type: 'integer' }, notes: { type: 'string' } },
  required: ['files', 'decisions', 'answersForAaron', 'questionsForAaron', 'forOtherLane', 'buildProblems', 'checkBreaches', 'notes'] }
const REV = { type: 'object', properties: {
  refuted: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, evidence: { type: 'string' }, fixed: { type: 'boolean' } }, required: ['what', 'evidence', 'fixed'] } },
  upheld: { type: 'array', items: { type: 'string' } }, buildProblems: { type: 'integer' }, checkBreaches: { type: 'integer' }, notes: { type: 'string' } },
  required: ['refuted', 'upheld', 'buildProblems', 'checkBreaches', 'notes'] }

const LANES = [
  {
    key: 'core-rulings',
    own: 'books/target/payments, books/target/notices, books/target/organizations, books/target/agents, books/target/access, books/target/contacts, books/target/shared/vocabulary.ts, books/target/shared/external.ts (the escrow and agent contracts only), books/target/shared/portal.ts and docs/design/portal.md',
    task: `YOUR LANE: THE CORE RULINGS. A stopped earlier run of this lane left uncommitted edits in books/target/payments, books/target/shared/external.ts and books/target/shared/vocabulary.ts (see git diff): read them, keep what is right, and finish.
1. The escrow, checked fit for purpose (aaron.money-waiting): read the v4 escrow contract and its factory in /home/user/factory/packages/contracts/v4 and the target's payments escrow design. Answer plainly in answersForAaron: does it hold funds that only the recipient's Capxul account can unlock once they have one (how is the recipient bound at send time when they have no account yet: an email hash, a claim secret, a predicted address?), can the sender refund any time before the recipient accepts, can anyone else take the money, and what happens at expiry. List every gap as a decision or a question for Aaron.
2. The money-waiting email: a notice on escrow (notices concept), naming the amount, the payer and how to collect, with its event and its world; rewrite notices.claim-escrow to the ruling.
3. Seats (aaron.seats): a company starts with ten seats, in the beta and after; each seat may hold one agent account; the company may hold one agent of its own. Model the limit (where it is stored, who raises it), the refusals (an error from the vocabulary, or a new one with a decision), and keep every frozen operation's behaviour.
4. The contact book's edit permission (aaron.contacts-permissions): who holds it (for example the People hat or a contacts permission), the contacts rpcs' who and refusals, and contacts.members-write rewritten to the ruling.
5. The portal (aaron.portal-generator): rewrite portal.stack and docs/design/portal.md so the portal is the book's own generator's output (as tools/portal-prototype.ts and the starter kit do) and Fumadocs is set aside; keep the rest of the portal design.
Edit only what you own.`,
  },
  {
    key: 'erp-vision',
    own: 'docs/vision/erp.md (new) ONLY; you change no record',
    task: `YOUR LANE: THE ERP VISION, THINKING ONLY. Write docs/vision/erp.md, marked speculative at the top: how an agentic ERP on stablecoins (Aaron's long-term target) would sit on Capxul, built on Frappe and ERPNext. For Frappe knowledge, load the skills fde-frappe:frappe-stack and fde-frappe:implement-erpnext with the Skill tool, and if the network allows read the real doctypes (git clone --depth 1 https://github.com/frappe/erpnext, https://github.com/frappe/hrms and https://github.com/frappe/crm into /tmp); say which you used. Cover: which Frappe apps would be used as they are and which might be forked to feel integrated (accounting most likely), and why; how people and companies (the global directory) would meet Frappe CRM; how accounting on a Frappe fork would take Capxul's money facts (what Capxul must record so a ledger can post it, and what the ledger owns); how payroll would work, and how a payslip comes from on-chain pay in both directions (the payroll app computes the gross, deductions and net and instructs Capxul to pay; Capxul pays on chain; the settled facts, transaction, block time and payment id flow back to mark the slip paid and post the entries); and how the one clock would drive the larger system. Then the important part: a list of CORE CHECKS, each a place where today's baseline (books/target) would block or fit the vision, with evidence (the record and field). For each blocker, write a question for Aaron in questionsForAaron rather than changing anything. Put plain-language answers to Aaron's payslip question in answersForAaron.`,
  },
]

return await pipeline(
  LANES,
  (l) => agent(`${COMMON}\n\nYou own ONLY: ${l.own}. The other lane works in parallel on other folders.\n\n${l.task}`, { label: `design:${l.key}`, phase: 'Design', schema: OUT }),
  (made, l) => agent(`${COMMON}\n\nYou are the ADVERSARIAL REVIEWER of the ${l.key} lane (it owns ${l.own}). Its report: ${JSON.stringify(made)}\nTry to refute it: does every money path still settle exactly once with the right authority and tenancy, is every frozen operation's behaviour kept (check-frozen), is each ruling applied as Aaron said it (the ERP stays speculative and off the main line; the vision lane changed no record), is anything said about Frappe true to its real doctypes, are the answers to Aaron correct and plain, and is anything left for the build to freestyle? Fix what you refute in the lane's files only, keep 0 problems and 0 breaches, and report.`, { label: `review:${l.key}`, phase: 'Review', schema: REV }).then((r) => ({ made, review: r })),
)