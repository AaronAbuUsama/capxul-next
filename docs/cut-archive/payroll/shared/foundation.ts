// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/foundation.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import {
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineSystem,
  type Concept,
} from "../../../packages/book/src/index.ts";
import type { FrozenId } from "../../frozen/index.ts";
import type { CUT } from "./cut.ts";

export const concept_payroll = defineConcept({
  id: "payroll",
  title: "Payroll",
  about:
    "Frappe HR's payroll beside the v4 Agreements (payroll.scope, aaron.frappe-shape): Employees, Salary Components, " +
    "Salary Structures and their Assignments, Payroll Entries (runs) and Salary Slips, worked out by Capxul without a " +
    "head and synced with a Frappe HR head once one is connected; and the HR that changes pay or moves money " +
    "(payroll.hr-in-payroll): holidays, leave, shifts, check-ins and attendance, which feed a slip's payment days, and " +
    "expense claims and advances, paid from a department's budget through `payments.prepare-command`. A submitted run " +
    "Capxul computed posts its accrual " +
    "through books' `books.record-payroll-accrual`, and is paid as one payment command through " +
    "`payments.prepare-command` (purpose payroll), its slips following `payment_transitioned` to settled; neither payments " +
    "nor books depends on payroll. Pay agreements: salaries, streams and retainers offered from a budget, accepted by " +
    "the payee, changed, paused, resumed, ended or withdrawn, and collected by the payee from the budget's reservation. " +
    "Each agreement is one durable process that follows its chain events, and a collection becomes a Payment in " +
    "payments, from the indexed PaymentSent. Old payroll's runs land here as Payroll Entries and Salary Slips; its saved " +
    "groups and terms stay dropped, its departments go to budgets and its notices to notices.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_organizations, concept_board, concept_budgets,
    concept_books, concept_documents, concept_payments,
  ],
  was: [`${OLD}/payroll/README.md:3`],
});

const o = {
  access: concept_access,
  accounts: concept_accounts,
  activity: concept_activity,
  agents: concept_agents,
  applications: concept_applications,
  banking: concept_banking,
  board: concept_board,
  books: concept_books,
  budgets: concept_budgets,
  contacts: concept_contacts,
  devnet: concept_devnet,
  documents: concept_documents,
  equity: concept_equity,
  notices: concept_notices,
  organizations: concept_organizations,
  payments: concept_payments,
  payroll: concept_payroll,
  requests: concept_requests,
} as const;

export const OPERATION_OWNERS: { readonly [Id in Exclude<FrozenId, keyof typeof CUT>]: Concept } = {
  // area accounts (36)
  "account.retry": o.accounts,
  "account.show": o.accounts,
  "agent.create": o.agents,
  "agent.freeze": o.agents,
  "agent.key.rotate": o.agents,
  "agent.list": o.agents,
  "agent.remove": o.agents,
  "agent.show": o.agents,
  "agent.sweep": o.agents,
  "agent.unfreeze": o.agents,
  "auth.list": o.access,
  "auth.login": o.accounts, // reports the account's setup
  "auth.logout": o.access,
  "auth.switch": o.access,
  "auth.verify": o.accounts,
  "config.telemetry.off": o.access,
  "config.telemetry.on": o.access,
  "config.telemetry.status": o.access,
  doctor: o.applications, // exception: the deployment's health and the app key
  "key.create": o.applications, // exception: publishable keys
  "key.list": o.applications,
  "key.revoke": o.applications,
  "key.rotate": o.applications,
  "referral.invite": o.accounts,
  "referral.list": o.accounts,
  "referral.show": o.accounts,
  schema: o.access,
  "use.env": o.access,
  "use.org": o.organizations, // exception: checks the membership
  "use.personal": o.access,
  "verify.start": o.banking, // exception: Bridge verification
  "verify.status": o.banking,
  "waitlist.invites.grant": o.accounts,
  "waitlist.join": o.accounts,
  "waitlist.status": o.accounts,
  whoami: o.access,
  // area activity (5)
  "activity.annotate": o.books, // exception: an annotation is a book fact
  "activity.events": o.activity,
  "activity.get": o.activity,
  "activity.list": o.activity,
  "activity.summary": o.activity,
  // area banking (8)
  "bank.accounts": o.banking,
  "bank.accounts.add": o.banking,
  "bank.accounts.remove": o.banking,
  "bank.deposits": o.banking,
  "bank.details": o.banking,
  "bank.match": o.requests, // exception: marks the request paid
  "bank.pay": o.banking,
  "bank.settle": o.banking,
  // area books (16)
  "org.books.accounts.add": o.books,
  "org.books.accounts.archive": o.books,
  "org.books.accounts.import": o.books,
  "org.books.accounts.list": o.books,
  "org.books.accounts.reclassify": o.books,
  "org.books.accounts.rename": o.books,
  "org.books.accounts.review": o.books,
  "org.books.assets.add": o.books,
  "org.books.assets.list": o.books,
  "org.books.assets.remove": o.books,
  "org.books.export.quickbooks": o.books,
  "org.books.facts.list": o.books,
  "org.books.reports.balance-sheet": o.books,
  "org.books.reports.profit-and-loss": o.books,
  "org.books.reports.reconcile": o.books,
  "org.books.reports.trial-balance": o.books,
  // area departments (12): departments are budgets
  "org.department.budget.set": o.budgets,
  "org.department.ceiling.freeze": o.budgets,
  "org.department.ceiling.set": o.budgets,
  "org.department.ceiling.unfreeze": o.budgets,
  "org.department.close": o.budgets,
  "org.department.create": o.budgets,
  "org.department.holder.add": o.budgets,
  "org.department.holder.remove": o.budgets,
  "org.department.list": o.budgets,
  "org.department.pay": o.payments, // exception: a budget spend is a Payment
  "org.department.reopen": o.budgets,
  "org.department.show": o.budgets,
  // area devnet (15)
  "dev.approve": o.devnet,
  "dev.fund": o.accounts, // exception: the faucet works on staging too
  "dev.gates.set": o.devnet,
  "dev.jobs.run": o.devnet,
  "dev.key": o.applications, // exception: quickstart test keys work on staging too
  "dev.mail.fail": o.devnet,
  "dev.mail.list": o.devnet,
  "dev.mail.notices": o.devnet, // devnet-only: it reads notices' delivery records
  "dev.prices.set": o.devnet,
  "dev.snapshot.list": o.devnet,
  "dev.snapshot.restore": o.devnet,
  "dev.snapshot.save": o.devnet,
  "dev.time": o.devnet,
  "dev.time.start-at": o.devnet,
  "dev.time.warp": o.devnet,
  // area equity (30), low priority
  invest: o.equity,
  "invest.commit": o.equity,
  "invest.pay": o.equity,
  "invest.show": o.equity,
  "invest.sign": o.equity,
  "org.cap-table": o.equity,
  "org.equity.issue": o.equity,
  "org.equity.setup": o.equity,
  "org.equity.transfer.approve": o.equity,
  "org.exit.pay": o.equity,
  "org.exit.preview": o.equity,
  "org.options.end": o.equity,
  "org.options.grant": o.equity,
  "org.options.show": o.equity,
  "org.round.allocate": o.equity,
  "org.round.cancel": o.equity,
  "org.round.close": o.equity,
  "org.round.create": o.equity,
  "org.round.invite": o.equity,
  "org.round.preview": o.equity,
  "org.round.show": o.equity,
  "org.safe.close": o.equity,
  "org.safe.create": o.equity,
  "org.safe.invite": o.equity,
  "org.safe.show": o.equity,
  shares: o.equity,
  "shares.accept": o.equity,
  "shares.convert": o.equity,
  "shares.exercise": o.equity,
  "shares.sell": o.equity,
  // area governance (43)
  "invite.accept": o.banking, // exception: routes an inv_kyb_ id to banking, the rest to organizations
  "invite.decline": o.organizations,
  "invite.list": o.organizations,
  "org.allowance.assign": o.budgets, // allowances are budgets
  "org.allowance.change": o.budgets,
  "org.allowance.create": o.budgets,
  "org.allowance.get": o.budgets,
  "org.allowance.list": o.budgets,
  "org.allowance.replace": o.budgets,
  "org.allowance.revoke": o.budgets,
  "org.board.claim": o.board,
  "org.board.director.add": o.board,
  "org.board.director.remove": o.board,
  "org.board.handover": o.board,
  "org.board.refresh": o.board,
  "org.board.show": o.board,
  "org.board.threshold": o.board,
  "org.director.add": o.board, // low priority
  "org.director.list": o.board,
  "org.director.remove": o.board,
  "org.director.replace": o.board,
  "org.director.threshold": o.board,
  "org.invite.cancel": o.organizations,
  "org.invite.list": o.organizations,
  "org.invite.resend": o.organizations,
  "org.member.get": o.organizations,
  "org.member.grant": o.board, // an officer hat, by Board proposal
  "org.member.invite": o.budgets, // exception: the invitation, then one proposal of its grants, allowances included
  "org.member.list": o.organizations,
  "org.member.revoke": o.board,
  "org.proposal.approve": o.board,
  "org.proposal.get": o.board,
  "org.proposal.list": o.board,
  "org.proposal.reject": o.board,
  "org.proposal.wait": o.board,
  "org.vote.create": o.equity, // shareholder votes, low priority
  "org.vote.execute": o.equity,
  "org.vote.list": o.equity,
  "org.vote.show": o.equity,
  "org.vote.wait": o.equity,
  "vote.cast": o.equity,
  "vote.delegate": o.equity,
  "vote.list": o.equity,
  // area organizations (6)
  "org.create": o.organizations,
  "org.list": o.organizations,
  "org.me": o.organizations,
  "org.retry": o.organizations,
  "org.show": o.organizations,
  "org.wait": o.organizations,
  // area payments (33)
  address: o.activity, // exception: a read of whoever you act as
  balance: o.activity,
  "contact.add": o.contacts,
  "contact.bank.add": o.banking, // exception: a bank account on a contact
  "contact.get": o.banking, // exception: it returns the contact's bank accounts
  "contact.hide": o.contacts,
  "contact.label": o.contacts,
  "contact.list": o.contacts,
  "contact.unhide": o.contacts,
  "document.export": o.documents,
  "document.get": o.documents,
  "document.render": o.documents,
  "document.verify": o.documents,
  "inbox.decline": o.requests,
  "inbox.get": o.requests,
  "inbox.list": o.requests,
  "inbox.pay": o.requests,
  "payment.cancel": o.payments,
  "payment.get": o.payments,
  "payment.list": o.payments,
  "payment.reschedule": o.payments,
  "payment.retry": o.payments,
  "payment.send": o.payments,
  "payment.wait": o.payments,
  "request.cancel": o.requests,
  "request.get": o.requests,
  "request.issue": o.requests,
  "request.list": o.requests,
  "service.create": o.requests,
  "service.deactivate": o.requests,
  "service.get": o.requests,
  "service.list": o.requests,
  "service.revise": o.requests,
  // area payroll (11)
  "agreement.accept": o.payments,
  "agreement.collect": o.payments,
  "agreement.list": o.payments,
  "agreement.show": o.payments,
  "org.agreement.change": o.payments,
  "org.agreement.end": o.payments,
  "org.agreement.list": o.payments,
  "org.agreement.offer": o.payments,
  "org.agreement.pause": o.payments,
  "org.agreement.resume": o.payments,
  "org.agreement.withdraw": o.payments,
};
