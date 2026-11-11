export const meta = {
  name: 'design-frappe-and-rulings',
  description: 'Apply Aaron\'s rulings book first: the Frappe shape and the books redesign with payslips, and escrow, seats, permissions and the portal; each with an adversarial reviewer',
  phases: [{ title: 'Design' }, { title: 'Review' }],
}
const COMMON = `Repository: /home/user/capxul-next (branch claude/infrastructure-refactor-plan-v41iue). It PREPARES the Capxul rebuild as a typed design book; no product code is written here. Read first: docs/design-book.md, books/target/CONVENTIONS.md, and Aaron's rulings in books/target/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.crm-frappe-shape, aaron.books-first-principles, aaron.contacts-permissions, aaron.seats, aaron.money-waiting, aaron.portal-generator, and its SUPERSEDED list: each superseded record is rewritten to its ruling, book first). Also system.frozen-behaviour in books/target/shared/decisions.ts: the 215 operations and what their acceptance claims require are kept; spelling is free; a rewritten claim keeps the frozen claim first in its was and has a decision.
CONTEXT FROM AARON (8 November 2026): Capxul is the money, identity and governance layer of a larger system, an ERP whose applications are Frappe's. Accounting is the app to fork (accounting is assumed and works a certain way in Frappe); HR, CRM and projects probably need no fork, but every app is shaped the Frappe way. The global directory of people is a CRM in Frappe CRM's shape. Payslips need to be generated from on-chain data: Aaron asked how that would work and how the two integrations work. A company starts with ten seats; each seat may hold one agent account, plus the company's own agent. Editing the contact book needs a permission. Money waiting in escrow sends a money-waiting email; the escrow contract must hold funds that only the recipient's Capxul account can unlock once they have one, and that the sender can refund any time before the recipient accepts. The portal is the generator's output; Fumadocs is set aside.
For Frappe knowledge: load the skills fde-frappe:frappe-stack and fde-frappe:implement-erpnext with the Skill tool, and if the network allows, read the real doctypes (for example git clone --depth 1 https://github.com/frappe/erpnext and https://github.com/frappe/hrms and https://github.com/frappe/crm into /tmp, then read their doctype JSON files); say which you used. The old system, read only, is /home/user/factory (branch integration/factory); its v4 contracts are under packages/contracts/v4.
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
    key: 'frappe-books',
    own: 'books/target/books, books/target/payroll, books/target/parties, books/target/contacts, books/target/documents (payslip documents only), and docs/design/frappe.md (new)',
    task: `YOUR LANE: THE FRAPPE SHAPE AND THE MONEY RECORDS.
1. docs/design/frappe.md: which Capxul concepts are on the critical path and which Frappe app and doctypes each corresponds to (people and companies onto Frappe CRM; the books onto ERPNext's accounting; pay agreements, salary structures, payroll entries and salary slips onto Frappe HR; documents; requests and payments where ERPNext has payment entries and invoices; anything else on the critical path), with a field-level mapping of each Capxul table that holds what a doctype holds.
2. The books, redesigned from first principles as a Capxul-native fork of Frappe's accounting (aaron.books-first-principles): its tables take the accounting doctypes' shape (account tree, journal entry, general ledger entry, payment entry, fiscal year, cost centre, or what the real doctypes show), and a money fact proven on chain posts the ledger entries. Keep every books operation's behaviour (its acceptance claims and refusals) or rewrite a claim with a decision. Rewrite books.facts-without-chart to the ruling.
3. Payroll shaped the Frappe HR way (not forked): pay agreements and their terms map onto salary structures and assignments; and design how a payslip is generated from on-chain data. Answer Aaron's question plainly in answersForAaron: which side computes what (the gross, the deductions, the net), which side pays (Capxul, on chain), what the payslip carries (the computed lines and the on-chain proof: the transaction, the block time, the payment id), and how the two integrations run in each direction (the payroll app instructing Capxul to pay; Capxul's settled facts flowing back to mark the slip paid and post the accounting entries). Rewrite payroll.scope to the ruling.
4. People and companies in Frappe CRM's shape (aaron.crm-frappe-shape) for parties and contacts, and the contact book's edit permission (aaron.contacts-permissions): the contacts rpcs' who and refusals, and contacts.members-write rewritten.
Edit only the folders you own. If payments, notices, organizations or shared records must change for your design, put it in forOtherLane instead.`,
  },
  {
    key: 'escrow-seats-portal',
    own: 'books/target/payments, books/target/notices, books/target/organizations, books/target/agents, books/target/access, books/target/shared/vocabulary.ts, books/target/shared/external.ts (the escrow and agent contracts only), books/target/shared/portal.ts and docs/design/portal.md',
    task: `YOUR LANE: ESCROW, THE MONEY-WAITING EMAIL, SEATS AND THE PORTAL.
1. The escrow, checked fit for purpose (aaron.money-waiting): read the v4 escrow contract and its factory in /home/user/factory/packages/contracts/v4 and the target's payments escrow design. Answer plainly in answersForAaron: does it hold funds that only the recipient's Capxul account can unlock once they have one (how is the recipient bound at send time when they have no account yet: an email hash, a claim secret, a predicted address?), can the sender refund any time before the recipient accepts, can anyone else take the money, and what happens at expiry. List every gap as a decision or a question for Aaron.
2. The money-waiting email: a notice on escrow (notices concept), naming the amount, the payer and how to collect, with its event and its world; rewrite notices.claim-escrow to the ruling.
3. Seats (aaron.seats): a company starts with ten seats, in the beta and after; each seat may hold one agent account; the company may hold one agent of its own. Model the limit (where it is stored, who raises it), the refusals (an error from the vocabulary, or a new one with a decision), and keep every frozen operation's behaviour.
4. The portal (aaron.portal-generator): rewrite portal.stack and docs/design/portal.md so the portal is the book's own generator's output (as tools/portal-prototype.ts and the starter kit do) and Fumadocs is set aside; keep the rest of the portal design.
Edit only what you own. If books, payroll, parties, contacts or documents must change for your design, put it in forOtherLane instead.`,
  },
]

return await pipeline(
  LANES,
  (l) => agent(`${COMMON}\n\nYou own ONLY: ${l.own}. The other lane works in parallel on other folders.\n\n${l.task}`, { label: `design:${l.key}`, phase: 'Design', schema: OUT }),
  (made, l) => agent(`${COMMON}\n\nYou are the ADVERSARIAL REVIEWER of the ${l.key} lane (it owns ${l.own}). Its report: ${JSON.stringify(made)}\nTry to refute it: is the Frappe mapping true to the real doctypes (check them), does every money path still settle exactly once with the right authority and tenancy, is every frozen operation's behaviour kept (check-frozen), is each ruling applied as Aaron said it, are the answers to Aaron correct and plain, and is anything left for the build to freestyle? Fix what you refute in the lane's files only, keep 0 problems and 0 breaches, and report.`, { label: `review:${l.key}`, phase: 'Review', schema: REV }).then((r) => ({ made, review: r })),
)