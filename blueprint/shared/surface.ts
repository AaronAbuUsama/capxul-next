// The command surface's records: the one tree of logical groups every command sits in, and the decisions behind it
// (Aaron, 9 November 2026: "The number was not the issue. We need everything you can do on Frappe to be programmatic
// and accessible from our tooling. It's the logical groupings."). One writer: the surface designer. Explained in
// docs/design/command-surface.md; the grammar it follows is docs/design/new-commands.md section 2.
//
// SURFACE_GROUPS and SURFACE are plain data, not records: every operation's command as it stood when the surface was
// designed (`now`) and as the tree spells it (`next`), with its group. The owning concepts apply the moves, book first
// (each frozen command renamed carries a decision naming the old one, which packages/blueprint-engine/scripts/check-frozen.ts checks; a new
// operation's id becomes its new words, rules.new-operations). packages/blueprint-engine/scripts/report-surface.ts prints the tree from these rows
// and the book, and reports every row the book does not yet spell as `next`.
//
// Shared records link only to shared records, except the eleven frozen agreement operations, whose ids never change:
// surface.payroll-group is the decision on them that names each old command.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";
import * as x from "./external.ts";
import * as payroll from "../payments/agreements/operations.ts";

const BY = "Claude, surface design, 9 November 2026";
const ON = "on Aaron's answer to question 48 (ninth batch, 9 November 2026)";
const by = (evidence: string) => `${BY}, ${ON}; evidence: ${evidence}`;

// ── the tree ────────────────────────────────────────────────────────────────────────────────

/** The thirteen logical groups, in the order `capxul --help` and the reference print them. */
export const SURFACE_GROUPS = [
  { id: "identity", title: "Who you are and sign-in", kind: "capxul", yours: "auth, whoami, use, config, account, referral, waitlist, verify", org: "" },
  { id: "builders", title: "The CLI and the apps you build", kind: "capxul", yours: "schema, doctor, key", org: "" },
  { id: "money", title: "Your money", kind: "capxul", yours: "balance, address, payment, bank, request, inbox, service, document, activity", org: "" },
  { id: "organization", title: "The Organization, its people and its departments", kind: "capxul", yours: "invite", org: "org (create, list, show, me, wait, retry), member, invite, seats, department, allowance" },
  { id: "governance", title: "Governance and equity", kind: "capxul", yours: "vote, invest, shares", org: "board, director, proposal, vote, equity, round, safe, options, exit, cap-table" },
  { id: "agents", title: "Agents and the FDE", kind: "capxul", yours: "agent", org: "fde" },
  { id: "books", title: "Books (ERPNext's Accounting)", kind: "frappe", yours: "", org: "books" },
  { id: "hr", title: "HR (Frappe HR's HR module)", kind: "frappe", yours: "hr", org: "hr" },
  { id: "payroll", title: "Payroll (Frappe HR's Payroll module, and pay agreements)", kind: "frappe", yours: "payroll", org: "payroll" },
  { id: "crm", title: "CRM (Frappe CRM), and the contact book", kind: "frappe", yours: "contact", org: "crm" },
  { id: "projects", title: "Projects (ERPNext's Projects)", kind: "frappe", yours: "", org: "projects" },
  { id: "head", title: "The Frappe site (the head): apps, DocTypes, documents", kind: "frappe", yours: "", org: "head" },
  { id: "devnet", title: "The devnet", kind: "capxul", yours: "dev", org: "" },
] as const;

export type SurfaceGroup = (typeof SURFACE_GROUPS)[number]["id"];

/**
 * Every operation of the book, once: its id and command when the surface was designed (`id`, `now`), its command in
 * the tree (`next`) and its group. A new operation's id becomes `next`'s words joined by dots; a frozen one keeps its id.
 */
export const SURFACE: readonly { id: string; now: string; next: string; group: SurfaceGroup }[] = [
  // identity
  { id: "account.retry", now: "account retry", next: "account retry", group: "identity" },
  { id: "account.show", now: "account show", next: "account show", group: "identity" },
  { id: "auth.list", now: "auth list", next: "auth list", group: "identity" },
  { id: "auth.login", now: "auth login", next: "auth login", group: "identity" },
  { id: "auth.logout", now: "auth logout", next: "auth logout", group: "identity" },
  { id: "auth.switch", now: "auth switch", next: "auth switch", group: "identity" },
  { id: "auth.verify", now: "auth verify", next: "auth verify", group: "identity" },
  { id: "config.telemetry.off", now: "config telemetry off", next: "config telemetry off", group: "identity" },
  { id: "config.telemetry.on", now: "config telemetry on", next: "config telemetry on", group: "identity" },
  { id: "config.telemetry.status", now: "config telemetry status", next: "config telemetry status", group: "identity" },
  { id: "referral.show", now: "referral", next: "referral", group: "identity" },
  { id: "referral.invite", now: "referral invite", next: "referral invite", group: "identity" },
  { id: "referral.list", now: "referral list", next: "referral list", group: "identity" },
  { id: "use.env", now: "use env", next: "use env", group: "identity" },
  { id: "use.org", now: "use org", next: "use org", group: "identity" },
  { id: "use.personal", now: "use personal", next: "use personal", group: "identity" },
  { id: "verify.start", now: "verify start", next: "verify start", group: "identity" },
  { id: "verify.status", now: "verify status", next: "verify status", group: "identity" },
  { id: "waitlist.invites.grant", now: "waitlist invites grant", next: "waitlist invites grant", group: "identity" },
  { id: "waitlist.join", now: "waitlist join", next: "waitlist join", group: "identity" },
  { id: "waitlist.status", now: "waitlist status", next: "waitlist status", group: "identity" },
  { id: "whoami", now: "whoami", next: "whoami", group: "identity" },
  // builders
  { id: "doctor", now: "doctor", next: "doctor", group: "builders" },
  { id: "key.create", now: "key create", next: "key create", group: "builders" },
  { id: "key.list", now: "key list", next: "key list", group: "builders" },
  { id: "key.revoke", now: "key revoke", next: "key revoke", group: "builders" },
  { id: "key.rotate", now: "key rotate", next: "key rotate", group: "builders" },
  { id: "schema", now: "schema", next: "schema", group: "builders" },
  // money
  { id: "activity.annotate", now: "activity annotate", next: "activity annotate", group: "money" },
  { id: "activity.events", now: "activity events", next: "activity events", group: "money" },
  { id: "activity.get", now: "activity get", next: "activity get", group: "money" },
  { id: "activity.list", now: "activity list", next: "activity list", group: "money" },
  { id: "activity.summary", now: "activity summary", next: "activity summary", group: "money" },
  { id: "address", now: "address", next: "address", group: "money" },
  { id: "balance", now: "balance", next: "balance", group: "money" },
  { id: "bank.accounts", now: "bank accounts", next: "bank accounts", group: "money" },
  { id: "bank.accounts.add", now: "bank accounts add", next: "bank accounts add", group: "money" },
  { id: "bank.accounts.remove", now: "bank accounts remove", next: "bank accounts remove", group: "money" },
  { id: "bank.deposits", now: "bank deposits", next: "bank deposits", group: "money" },
  { id: "bank.details", now: "bank details", next: "bank details", group: "money" },
  { id: "bank.match", now: "bank match", next: "bank match", group: "money" },
  { id: "bank.pay", now: "bank pay", next: "bank pay", group: "money" },
  { id: "bank.settle", now: "bank settle", next: "bank settle", group: "money" },
  { id: "document.export", now: "document export", next: "document export", group: "money" },
  { id: "document.get", now: "document get", next: "document get", group: "money" },
  { id: "document.render", now: "document render", next: "document render", group: "money" },
  { id: "document.verify", now: "document verify", next: "document verify", group: "money" },
  { id: "inbox.decline", now: "inbox decline", next: "inbox decline", group: "money" },
  { id: "inbox.get", now: "inbox get", next: "inbox get", group: "money" },
  { id: "inbox.list", now: "inbox list", next: "inbox list", group: "money" },
  { id: "inbox.pay", now: "inbox pay", next: "inbox pay", group: "money" },
  { id: "payment.cancel", now: "payment cancel", next: "payment cancel", group: "money" },
  { id: "payment.claim", now: "payment claim", next: "payment claim", group: "money" },
  { id: "payment.get", now: "payment get", next: "payment get", group: "money" },
  { id: "payment.list", now: "payment list", next: "payment list", group: "money" },
  { id: "payment.reschedule", now: "payment reschedule", next: "payment reschedule", group: "money" },
  { id: "payment.retry", now: "payment retry", next: "payment retry", group: "money" },
  { id: "payment.send", now: "payment send", next: "payment send", group: "money" },
  { id: "payment.wait", now: "payment wait", next: "payment wait", group: "money" },
  { id: "request.cancel", now: "request cancel", next: "request cancel", group: "money" },
  { id: "request.get", now: "request get", next: "request get", group: "money" },
  { id: "request.issue", now: "request issue", next: "request issue", group: "money" },
  { id: "request.list", now: "request list", next: "request list", group: "money" },
  { id: "service.create", now: "service create", next: "service create", group: "money" },
  { id: "service.deactivate", now: "service deactivate", next: "service deactivate", group: "money" },
  { id: "service.get", now: "service get", next: "service get", group: "money" },
  { id: "service.list", now: "service list", next: "service list", group: "money" },
  { id: "service.revise", now: "service revise", next: "service revise", group: "money" },
  // organization
  { id: "invite.accept", now: "invite accept", next: "invite accept", group: "organization" },
  { id: "invite.decline", now: "invite decline", next: "invite decline", group: "organization" },
  { id: "invite.list", now: "invite list", next: "invite list", group: "organization" },
  { id: "org.allowance.assign", now: "org allowance assign", next: "org allowance assign", group: "organization" },
  { id: "org.allowance.change", now: "org allowance change", next: "org allowance change", group: "organization" },
  { id: "org.allowance.create", now: "org allowance create", next: "org allowance create", group: "organization" },
  { id: "org.allowance.get", now: "org allowance get", next: "org allowance get", group: "organization" },
  { id: "org.allowance.list", now: "org allowance list", next: "org allowance list", group: "organization" },
  { id: "org.allowance.replace", now: "org allowance replace", next: "org allowance replace", group: "organization" },
  { id: "org.allowance.revoke", now: "org allowance revoke", next: "org allowance revoke", group: "organization" },
  { id: "org.create", now: "org create", next: "org create", group: "organization" },
  { id: "org.department.budget.set", now: "org department budget set", next: "org department budget set", group: "organization" },
  { id: "org.department.ceiling.freeze", now: "org department ceiling freeze", next: "org department ceiling freeze", group: "organization" },
  { id: "org.department.ceiling.set", now: "org department ceiling set", next: "org department ceiling set", group: "organization" },
  { id: "org.department.ceiling.unfreeze", now: "org department ceiling unfreeze", next: "org department ceiling unfreeze", group: "organization" },
  { id: "org.department.close", now: "org department close", next: "org department close", group: "organization" },
  { id: "org.department.create", now: "org department create", next: "org department create", group: "organization" },
  { id: "org.department.holder.add", now: "org department holder add", next: "org department holder add", group: "organization" },
  { id: "org.department.holder.remove", now: "org department holder remove", next: "org department holder remove", group: "organization" },
  { id: "org.department.list", now: "org department list", next: "org department list", group: "organization" },
  { id: "org.department.pay", now: "org department pay", next: "org department pay", group: "organization" },
  { id: "org.department.reopen", now: "org department reopen", next: "org department reopen", group: "organization" },
  { id: "org.department.show", now: "org department show", next: "org department show", group: "organization" },
  { id: "org.invite.cancel", now: "org invite cancel", next: "org invite cancel", group: "organization" },
  { id: "org.invite.list", now: "org invite list", next: "org invite list", group: "organization" },
  { id: "org.invite.resend", now: "org invite resend", next: "org invite resend", group: "organization" },
  { id: "org.list", now: "org list", next: "org list", group: "organization" },
  { id: "org.me", now: "org me", next: "org me", group: "organization" },
  { id: "org.member.get", now: "org member get", next: "org member get", group: "organization" },
  { id: "org.member.grant", now: "org member grant", next: "org member grant", group: "organization" },
  { id: "org.member.invite", now: "org member invite", next: "org member invite", group: "organization" },
  { id: "org.member.list", now: "org member list", next: "org member list", group: "organization" },
  { id: "org.member.revoke", now: "org member revoke", next: "org member revoke", group: "organization" },
  { id: "org.retry", now: "org retry", next: "org retry", group: "organization" },
  { id: "org.seats.buy", now: "org seats buy", next: "org seats buy", group: "organization" },
  { id: "org.seats.show", now: "org seats show", next: "org seats show", group: "organization" },
  { id: "org.show", now: "org show", next: "org show", group: "organization" },
  { id: "org.wait", now: "org wait", next: "org wait", group: "organization" },
  // governance
  { id: "invest", now: "invest", next: "invest", group: "governance" },
  { id: "invest.commit", now: "invest commit", next: "invest commit", group: "governance" },
  { id: "invest.pay", now: "invest pay", next: "invest pay", group: "governance" },
  { id: "invest.show", now: "invest show", next: "invest show", group: "governance" },
  { id: "invest.sign", now: "invest sign", next: "invest sign", group: "governance" },
  { id: "org.board.claim", now: "org board claim", next: "org board claim", group: "governance" },
  { id: "org.board.director.add", now: "org board director add", next: "org board director add", group: "governance" },
  { id: "org.board.director.remove", now: "org board director remove", next: "org board director remove", group: "governance" },
  { id: "org.board.handover", now: "org board handover", next: "org board handover", group: "governance" },
  { id: "org.board.refresh", now: "org board refresh", next: "org board refresh", group: "governance" },
  { id: "org.board.show", now: "org board show", next: "org board show", group: "governance" },
  { id: "org.board.threshold", now: "org board threshold", next: "org board threshold", group: "governance" },
  { id: "org.cap-table", now: "org cap-table", next: "org cap-table", group: "governance" },
  { id: "org.director.add", now: "org director add", next: "org director add", group: "governance" },
  { id: "org.director.list", now: "org director list", next: "org director list", group: "governance" },
  { id: "org.director.remove", now: "org director remove", next: "org director remove", group: "governance" },
  { id: "org.director.replace", now: "org director replace", next: "org director replace", group: "governance" },
  { id: "org.director.threshold", now: "org director threshold", next: "org director threshold", group: "governance" },
  { id: "org.equity.issue", now: "org equity issue", next: "org equity issue", group: "governance" },
  { id: "org.equity.setup", now: "org equity setup", next: "org equity setup", group: "governance" },
  { id: "org.equity.transfer.approve", now: "org equity transfer approve", next: "org equity transfer approve", group: "governance" },
  { id: "org.exit.pay", now: "org exit pay", next: "org exit pay", group: "governance" },
  { id: "org.exit.preview", now: "org exit preview", next: "org exit preview", group: "governance" },
  { id: "org.options.end", now: "org options end", next: "org options end", group: "governance" },
  { id: "org.options.grant", now: "org options grant", next: "org options grant", group: "governance" },
  { id: "org.options.show", now: "org options show", next: "org options show", group: "governance" },
  { id: "org.proposal.approve", now: "org proposal approve", next: "org proposal approve", group: "governance" },
  { id: "org.proposal.get", now: "org proposal get", next: "org proposal get", group: "governance" },
  { id: "org.proposal.list", now: "org proposal list", next: "org proposal list", group: "governance" },
  { id: "org.proposal.reject", now: "org proposal reject", next: "org proposal reject", group: "governance" },
  { id: "org.proposal.wait", now: "org proposal wait", next: "org proposal wait", group: "governance" },
  { id: "org.round.allocate", now: "org round allocate", next: "org round allocate", group: "governance" },
  { id: "org.round.cancel", now: "org round cancel", next: "org round cancel", group: "governance" },
  { id: "org.round.close", now: "org round close", next: "org round close", group: "governance" },
  { id: "org.round.create", now: "org round create", next: "org round create", group: "governance" },
  { id: "org.round.invite", now: "org round invite", next: "org round invite", group: "governance" },
  { id: "org.round.preview", now: "org round preview", next: "org round preview", group: "governance" },
  { id: "org.round.show", now: "org round show", next: "org round show", group: "governance" },
  { id: "org.safe.close", now: "org safe close", next: "org safe close", group: "governance" },
  { id: "org.safe.create", now: "org safe create", next: "org safe create", group: "governance" },
  { id: "org.safe.invite", now: "org safe invite", next: "org safe invite", group: "governance" },
  { id: "org.safe.show", now: "org safe show", next: "org safe show", group: "governance" },
  { id: "org.vote.create", now: "org vote create", next: "org vote create", group: "governance" },
  { id: "org.vote.execute", now: "org vote execute", next: "org vote execute", group: "governance" },
  { id: "org.vote.list", now: "org vote list", next: "org vote list", group: "governance" },
  { id: "org.vote.show", now: "org vote show", next: "org vote show", group: "governance" },
  { id: "org.vote.wait", now: "org vote wait", next: "org vote wait", group: "governance" },
  { id: "shares", now: "shares", next: "shares", group: "governance" },
  { id: "shares.accept", now: "shares accept", next: "shares accept", group: "governance" },
  { id: "shares.convert", now: "shares convert", next: "shares convert", group: "governance" },
  { id: "shares.exercise", now: "shares exercise", next: "shares exercise", group: "governance" },
  { id: "shares.sell", now: "shares sell", next: "shares sell", group: "governance" },
  { id: "vote.cast", now: "vote cast", next: "vote cast", group: "governance" },
  { id: "vote.delegate", now: "vote delegate", next: "vote delegate", group: "governance" },
  { id: "vote.list", now: "vote list", next: "vote list", group: "governance" },
  // agents
  { id: "agent.create", now: "agent create", next: "agent create", group: "agents" },
  { id: "agent.freeze", now: "agent freeze", next: "agent freeze", group: "agents" },
  { id: "agent.key.rotate", now: "agent key rotate", next: "agent key rotate", group: "agents" },
  { id: "agent.list", now: "agent list", next: "agent list", group: "agents" },
  { id: "agent.remove", now: "agent remove", next: "agent remove", group: "agents" },
  { id: "agent.show", now: "agent show", next: "agent show", group: "agents" },
  { id: "agent.sweep", now: "agent sweep", next: "agent sweep", group: "agents" },
  { id: "agent.unfreeze", now: "agent unfreeze", next: "agent unfreeze", group: "agents" },
  { id: "org.fde.ask", now: "org fde ask", next: "org fde ask", group: "agents" },
  { id: "org.fde.guest.add", now: "org fde guest add", next: "org fde guest add", group: "agents" },
  { id: "org.fde.guest.list", now: "org fde guest list", next: "org fde guest list", group: "agents" },
  { id: "org.fde.guest.remove", now: "org fde guest remove", next: "org fde guest remove", group: "agents" },
  { id: "org.fde.pay", now: "org fde pay", next: "org fde pay", group: "agents" },
  { id: "org.fde.show", now: "org fde show", next: "org fde show", group: "agents" },
  { id: "org.fde.turn.get", now: "org fde turn get", next: "org fde turn get", group: "agents" },
  // books
  { id: "org.books.accounts.add", now: "org books accounts add", next: "org books accounts add", group: "books" },
  { id: "org.books.accounts.archive", now: "org books accounts archive", next: "org books accounts archive", group: "books" },
  { id: "org.books.accounts.import", now: "org books accounts import", next: "org books accounts import", group: "books" },
  { id: "org.books.accounts.list", now: "org books accounts list", next: "org books accounts list", group: "books" },
  { id: "org.books.accounts.reclassify", now: "org books accounts reclassify", next: "org books accounts reclassify", group: "books" },
  { id: "org.books.accounts.rename", now: "org books accounts rename", next: "org books accounts rename", group: "books" },
  { id: "org.books.accounts.review", now: "org books accounts review", next: "org books accounts review", group: "books" },
  { id: "org.books.assets.add", now: "org books assets add", next: "org books assets add", group: "books" },
  { id: "org.books.assets.list", now: "org books assets list", next: "org books assets list", group: "books" },
  { id: "org.books.assets.remove", now: "org books assets remove", next: "org books assets remove", group: "books" },
  { id: "org.books.export.quickbooks", now: "org books export quickbooks", next: "org books export quickbooks", group: "books" },
  { id: "org.books.facts.list", now: "org books facts list", next: "org books facts list", group: "books" },
  { id: "org.books.reports.balance-sheet", now: "org books reports balance-sheet", next: "org books reports balance-sheet", group: "books" },
  { id: "org.books.reports.profit-and-loss", now: "org books reports profit-and-loss", next: "org books reports profit-and-loss", group: "books" },
  { id: "org.books.reports.reconcile", now: "org books reports reconcile", next: "org books reports reconcile", group: "books" },
  { id: "org.books.reports.trial-balance", now: "org books reports trial-balance", next: "org books reports trial-balance", group: "books" },
  // hr
  { id: "advance.cancel", now: "advance cancel", next: "hr advance cancel", group: "hr" },
  { id: "advance.list", now: "advance list", next: "hr advance list", group: "hr" },
  { id: "advance.request", now: "advance request", next: "hr advance request", group: "hr" },
  { id: "attendance.checkin", now: "attendance checkin", next: "hr attendance checkin", group: "hr" },
  { id: "attendance.list", now: "attendance list", next: "hr attendance list", group: "hr" },
  { id: "expense-claim.cancel", now: "expense-claim cancel", next: "hr expense-claim cancel", group: "hr" },
  { id: "expense-claim.create", now: "expense-claim create", next: "hr expense-claim create", group: "hr" },
  { id: "expense-claim.get", now: "expense-claim get", next: "hr expense-claim get", group: "hr" },
  { id: "expense-claim.list", now: "expense-claim list", next: "hr expense-claim list", group: "hr" },
  { id: "leave.apply", now: "leave apply", next: "hr leave apply", group: "hr" },
  { id: "leave.balance", now: "leave balance", next: "hr leave balance", group: "hr" },
  { id: "leave.cancel", now: "leave cancel", next: "hr leave cancel", group: "hr" },
  { id: "leave.list", now: "leave list", next: "hr leave list", group: "hr" },
  { id: "org.advance.get", now: "org advance get", next: "org hr advance get", group: "hr" },
  { id: "org.advance.list", now: "org advance list", next: "org hr advance list", group: "hr" },
  { id: "org.advance.pay", now: "org advance pay", next: "org hr advance pay", group: "hr" },
  { id: "org.advance.reject", now: "org advance reject", next: "org hr advance reject", group: "hr" },
  { id: "org.advance.settle", now: "org advance settle", next: "org hr advance settle", group: "hr" },
  { id: "org.attendance.cancel", now: "org attendance cancel", next: "org hr attendance cancel", group: "hr" },
  { id: "org.attendance.list", now: "org attendance list", next: "org hr attendance list", group: "hr" },
  { id: "org.attendance.mark", now: "org attendance mark", next: "org hr attendance mark", group: "hr" },
  { id: "org.employee.add", now: "org employee add", next: "org hr employee add", group: "hr" },
  { id: "org.employee.change", now: "org employee change", next: "org hr employee change", group: "hr" },
  { id: "org.employee.deactivate", now: "org employee deactivate", next: "org hr employee deactivate", group: "hr" },
  { id: "org.employee.get", now: "org employee get", next: "org hr employee get", group: "hr" },
  { id: "org.employee.leave", now: "org employee leave", next: "org hr employee leave", group: "hr" },
  { id: "org.employee.list", now: "org employee list", next: "org hr employee list", group: "hr" },
  { id: "org.employee.reinstate", now: "org employee reinstate", next: "org hr employee reinstate", group: "hr" },
  { id: "org.employee.suspend", now: "org employee suspend", next: "org hr employee suspend", group: "hr" },
  { id: "org.expense-claim.approve", now: "org expense-claim approve", next: "org hr expense-claim approve", group: "hr" },
  { id: "org.expense-claim.cancel", now: "org expense-claim cancel", next: "org hr expense-claim cancel", group: "hr" },
  { id: "org.expense-claim.get", now: "org expense-claim get", next: "org hr expense-claim get", group: "hr" },
  { id: "org.expense-claim.list", now: "org expense-claim list", next: "org hr expense-claim list", group: "hr" },
  { id: "org.expense-claim.pay", now: "org expense-claim pay", next: "org hr expense-claim pay", group: "hr" },
  { id: "org.expense-claim.reject", now: "org expense-claim reject", next: "org hr expense-claim reject", group: "hr" },
  { id: "org.expense-type.add", now: "org expense-type add", next: "org hr expense-type add", group: "hr" },
  { id: "org.expense-type.list", now: "org expense-type list", next: "org hr expense-type list", group: "hr" },
  { id: "org.holiday.add", now: "org holiday add", next: "org hr holiday add", group: "hr" },
  { id: "org.holiday.list", now: "org holiday list", next: "org hr holiday list", group: "hr" },
  { id: "org.holiday.remove", now: "org holiday remove", next: "org hr holiday remove", group: "hr" },
  { id: "org.leave.allocate", now: "org leave allocate", next: "org hr leave allocate", group: "hr" },
  { id: "org.leave.approve", now: "org leave approve", next: "org hr leave approve", group: "hr" },
  { id: "org.leave.balance", now: "org leave balance", next: "org hr leave balance", group: "hr" },
  { id: "org.leave.list", now: "org leave list", next: "org hr leave list", group: "hr" },
  { id: "org.leave.reject", now: "org leave reject", next: "org hr leave reject", group: "hr" },
  { id: "org.leave.unallocate", now: "org leave unallocate", next: "org hr leave unallocate", group: "hr" },
  { id: "org.leave-type.add", now: "org leave-type add", next: "org hr leave-type add", group: "hr" },
  { id: "org.leave-type.change", now: "org leave-type change", next: "org hr leave-type change", group: "hr" },
  { id: "org.leave-type.list", now: "org leave-type list", next: "org hr leave-type list", group: "hr" },
  { id: "org.shift-type.add", now: "org shift-type add", next: "org hr shift-type add", group: "hr" },
  { id: "org.shift-type.assign", now: "org shift-type assign", next: "org hr shift-type assign", group: "hr" },
  { id: "org.shift-type.list", now: "org shift-type list", next: "org hr shift-type list", group: "hr" },
  { id: "org.shift-type.unassign", now: "org shift-type unassign", next: "org hr shift-type unassign", group: "hr" },
  // Person-side reads of the employer's rules (payroll.hr-self-rules), booked after the tree was designed.
  { id: "hr.expense-type.list", now: "hr expense-type list", next: "hr expense-type list", group: "hr" },
  { id: "hr.holiday.list", now: "hr holiday list", next: "hr holiday list", group: "hr" },
  { id: "hr.leave-type.list", now: "hr leave-type list", next: "hr leave-type list", group: "hr" },
  // payroll
  { id: "org.agreement.change", now: "org agreement change", next: "org payroll agreement change", group: "payroll" },
  { id: "org.agreement.end", now: "org agreement end", next: "org payroll agreement end", group: "payroll" },
  { id: "org.agreement.list", now: "org agreement list", next: "org payroll agreement list", group: "payroll" },
  { id: "org.agreement.offer", now: "org agreement offer", next: "org payroll agreement offer", group: "payroll" },
  { id: "org.agreement.pause", now: "org agreement pause", next: "org payroll agreement pause", group: "payroll" },
  { id: "org.agreement.resume", now: "org agreement resume", next: "org payroll agreement resume", group: "payroll" },
  { id: "org.agreement.withdraw", now: "org agreement withdraw", next: "org payroll agreement withdraw", group: "payroll" },
  { id: "org.payroll.component.add", now: "org payroll component add", next: "org payroll component add", group: "payroll" },
  { id: "org.payroll.component.change", now: "org payroll component change", next: "org payroll component change", group: "payroll" },
  { id: "org.payroll.component.disable", now: "org payroll component disable", next: "org payroll component disable", group: "payroll" },
  { id: "org.payroll.component.enable", now: "org payroll component enable", next: "org payroll component enable", group: "payroll" },
  { id: "org.payroll.component.list", now: "org payroll component list", next: "org payroll component list", group: "payroll" },
  { id: "org.payslip.release", now: "org payslip release", next: "org payroll payslip release", group: "payroll" },
  { id: "org.payslip.withhold", now: "org payslip withhold", next: "org payroll payslip withhold", group: "payroll" },
  { id: "org.payroll.run.cancel", now: "org payroll run cancel", next: "org payroll run cancel", group: "payroll" },
  { id: "org.payroll.run.create", now: "org payroll run create", next: "org payroll run create", group: "payroll" },
  { id: "org.payroll.run.get", now: "org payroll run get", next: "org payroll run get", group: "payroll" },
  { id: "org.payroll.run.list", now: "org payroll run list", next: "org payroll run list", group: "payroll" },
  { id: "org.payroll.run.pay", now: "org payroll run pay", next: "org payroll run pay", group: "payroll" },
  { id: "org.payroll.run.submit", now: "org payroll run submit", next: "org payroll run submit", group: "payroll" },
  { id: "org.payroll.structure.assign", now: "org payroll structure assign", next: "org payroll structure assign", group: "payroll" },
  { id: "org.payroll.structure.cancel", now: "org payroll structure cancel", next: "org payroll structure cancel", group: "payroll" },
  { id: "org.payroll.structure.create", now: "org payroll structure create", next: "org payroll structure create", group: "payroll" },
  { id: "org.payroll.structure.list", now: "org payroll structure list", next: "org payroll structure list", group: "payroll" },
  { id: "org.payroll.structure.unassign", now: "org payroll structure unassign", next: "org payroll structure unassign", group: "payroll" },
  { id: "agreement.accept", now: "agreement accept", next: "payroll agreement accept", group: "payroll" },
  { id: "agreement.collect", now: "agreement collect", next: "payroll agreement collect", group: "payroll" },
  { id: "agreement.list", now: "agreement list", next: "payroll agreement list", group: "payroll" },
  { id: "agreement.show", now: "agreement show", next: "payroll agreement show", group: "payroll" },
  { id: "payslip.get", now: "payslip get", next: "payroll payslip get", group: "payroll" },
  { id: "payslip.list", now: "payslip list", next: "payroll payslip list", group: "payroll" },
  // crm
  { id: "contact.add", now: "contact add", next: "contact add", group: "crm" },
  { id: "contact.bank.add", now: "contact bank add", next: "contact bank add", group: "crm" },
  { id: "contact.change", now: "contact change", next: "contact change", group: "crm" },
  { id: "contact.create", now: "contact create", next: "contact create", group: "crm" },
  { id: "contact.get", now: "contact get", next: "contact get", group: "crm" },
  { id: "contact.hide", now: "contact hide", next: "contact hide", group: "crm" },
  { id: "contact.label", now: "contact label", next: "contact label", group: "crm" },
  { id: "contact.link", now: "contact link", next: "contact link", group: "crm" },
  { id: "contact.list", now: "contact list", next: "contact list", group: "crm" },
  { id: "contact.unhide", now: "contact unhide", next: "contact unhide", group: "crm" },
  { id: "org.crm.call.log", now: "org crm call log", next: "org crm call log", group: "crm" },
  { id: "org.crm.deal.change", now: "org crm deal change", next: "org crm deal change", group: "crm" },
  { id: "org.crm.deal.create", now: "org crm deal create", next: "org crm deal create", group: "crm" },
  { id: "org.crm.deal.get", now: "org crm deal get", next: "org crm deal get", group: "crm" },
  { id: "org.crm.deal.list", now: "org crm deal list", next: "org crm deal list", group: "crm" },
  { id: "org.crm.deal.move", now: "org crm deal move", next: "org crm deal move", group: "crm" },
  { id: "org.crm.email.send", now: "org crm email send", next: "org crm email send", group: "crm" },
  { id: "org.crm.lead.change", now: "org crm lead change", next: "org crm lead change", group: "crm" },
  { id: "org.crm.lead.convert", now: "org crm lead convert", next: "org crm lead convert", group: "crm" },
  { id: "org.crm.lead.create", now: "org crm lead create", next: "org crm lead create", group: "crm" },
  { id: "org.crm.lead.get", now: "org crm lead get", next: "org crm lead get", group: "crm" },
  { id: "org.crm.lead.list", now: "org crm lead list", next: "org crm lead list", group: "crm" },
  { id: "org.crm.lead.move", now: "org crm lead move", next: "org crm lead move", group: "crm" },
  { id: "org.crm.note.add", now: "org crm note add", next: "org crm note add", group: "crm" },
  { id: "org.crm.note.change", now: "org crm note change", next: "org crm note change", group: "crm" },
  { id: "org.crm.task.change", now: "org crm task change", next: "org crm task change", group: "crm" },
  { id: "org.crm.task.create", now: "org crm task create", next: "org crm task create", group: "crm" },
  { id: "org.crm.task.list", now: "org crm task list", next: "org crm task list", group: "crm" },
  { id: "org.crm.task.move", now: "org crm task move", next: "org crm task move", group: "crm" },
  { id: "org.crm.timeline", now: "org crm timeline", next: "org crm timeline", group: "crm" },
  { id: "org.crm.whatsapp.connect", now: "org crm whatsapp connect", next: "org crm whatsapp connect", group: "crm" },
  { id: "org.crm.whatsapp.disconnect", now: "org crm whatsapp disconnect", next: "org crm whatsapp disconnect", group: "crm" },
  { id: "org.crm.whatsapp.send", now: "org crm whatsapp send", next: "org crm whatsapp send", group: "crm" },
  { id: "org.crm.whatsapp.show", now: "org crm whatsapp show", next: "org crm whatsapp show", group: "crm" },
  // projects
  { id: "org.activity-type.add", now: "org activity-type add", next: "org projects activity-type add", group: "projects" },
  { id: "org.activity-type.change", now: "org activity-type change", next: "org projects activity-type change", group: "projects" },
  { id: "org.activity-type.disable", now: "org activity-type disable", next: "org projects activity-type disable", group: "projects" },
  { id: "org.activity-type.enable", now: "org activity-type enable", next: "org projects activity-type enable", group: "projects" },
  { id: "org.activity-type.list", now: "org activity-type list", next: "org projects activity-type list", group: "projects" },
  { id: "org.project.cancel", now: "org project cancel", next: "org projects cancel", group: "projects" },
  { id: "org.project.change", now: "org project change", next: "org projects change", group: "projects" },
  { id: "org.project.complete", now: "org project complete", next: "org projects complete", group: "projects" },
  { id: "org.project.create", now: "org project create", next: "org projects create", group: "projects" },
  { id: "org.project.get", now: "org project get", next: "org projects get", group: "projects" },
  { id: "org.project.hold", now: "org project hold", next: "org projects hold", group: "projects" },
  { id: "org.project.list", now: "org project list", next: "org projects list", group: "projects" },
  { id: "org.project.member.add", now: "org project member add", next: "org projects member add", group: "projects" },
  { id: "org.project.member.remove", now: "org project member remove", next: "org projects member remove", group: "projects" },
  { id: "org.project-type.add", now: "org project-type add", next: "org projects project-type add", group: "projects" },
  { id: "org.project-type.list", now: "org project-type list", next: "org projects project-type list", group: "projects" },
  { id: "org.project.reopen", now: "org project reopen", next: "org projects reopen", group: "projects" },
  { id: "org.project.resume", now: "org project resume", next: "org projects resume", group: "projects" },
  { id: "org.project.settings.set", now: "org project settings set", next: "org projects settings set", group: "projects" },
  { id: "org.project.settings.show", now: "org project settings show", next: "org projects settings show", group: "projects" },
  { id: "org.task.cancel", now: "org task cancel", next: "org projects task cancel", group: "projects" },
  { id: "org.task.change", now: "org task change", next: "org projects task change", group: "projects" },
  { id: "org.task.complete", now: "org task complete", next: "org projects task complete", group: "projects" },
  { id: "org.task.create", now: "org task create", next: "org projects task create", group: "projects" },
  { id: "org.task.get", now: "org task get", next: "org projects task get", group: "projects" },
  { id: "org.task.list", now: "org task list", next: "org projects task list", group: "projects" },
  { id: "org.task.reopen", now: "org task reopen", next: "org projects task reopen", group: "projects" },
  { id: "org.task.review", now: "org task review", next: "org projects task review", group: "projects" },
  { id: "org.task.start", now: "org task start", next: "org projects task start", group: "projects" },
  { id: "org.timesheet.bill", now: "org timesheet bill", next: "org projects timesheet bill", group: "projects" },
  { id: "org.timesheet.cancel", now: "org timesheet cancel", next: "org projects timesheet cancel", group: "projects" },
  { id: "org.timesheet.create", now: "org timesheet create", next: "org projects timesheet create", group: "projects" },
  { id: "org.timesheet.get", now: "org timesheet get", next: "org projects timesheet get", group: "projects" },
  { id: "org.timesheet.list", now: "org timesheet list", next: "org projects timesheet list", group: "projects" },
  { id: "org.timesheet.log", now: "org timesheet log", next: "org projects timesheet log", group: "projects" },
  { id: "org.timesheet.submit", now: "org timesheet submit", next: "org projects timesheet submit", group: "projects" },
  // head
  { id: "org.app.add", now: "org app add", next: "org head app add", group: "head" },
  { id: "org.app.list", now: "org app list", next: "org head app list", group: "head" },
  { id: "org.app.remove", now: "org app remove", next: "org head app remove", group: "head" },
  { id: "org.head.connect", now: "org head connect", next: "org head connect", group: "head" },
  { id: "org.head.disconnect", now: "org head disconnect", next: "org head disconnect", group: "head" },
  { id: "org.doc.amend", now: "org doc amend", next: "org head doc amend", group: "head" },
  { id: "org.doc.apply", now: "org doc apply", next: "org head doc apply", group: "head" },
  { id: "org.doc.cancel", now: "org doc cancel", next: "org head doc cancel", group: "head" },
  { id: "org.doc.change", now: "org doc change", next: "org head doc change", group: "head" },
  { id: "org.doc.create", now: "org doc create", next: "org head doc create", group: "head" },
  { id: "org.doc.get", now: "org doc get", next: "org head doc get", group: "head" },
  { id: "org.doc.list", now: "org doc list", next: "org head doc list", group: "head" },
  { id: "org.doc.remove", now: "org doc remove", next: "org head doc remove", group: "head" },
  { id: "org.doc.submit", now: "org doc submit", next: "org head doc submit", group: "head" },
  { id: "org.doc-call.list", now: "org doc-call list", next: "org head doc-call list", group: "head" },
  { id: "org.doctype.get", now: "org doctype get", next: "org head doctype get", group: "head" },
  { id: "org.doctype.list", now: "org doctype list", next: "org head doctype list", group: "head" },
  { id: "org.head.show", now: "org head show", next: "org head show", group: "head" },
  // devnet
  { id: "dev.approve", now: "dev approve", next: "dev approve", group: "devnet" },
  { id: "dev.fund", now: "dev fund", next: "dev fund", group: "devnet" },
  { id: "dev.gates.set", now: "dev gates set", next: "dev gates set", group: "devnet" },
  { id: "dev.jobs.run", now: "dev jobs run", next: "dev jobs run", group: "devnet" },
  { id: "dev.key", now: "dev key", next: "dev key", group: "devnet" },
  { id: "dev.mail.fail", now: "dev mail fail", next: "dev mail fail", group: "devnet" },
  { id: "dev.mail.list", now: "dev mail list", next: "dev mail list", group: "devnet" },
  { id: "dev.mail.notices", now: "dev mail notices", next: "dev mail notices", group: "devnet" },
  { id: "dev.prices.set", now: "dev prices set", next: "dev prices set", group: "devnet" },
  // A shared world's seasons (aaron.seasons; devnet.seasons), booked after the tree was designed: spelt as the tree spells them.
  { id: "dev.season.cancel", now: "dev season cancel", next: "dev season cancel", group: "devnet" },
  { id: "dev.season.change", now: "dev season change", next: "dev season change", group: "devnet" },
  { id: "dev.season.create", now: "dev season create", next: "dev season create", group: "devnet" },
  { id: "dev.season.end", now: "dev season end", next: "dev season end", group: "devnet" },
  { id: "dev.season.list", now: "dev season list", next: "dev season list", group: "devnet" },
  { id: "dev.season.player.add", now: "dev season player add", next: "dev season player add", group: "devnet" },
  { id: "dev.season.player.remove", now: "dev season player remove", next: "dev season player remove", group: "devnet" },
  { id: "dev.season.show", now: "dev season show", next: "dev season show", group: "devnet" },
  { id: "dev.season.start", now: "dev season start", next: "dev season start", group: "devnet" },
  { id: "dev.season.warp.add", now: "dev season warp add", next: "dev season warp add", group: "devnet" },
  { id: "dev.season.warp.remove", now: "dev season warp remove", next: "dev season warp remove", group: "devnet" },
  { id: "dev.snapshot.list", now: "dev snapshot list", next: "dev snapshot list", group: "devnet" },
  { id: "dev.snapshot.restore", now: "dev snapshot restore", next: "dev snapshot restore", group: "devnet" },
  { id: "dev.snapshot.save", now: "dev snapshot save", next: "dev snapshot save", group: "devnet" },
  { id: "dev.time", now: "dev time", next: "dev time", group: "devnet" },
  { id: "dev.time.set", now: "dev time set", next: "dev time set", group: "devnet" },
  { id: "dev.time.start-at", now: "dev time start-at", next: "dev time start-at", group: "devnet" },
  { id: "dev.time.warp", now: "dev time warp", next: "dev time warp", group: "devnet" },
];

// ── decisions ───────────────────────────────────────────────────────────────────────────────

export const decision_surface_tree = defineDecision({
  id: "surface.tree",
  title: "One command tree: scope, then the group, then the record, then the verb",
  question:
    "Aaron, 9 November 2026, on question 48: 'The number was not the issue. We need everything you can do on Frappe to " +
    "be programmatic and accessible from our tooling. It's the logical groupings.' The 380 commands start with 79 " +
    "different words (each `org` noun counted as one), and HR alone is spread over twelve of them. How is the surface " +
    "grouped?",
  options: [
    {
      label: "groups",
      text:
        "Every command reads `[org] <group or noun> [<noun>] <verb>`, never more than four words before its arguments. " +
        "`org` stays the scope, as in the 215: it begins every command only an Organization has, acting for the " +
        "Organization `--org` or `use org` names; a command without it acts as yourself, or for whoever you act as. The " +
        "surface has thirteen logical groups (SURFACE_GROUPS). Where a Frappe app holds the records, the group is a word, " +
        "the app's: `org hr`, `org payroll`, `org crm`, `org projects` and `org head` (the Frappe site), beside the 215's " +
        "`org books`; where a person has their own side of it, the same word without `org`: `hr`, `payroll`. Capxul's " +
        "native areas (who you are and sign-in, the CLI and your apps, your money, the Organization and its people and " +
        "departments, governance and equity, agents and the FDE, the devnet) keep the 215's nouns, which already say what " +
        "they are, and are grouped as sections of `capxul --help` and of the reference. Under a group, a record is its " +
        "DocType's noun and every verb is G3's. 119 commands move: 108 of the 165 new ones, and the 215's eleven " +
        "agreement commands into payroll (surface.payroll-group).",
    },
    { label: "flat-sections", text: "Keep every command where it is, and group them only in `--help` and the reference." },
    {
      label: "words-everywhere",
      text:
        "Make every area a word as well: `org equity round create`, `org governance proposal approve`, `money payment " +
        "send`. Most of the 215 move.",
    },
    {
      label: "domain-first",
      text:
        "Drop `org` and start every command with its group, the Organization chosen by `use org`: `hr leave approve`. A " +
        "list could not say whether it is yours or the Organization's, and about 150 of the 215 move.",
    },
  ],
  chosen: "groups",
  why:
    "The scatter Aaron names is where a Frappe app's records sat as loose nouns beside unrelated ones: HR's twelve, " +
    "projects' five, the head's four, payroll's payslips apart from its runs. A Frappe user looks for them by app, as " +
    "Frappe's own workspaces are (Accounting, HR, Payroll, CRM, Projects), so those become words. The native areas' " +
    "nouns (`payment`, `bank`, `org department`, `org round`) already name their area, so a word over them " +
    "(words-everywhere) would only lengthen some 150 commands of the 215; the help sections group them. `org` stays the " +
    "scope because Capxul has what Frappe has not: a person with several employers and several Organizations, so a " +
    "person's own records (`hr leave list`, `payroll payslip list`) cover all of them while `org hr leave list` is one " +
    "Organization's; domain-first loses that. flat-sections leaves HR's own side at the top beside money (`leave`, " +
    "`advance`). No command is longer than the 215's longest (`org books accounts add`). The SDK follows the words " +
    "(G7): `client.org(orgId).hr.leaves.approve`, `client.me.hr.leaves.apply`. For Aaron: the tree, its thirteen " +
    "groups and its 119 moves are in docs/design/command-surface.md. " +
    "Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended. What it now applies to: of the tree's 394 rows, 159 are still booked (the native groups: identity, builders, " +
    "money, the Organization, governance's board, agents, the devnet and the eleven pay agreements under payroll). The HR, projects and head " +
    "groups and most of the books, payroll and CRM rows left the built book with the cut and are Frappe's, reached through the door " +
    "(cut.books, cut.payroll, cut.contacts, cut.projects, cut.organizations); the devnet's eleven `dev season` rows are parked (cut.seasons). " +
    "The ruling stands as chosen.",
  source: by("docs/design/command-surface.md; the workspaces of frappe/erpnext@6b946b0 and frappe/hrms@8816102"),
  affects: [f.system_capxul, f.component_cli, f.component_core_sdk],
});

export const decision_surface_payroll_group = defineDecision({
  id: "surface.payroll-group",
  title: "Payroll is its own group: components, structures, runs, payslips, agreements",
  question:
    "Payroll's commands are `org payroll component|structure|run`, `org payslip withhold|release` and `payslip " +
    "list|get`; the 215's pay agreements are `agreement accept|collect|list|show` and `org agreement " +
    "offer|change|pause|resume|end|withdraw|list`. Where do payslips and agreements go?",
  options: [
    {
      label: "pay-group",
      text:
        "One group mirroring Frappe HR's Payroll module and Capxul's pay agreements: `org payroll " +
        "component|structure|run|payslip|agreement` for the Organization, `payroll payslip|agreement` for the payee, " +
        "across every employer. The eleven agreement commands of the 215 move. `agreement accept` becomes `payroll " +
        "agreement accept`, `agreement collect` becomes `payroll agreement collect`, `agreement list` becomes `payroll " +
        "agreement list` and `agreement show` becomes `payroll agreement show`. `org agreement offer` becomes `org " +
        "payroll agreement offer`, and in the same way `org agreement change`, `org agreement pause`, `org agreement " +
        "resume`, `org agreement end`, `org agreement withdraw` and `org agreement list` gain `payroll` after `org`.",
    },
    { label: "agreements-apart", text: "Payslips move into payroll; agreements stay where the 215 put them, as Capxul's own." },
  ],
  chosen: "pay-group",
  why:
    "An agreement is how an Organization pays a person on a stream, and the book keeps it in Frappe's payroll shape: " +
    "its acceptance makes an Employee and an assignment of the agreement structure, and each collection is a submitted " +
    "Salary Slip (payroll.agreements-in-frappe-shape, payroll.collection-slips). So `payroll payslip list` already " +
    "shows an agreement's collections; with agreements apart, the payee would read them in one group and collect them " +
    "in another. A Frappe user looks for every way people are paid under Payroll. The moves are spelling only " +
    "(system.frozen-behaviour): each operation keeps its id and every claim's behaviour, its SDK method follows its " +
    "words (G7), and its owner renames the command with this decision on it.",
  source: by("payroll.agreements-in-frappe-shape; payroll.collection-slips; docs/design/frappe/payroll.md"),
  affects: [
    payroll.operation_agreement_accept,
    payroll.operation_agreement_collect,
    payroll.operation_agreement_list,
    payroll.operation_agreement_show,
    payroll.operation_org_agreement_offer,
    payroll.operation_org_agreement_change,
    payroll.operation_org_agreement_pause,
    payroll.operation_org_agreement_resume,
    payroll.operation_org_agreement_end,
    payroll.operation_org_agreement_withdraw,
    payroll.operation_org_agreement_list,
  ],
});

export const decision_surface_projects_group = defineDecision({
  id: "surface.projects-group",
  title: "Projects is its own group, and a project takes its verbs on the group",
  question:
    "Projects' 36 commands sit under five nouns of `org` (`org project`, `org task`, `org timesheet`, `org " +
    "activity-type`, `org project-type`). How do they group?",
  options: [
    {
      label: "group-verbs",
      text:
        "`org projects`, ERPNext's Projects module. The Project's own verbs sit on the group, as the Organization's sit on " +
        "`org` (`org create`, `org list`, `org show`): `org projects create|list|get|change|hold|resume|complete|reopen|" +
        "cancel`, with `org projects member add|remove` (Project User) and `org projects settings show|set` (Projects " +
        "Settings). The module's other DocTypes are its nouns: `org projects task …`, `org projects timesheet …` " +
        "(requests' `bill` among them), `org projects activity-type …` and `org projects project-type add|list`.",
    },
    {
      label: "noun-under-group",
      text: "`org projects project create`, `org projects project member add`: systematic, at the cost of 'projects project' and five words.",
    },
    { label: "as-booked", text: "Keep the five nouns as booked." },
  ],
  chosen: "group-verbs",
  why:
    "The group is the module's name, as Frappe's workspace is, and its first record is the module's own, as the " +
    "Organization is `org`'s; repeating it would add a word to the thirteen project commands and make `member add` five " +
    "words, longer than anything in the 215. The SDK reads the same way: `client.org(orgId).projects.create` (as " +
    "booked) and `client.org(orgId).projects.tasks.create`. All 36 are new, so no frozen command moves; each id becomes " +
    "its new words (`org.task.create` is `org.projects.task.create`).",
  source: by("frappe/erpnext@6b946b0 (module Projects); projects.commands; requests.bill-time"),
  affects: [f.concept_requests],
});

export const decision_surface_computed_gaps = defineDecision({
  id: "surface.computed-gaps",
  title: "What Capxul computes stays native; its missing DocTypes become commands",
  question:
    "Capxul computes every slip, a timesheet's costs and a deal's figures, so the Payroll, Projects and FCRM modules are " +
    "native and the family refuses them. 32 of their DocTypes have no command: Payroll's Additional Salary (beyond an " +
    "advance's recovery), Employee Incentive, Retention Bonus, Arrear, Payroll Correction, Salary Withholding, Income " +
    "Tax Slab, Payroll Period, the tax-exemption and benefit DocTypes, Employee Other Income, Gratuity and its Rule, " +
    "Bulk Salary Structure Assignment; Projects' Activity Cost, Project Template, Project Update, Task Type; FCRM's CRM " +
    "Product, Lead Source, Territory, Industry, Service Level Agreement and its lists. HR's Leave Encashment is money. On " +
    "a head, Overtime Slip makes an Additional Salary, and Attendance Request, Shift Request, Compensatory Leave Request, " +
    "Leave Policy Assignment and Leave Adjustment write native HR records when submitted. How are they reached?",
  options: [
    {
      label: "native-next",
      text:
        "Each becomes a native command in its concept's next pack, never a family call, since a figure the family wrote " +
        "on the head would not be in what Capxul computes. Payroll first: one-off earnings and deductions, Additional " +
        "Salary, which Frappe's Employee Incentive, Retention Bonus and Overtime Slip each make (`org payroll " +
        "additional-salary create|cancel|list`); then Activity Cost, the per-employee rate a timesheet costs at (`org " +
        "projects activity-type` with `--employee`); then CRM Product on a deal; then the period, tax and gratuity " +
        "DocTypes a country's payroll needs, as a customer needs them. Until then the head-side HR documents that write " +
        "native records are refused by the family, or taken in by payroll's head sync, as payroll.hr-head-sync chooses.",
    },
    { label: "family-then-sync", text: "Reach them through the family, and have each concept's head sync take them in before it computes." },
  ],
  chosen: "native-next",
  why:
    "A computed figure has one author or it is wrong: a slip Capxul computed cannot also include an incentive the head " +
    "holds, unless the sync takes it in before the run, which is a second path for every pay figure. Additional Salary " +
    "comes first because every payroll has one-off pay and Frappe builds three other DocTypes on it. Each new command " +
    "is booked by its concept with a pack decision citing aaron.frappe-shape (rules.new-operations). " +
    "Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended. What it now applies to: Payroll, Projects and CRM left the built book with the cut and are Frappe's, so the 32 DocTypes are " +
    "Frappe documents reached through the door (cut.payroll, cut.projects, cut.contacts) and the packs of native commands it chose are not " +
    "written; the rule that a figure Capxul computes has one author applies to what Core computes (budgets, payments, authority). The " +
    "ruling stands as chosen.",
  source: by("hrms@8816102 payroll and hr DocTypes (overtime_slip, attendance_request, shift_request on_submit); erpnext@6b946b0 projects; crm@2cecd30 fcrm"),
  affects: [f.concept_contacts],
});

export const decision_surface_fit_calls = defineDecision({
  id: "surface.fit-calls",
  title: "The surface after its fit review: what stays spelt as it is, and why",
  question:
    "The fit reviews of the applied tree raised spellings left to the surface: `payroll agreement show <id>` beside " +
    "`payroll payslip get <id>`; `org hr employee leave` (an Employee leaving) beside `org hr leave` (Leave " +
    "Application); `apply` both a leave's birth and a Workflow's action; `org director add|remove|replace|threshold`, " +
    "which always refuse, beside `org board director` and `org board threshold`; `balance` in the verb place; G5's " +
    "`--from <budget>` against the 215's dated `--from`; and 67 HR DocTypes reached only through `org head doc`. Which " +
    "change?",
  options: [
    {
      label: "keep-and-say",
      text:
        "No spelling changes; the grammar and the help say what each is. G3's 'show <id> is not used' binds new commands, " +
        "and the 215's eleven agreement commands moved by their group word only, so `payroll agreement show` keeps the " +
        "215's verb. `org hr employee leave` keeps G3's lifecycle verb, Frappe's own (the Employee's status Left); the " +
        "noun before it (`employee`) tells it from the record `org hr leave`. `apply` keeps its two meanings, each " +
        "Frappe's word (Leave Application; frappe.model.workflow apply_workflow), and G3 says so. `balance` is a view " +
        "read by its noun, as the 215's `balance`, and G3 lists it. G5's `--from <budget>` binds new commands; the " +
        "215's `dev prices set --from <date>` and `org payroll agreement change --from <date>` keep theirs. `capxul " +
        "--help` marks `org director add|remove|replace|threshold` retired, naming `org board director` and `org board " +
        "threshold`, and `capxul org hr --help` names `org head doc` and `org head doctype list --app hrms --module HR` " +
        "for HR's other DocTypes (recruitment, appraisal, training).",
    },
    {
      label: "respell",
      text:
        "Respell `payroll agreement show` as `payroll agreement get`, `org hr employee leave` as `org hr employee " +
        "relieve` (Frappe's relieving_date), and one of the two `apply`s.",
    },
  ],
  chosen: "keep-and-say",
  why:
    "Each respelling would be a second change to a command whose group just moved, for a reader the noun already " +
    "serves: `org hr employee leave <Ana> --on <day>` names the Employee, and `relieve` is no verb of the 215, so it " +
    "would open G3's closed set. A Frappe reader meets both `apply`s in Frappe itself. Saying it in the grammar and " +
    "the help costs nothing and keeps every id and eval. The tree also grew after it was designed, each spelt as the " +
    "tree spells: the devnet's eleven `dev season` commands (devnet.seasons) and HR's three person-side reads " +
    "(payroll.hr-self-rules), 394 commands in all.",
  source: by("the fit reviews of the surface pass (identity-and-org, frappe-apps, devnet-seasons); docs/design/new-commands.md G3 and G5"),
  affects: [f.component_cli, f.component_core_sdk, f.concept_board, f.concept_devnet],
});
