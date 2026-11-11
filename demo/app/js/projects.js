// Projects: the workspace; the portfolio (health, budget, margin, next milestone) and resources (who is on what,
// utilisation, leave); projects (list and form with overview, plan, timeline, costing and billing); tasks (list,
// kanban, a Gantt drawn to scale, tree, form); timesheets, and billing their hours into an invoice; activity types and
// project types; the options; the reports. The project agent coordinates and people decide: it drafts plans from won
// deals, suggests who takes a task, suggests timesheet rows from calendars, drafts the weekly client update, flags
// overruns and slipping milestones, and gathers billable hours into a draft invoice, all through the assistant panel.
// Any member works tasks and keeps their own time; People or a Director manage projects; Invoicing bills hours.
import { cx, h, s } from './core.js';

const D = cx.data;
const P = D.projects;
const fmt = cx.fmt;
const TODAY = cx.today;
const T0 = performance.now();
const NOW = () => new Date(cx.now.getTime() + Math.max(1000, Math.round(performance.now() - T0))).toISOString().replace(/\.\d{3}Z$/, 'Z');
const PM = { any: ['People', 'Director'] };
const MEMBER = { seat: true };

/* =====================================================================================================
   Indexes and helpers
   ===================================================================================================== */

const PROJ = new Map(P.projects.map((p) => [p.name, p]));
const TASK = new Map(P.tasks.map((t) => [t.name, t]));
const TSM = new Map(P.timesheets.map((t) => [t.name, t]));
const LOGS = cx.rows('projects.logs');
const CUSTOMERS = new Map((D.books.customers || []).map((c) => [c.id, c]));
const sum = (arr, f) => arr.reduce((a, x) => a + (+(f ? f(x) : x) || 0), 0);
const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const q = (v) => (/[\s"'&|;<>()$`\\]/.test(String(v ?? '')) || v === '' ? JSON.stringify(String(v ?? '')) : String(v));
const dayOf = (iso) => String(iso || '').slice(0, 10);
const dayMs = (d) => Date.parse(dayOf(d) + 'T00:00:00Z');
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);
const addDays = (d, n) => { const t = new Date(dayOf(d) + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekday = (d) => new Date(dayOf(d) + 'T00:00:00Z').getUTCDay();
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
const namesList = (ids) => { const n = ids.map(cx.name); return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n.at(-1); };
const wearers = (hat) => D.people.filter((p) => (p.hats || []).includes(hat)).map((p) => p.id);
const directors = () => D.board.directors.filter((x) => !x.to).map((x) => x.who || x.id || x);
const emailOf = (id) => cx.person(id)?.companyEmail || cx.person(id)?.seatMember?.email || `${String(cx.firstName(id)).toLowerCase()}@harbourline.studio`;
const custName = (id) => CUSTOMERS.get(id)?.name || D.crm?.companies?.find((c) => c.id === id)?.name || id || '';
const custLink = (id) => (id ? (cx.hasRoute('company') && D.crm?.companies?.some((c) => c.id === id) ? cx.link(custName(id), 'company', id) : h('span', custName(id))) : h('span.faint', '—'));
const projName = (name) => PROJ.get(name)?.projectName || name || '';
const projLink = (name, label) => (name ? cx.link(label || name, 'project', name) : h('span.faint', '—'));
const taskLink = (name) => (name ? cx.link(TASK.get(name)?.subject || name, 'task', name) : h('span.faint', '—'));
const money = (v, cur = 'GBP', dp = 2) => fmt.money(+v || 0, cur, dp);
let seq = 0;
function nextName(prefix, names, pad = 5) {
  let max = 0;
  for (const n of names) if (n && String(n).startsWith(prefix)) max = Math.max(max, +String(n).slice(prefix.length) || 0);
  return prefix + String(max + 1).padStart(pad, '0');
}
const pmLine = () => `Managing projects needs the People hat or a Director's. ${namesList(wearers('People'))} wear People; the Directors are ${namesList(directors())}.`;

/* ---------- statuses ---------- */

const TASK_STATUSES = ['Open', 'Working', 'Pending Review', 'Overdue', 'Completed', 'Cancelled'];
const TASK_TONE = { Open: 'orange', Working: 'blue', 'Pending Review': 'purple', Overdue: 'red', Completed: 'green', Cancelled: 'gray', Template: 'blue' };
const TASK_FILL = { Open: 'var(--chart-1)', Working: 'var(--t-blue)', 'Pending Review': 'var(--t-purple)', Overdue: 'var(--neg)', Completed: 'var(--t-green)', Cancelled: 'var(--faint)' };
const TS_TONE = { Draft: 'red', Submitted: 'blue', 'Partially Billed': 'orange', Billed: 'green', Payslip: 'green', Completed: 'green', Cancelled: 'red' };
const PROJ_TONE = { Open: 'orange', 'On hold': 'blue', Completed: 'green', Cancelled: 'red' };
const taskPill = (st, o) => cx.pill(st, TASK_TONE[st] || 'gray', o);
const tsPill = (st, o) => cx.pill(st, TS_TONE[st] || 'gray', o);
const projStatusText = (p) => (p.status === 'Open' && p.percentComplete > 0 ? `${Math.round(p.percentComplete)}%` : p.status);
const projPill = (p, o) => cx.pill(projStatusText(p), PROJ_TONE[p.status] || 'gray', o);
const isOpenTask = (t) => !['Completed', 'Cancelled'].includes(t.status);
const PRIORITY_TONE = { Low: 'gray', Medium: 'blue', High: 'orange', Urgent: 'red' };

/* ---------- time logs, by timesheet, project and task ---------- */

let LIDX = null;
function logIndex() {
  if (LIDX) return LIDX;
  const byTs = new Map(), byProject = new Map(), byTask = new Map();
  const add = (m, k, v) => { if (!k) return; let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(v); };
  for (const l of LOGS) { add(byTs, l.timesheet, l); add(byProject, l.project, l); add(byTask, l.task, l); }
  for (const [, list] of byTs) {
    list.sort((a, b) => (a.date === b.date ? a.idx - b.idx : a.date < b.date ? -1 : 1));
    const cum = new Map();
    for (const l of list) {
      if (!l.fromTime) { const c = cum.get(l.date) || 0; const start = 9 + c + (c >= 4 ? 0.5 : 0); const hh = Math.floor(start), mm = Math.round((start - hh) * 60); l.fromTime = `${l.date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`; cum.set(l.date, c + l.hours); }
    }
  }
  LIDX = { byTs, byProject, byTask };
  return LIDX;
}
const reindex = () => { LIDX = null; };
const tsLogs = (name) => logIndex().byTs.get(name) || [];
const liveTs = (name) => { const t = TSM.get(name); return t && t.status !== 'Cancelled'; };
const toTime = (l) => new Date(Date.parse(l.fromTime) + l.hours * 3600000).toISOString();
/** A timesheet's totals and status, from its logs (an invoice posted in Books marks its logs billed). */
function tsInfo(ts) {
  const logs = tsLogs(ts.name);
  const bill = logs.filter((l) => l.billable);
  const billableAmount = r2(sum(bill, (l) => l.billingAmount));
  const billedLogs = bill.filter((l) => l.invoice);
  const billedAmount = r2(sum(billedLogs, (l) => l.billingAmount));
  let status = ts.status;
  if (!['Draft', 'Cancelled'].includes(status)) status = billableAmount <= 0.005 ? 'Submitted' : billedAmount >= billableAmount - 0.005 ? 'Billed' : billedAmount > 0 ? 'Partially Billed' : 'Submitted';
  return {
    logs, status, hours: r2(sum(logs, (l) => l.hours)), billableHours: r2(sum(bill, (l) => l.hours)), billableAmount,
    costingAmount: r2(sum(logs, (l) => l.hours * l.costingRate)), billedHours: r2(sum(billedLogs, (l) => l.hours)), billedAmount,
    perBilled: billableAmount > 0 ? Math.round((billedAmount / billableAmount) * 100) : 0,
    unbilled: bill.filter((l) => !l.invoice), invoices: uniq(billedLogs.map((l) => l.invoice)),
  };
}
const logSums = (logs) => { const live = logs.filter((l) => liveTs(l.timesheet)); return { cost: sum(live, (l) => l.hours * l.costingRate), billable: sum(live.filter((l) => l.billable), (l) => l.billingAmount), billed: sum(live.filter((l) => l.invoice), (l) => l.billingAmount), hours: sum(live, (l) => l.hours) }; };
const BASE = new Map(P.projects.map((p) => [p.name, logSums(logIndex().byProject.get(p.name) || [])]));
const TBASE = new Map(P.tasks.map((t) => [t.name, logSums(logIndex().byTask.get(t.name) || [])]));
/** A project's costing and billing: the record's figures, moved by every change made in this session. */
function projTotals(p) {
  const b = BASE.get(p.name) || { cost: 0, billable: 0, billed: 0, hours: 0 };
  const n = logSums(logIndex().byProject.get(p.name) || []);
  const cost = r2((p.totalCostingAmount || 0) + n.cost - b.cost);
  const billed = r2((p.totalBilledAmount || 0) + n.billed - b.billed);
  const purchase = p.totalPurchaseCost || 0;
  const margin = r2(billed - cost - purchase);
  return { cost, billable: r2((p.totalBillableAmount || 0) + n.billable - b.billable), billed, hours: r2((p.actualTime || 0) + n.hours - b.hours), purchase, sales: p.totalSalesAmount, margin, marginPct: billed ? r2((margin / billed) * 100) : 0 };
}
function taskTotals(t) {
  const b = TBASE.get(t.name) || { cost: 0, billable: 0, hours: 0 };
  const n = logSums(logIndex().byTask.get(t.name) || []);
  return { hours: r2((t.actualTime || 0) + n.hours - b.hours), cost: r2((t.totalCosting || 0) + n.cost - b.cost), billable: r2((t.totalBillable || 0) + n.billable - b.billable) };
}
const billableTs = (name) => { const t = TSM.get(name); return !!t && !['Draft', 'Cancelled'].includes(t.status); };
/** Billable time not yet on an invoice, from submitted timesheets. */
const unbilledOf = (projectName) => LOGS.filter((l) => (!projectName || l.project === projectName) && l.billable && !l.invoice && billableTs(l.timesheet));

/* ---------- tasks ---------- */

const tasksOf = (project) => P.tasks.filter((t) => t.project === project);
/** A project's tasks in tree order: each top task, then its children, by expected start. */
function treeOrder(list) {
  const byStart = (a, b) => String(a.expStart || '').localeCompare(String(b.expStart || '')) || a.name.localeCompare(b.name);
  const names = new Set(list.map((t) => t.name));
  const roots = list.filter((t) => !t.parent || !names.has(t.parent)).sort(byStart);
  const out = [];
  const walk = (t, depth) => { out.push({ t, depth }); list.filter((c) => c.parent === t.name).sort(byStart).forEach((c) => walk(c, depth + 1)); };
  roots.forEach((r) => walk(r, 0));
  return out;
}
/** Percent complete by Task Completion: completed or cancelled tasks over all tasks, groups left out. */
function recalcProject(p) {
  const list = tasksOf(p.name).filter((t) => !t.isGroup);
  if (!list.length || p.percentCompleteMethod === 'Manual') return;
  const pct = Math.round((list.filter((t) => !isOpenTask(t)).length / list.length) * 100);
  p.percentComplete = pct;
  if (p.status === 'Open' && pct === 100) { p.status = 'Completed'; cx.toast(`${p.projectName} is complete: every task is done`, { tone: 'success' }); }
  else if (p.status === 'Completed' && pct < 100) p.status = 'Open';
}
function recalcGroup(name) {
  const g = TASK.get(name); if (!g || !g.isGroup) return;
  const kids = P.tasks.filter((t) => t.parent === name);
  if (!kids.length) return;
  g.progress = Math.round(sum(kids, (k) => (k.status === 'Completed' ? 100 : k.status === 'Cancelled' ? 100 : k.progress || 0)) / kids.length);
  if (kids.every((k) => !isOpenTask(k))) { if (g.status !== 'Completed') { g.status = 'Completed'; g.completedOn = TODAY; } }
  else if (g.status === 'Completed' || g.status === 'Open') g.status = kids.some((k) => ['Working', 'Pending Review', 'Overdue', 'Completed'].includes(k.status)) ? 'Working' : 'Open';
}
const openBlockers = (t) => [...(t.dependsOn || []).map((n) => TASK.get(n)).filter((x) => x && isOpenTask(x)), ...P.tasks.filter((c) => c.parent === t.name && isOpenTask(c))];
function noteOn(t, text, kind = 'status') { (t.history ||= []).push({ at: NOW(), who: cx.meId(), kind, text }); t.modifiedAt = NOW(); t.modifiedBy = cx.meId(); }
/** Ask the review day a task waits for. */
function askReviewDay(t) {
  return new Promise((resolve) => {
    const m = { by: addDays(TODAY, 3) };
    let done = false;
    const md = cx.modal({ title: `Send "${t.subject}" for review`, onClose: () => { if (!done) resolve(null); },
      body: h('div', { style: 'display:grid;gap:12px' }, h('p.muted', { style: 'font-size:13px' }, 'It falls Overdue if nobody reviews it by that day.'), cx.field({ label: 'Review by', key: 'by', model: m, edit: true, type: 'date', reqd: true })),
      actions: [cx.btn('Back', { onClick: () => md.close() }), cx.btn('Send for review', { kind: 'primary', onClick: () => { if (!m.by) return; done = true; md.close(); resolve(m.by); } })] });
  });
}
/**
 * Move a task by its verb (start, review, complete, reopen, cancel). Overdue is never a move: a task falls Overdue on
 * its own. Resolves true when it moved.
 */
async function taskMove(t, to, o = {}) {
  const from = t.status;
  if (from === to) return false;
  const allow = cx.allowed(MEMBER);
  if (!allow.ok) { cx.toast(allow.reason, { tone: 'warning' }); return false; }
  const refuse = (text, cmd) => { cx.toast(text, { tone: 'warning', cmd }); return false; };
  const closed = ['Completed', 'Cancelled'].includes(from);
  let cmd;
  switch (to) {
    case 'Overdue': return refuse('A task becomes Overdue on its own once its Expected End Date passes.');
    case 'Working':
      if (closed) return refuse('Reopen it first: it goes back to Open.', `capxul org projects task reopen ${t.name}`);
      if (from === 'Overdue') return refuse('An overdue task goes back to Working when its expected end moves later.', `capxul org projects task change ${t.name} --end ${addDays(TODAY, 7)}`);
      cmd = `capxul org projects task start ${t.name}`; t.status = 'Working'; noteOn(t, 'started the task'); break;
    case 'Pending Review': {
      if (closed) return refuse('Reopen it first: it goes back to Open.', `capxul org projects task reopen ${t.name}`);
      const by = await askReviewDay(t); if (!by) return false;
      cmd = `capxul org projects task review ${t.name} --by ${by}`; t.status = 'Pending Review'; t.reviewDate = by; noteOn(t, `sent it for review by ${fmt.date(by)}`); break;
    }
    case 'Completed': {
      const open = openBlockers(t);
      if (open.length) return refuse(`It waits on ${open.map((x) => x.subject).join(', ')}: a task completes only after the tasks it depends on, and a group after its children.`, `capxul org projects task complete ${t.name}`);
      cmd = `capxul org projects task complete ${t.name}`; t.status = 'Completed'; t.progress = 100; t.completedOn = TODAY; t.completedBy = cx.meId(); noteOn(t, 'completed the task'); break;
    }
    case 'Open':
      if (!closed) return refuse("Capxul's task verbs have no stop: a task goes back to Open only when its last timesheet is cancelled, or when it is reopened after completing.", `capxul org projects task cancel ${t.name}`);
      cmd = `capxul org projects task reopen ${t.name}`; t.status = 'Open'; t.completedOn = null; t.completedBy = null; noteOn(t, 'reopened the task'); break;
    case 'Cancelled':
      if (!o.confirmed && !(await cx.confirm({ title: `Cancel "${t.subject}"?`, body: 'It counts as done for its project and for the tasks that depend on it. Reopen brings it back.', cmd: `capxul org projects task cancel ${t.name}`, who: 'any member', confirmLabel: 'Cancel the task', cancelLabel: 'Back', danger: true }))) return false;
      cmd = `capxul org projects task cancel ${t.name}`; t.status = 'Cancelled'; noteOn(t, 'cancelled the task'); break;
    default: return false;
  }
  if (t.parent) recalcGroup(t.parent);
  const p = PROJ.get(t.project); if (p) recalcProject(p);
  cx.showAction(cmd, to, { pin: true });
  if (!o.quiet) cx.toast(`${t.subject}: ${to}`, { tone: 'success', cmd });
  if (o.refresh) cx.refresh();
  return true;
}

/* =====================================================================================================
   The project agent: Harbourline's project coordinator. It drafts a plan from a won deal's proposal, suggests who
   takes a task from availability, skills and leave, suggests timesheet rows from each person's calendar, drafts the
   weekly client update, watches budget and milestones, and gathers billable hours into a draft invoice. People
   decide: each suggestion waits in the assistant panel for the person it is for, and the records say what it did.
   ===================================================================================================== */

const AGENT = 'Project agent';
/** Who leads each project: the person the agent drafts plans, updates and flags for. */
const LEADS = { 'PROJ-0001': 'isla', 'PROJ-0002': 'tom', 'PROJ-0003': 'priya', 'PROJ-0004': 'lena', 'PROJ-0005': 'grace', 'PROJ-0006': 'tom', 'PROJ-0007': 'isla', 'PROJ-0008': 'leo', 'PROJ-0009': 'ravi', 'PROJ-0010': 'priya', 'PROJ-0011': 'isla', 'PROJ-0012': 'priya', 'PROJ-0013': 'tom' };
const leadOf = (p) => (p ? p.lead || LEADS[p.name] || cx.holders(p.department).find((x) => !String(x).startsWith('@')) || p.createdBy || null : null);
/** What each person is known for, beside the hours their timesheets show by activity. */
const SKILLS = { ellis: ['iOS', 'React Native', 'APIs'], jamal: ['Android', 'React Native'], josh: ['React', 'Design systems'], ben: ['Back end', 'Support'], callum: ['Payments', 'React Native'], tomas: ['React Native', 'Front end'], sofia: ['Design engineering', 'Docs'], tom: ['Architecture', 'Tooling'], lena: ['Product design', 'Research'], amira: ['Product design', 'Design tokens'], chloe: ['User research', 'Workshops'], freya: ['Motion', 'Brand'], meilin: ['Product design', 'E-commerce'], hannah: ['Visual design'], priya: ['Design direction', 'Accessibility'], isla: ['Project management'], ravi: ['Delivery', 'Retainers'], grace: ['Delivery', 'Service design'] };

/* ---------- working days, leave and capacity ---------- */

const HOLIDAYS = new Set((D.hr?.holidayLists || []).flatMap((l) => (l.holidays || []).filter((x) => !x.weeklyOff).map((x) => x.date)));
const isWorkday = (d) => { const w = weekday(d); return w !== 0 && w !== 6 && !HOLIDAYS.has(d); };
const workdays = (a, b) => { const out = []; if (!a || !b) return out; for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkday(d)) out.push(d); return out; };
const nextWorkday = (d) => { let x = addDays(d, 1); while (!isWorkday(x)) x = addDays(x, 1); return x; };
const wdBetween = (a, b) => (!a || !b || a === b ? 0 : b > a ? workdays(addDays(a, 1), b).length : -workdays(addDays(b, 1), a).length);
const mondayOf = (d) => { let x = d; while (weekday(x) !== 1) x = addDays(x, -1); return x; };
const WEEK0 = mondayOf(TODAY);
const LEAVES = (D.hr?.leaveApplications || []).filter((a) => ['Approved', 'Open'].includes(a.status));
const leaveOn = (id, d) => LEAVES.find((a) => a.employee === id && a.fromDate <= d && d <= a.toDate) || null;
const leavesOf = (id, from, to) => LEAVES.filter((a) => a.employee === id && a.toDate >= from && a.fromDate <= to).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
const spanText = (a, b) => (a === b ? fmt.day(a) : a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${fmt.day(b)}` : `${fmt.day(a)} to ${fmt.day(b)}`);
const leaveText = (a) => `${a.leaveType === 'Annual Leave' ? 'off' : a.leaveType.toLowerCase()} ${a.leaveType === 'Annual Leave' ? spanText(a.fromDate, a.toDate) : 'from ' + fmt.day(a.fromDate)}${a.status === 'Open' ? ' (requested)' : ''}`;
const DAY_H = 7.5;
/** The share of a day a person gives to project tasks: leads, managers and directors spend half theirs running things. */
const focusOf = (id) => (/Lead|Director|Founder|Manager/.test(cx.person(id)?.designation || '') ? 0.5 : 1);
const capOn = (id, d) => (isWorkday(d) && !leaveOn(id, d) ? DAY_H * focusOf(id) : 0);
const TEAM = () => D.people.filter((x) => x.status === 'Active' && (SKILLS[x.id] || P.tasks.some((t) => (t.assignees || []).includes(x.id)))).map((x) => x.id);

/* ---------- what is left, and when it lands ---------- */

/** Hours a task still needs: its estimate's rest, or, when it runs over, the rest at the rate it has burned so far. */
function remainingOf(t) {
  if (t.isGroup || !isOpenTask(t)) return 0;
  const p = Math.min(0.99, (t.progress || 0) / 100), est = +t.expectedTime || 0, act = taskTotals(t).hours;
  return r2(Math.max(0, p > 0 && act > est * p ? (act * (1 - p)) / p : est * (1 - p)));
}
const planPace = (t) => (+t.expectedTime || 0) / Math.max(1, workdays(t.expStart, t.expEnd).length);
/** Each task's forecast end: after what it depends on, at its planned pace, within its people's capacity and leave. */
function forecastAll() {
  const memo = new Map();
  const of = (t) => {
    if (!t) return null;
    if (memo.has(t.name)) return memo.get(t.name) || { end: t.expEnd, slip: 0 };
    memo.set(t.name, null);
    let res;
    if (!isOpenTask(t)) res = { end: t.completedOn || t.expEnd, slip: 0, done: true };
    else if (t.isGroup) {
      const kids = P.tasks.filter((k) => k.parent === t.name).map(of).filter(Boolean);
      const end = kids.reduce((m, k) => (k.end > m ? k.end : m), t.expEnd || TODAY);
      res = { end, slip: Math.max(0, wdBetween(t.expEnd, end)) };
    } else {
      let start = !t.expStart || t.expStart < TODAY ? TODAY : t.expStart, after = null;
      for (const dn of t.dependsOn || []) { const f = of(TASK.get(dn)); if (f && !f.done && f.end >= start) { start = nextWorkday(f.end); after = dn; } }
      while (!isWorkday(start)) start = addDays(start, 1);
      const who = t.assignees || [];
      const pace = planPace(t) || DAY_H;
      let left = remainingOf(t), d = start, last = start, guard = 0, short = 0;
      while (left > 0.01 && guard++ < 500) {
        if (isWorkday(d)) { const avail = who.length ? sum(who, (id) => capOn(id, d)) : pace; const per = Math.min(pace, avail); if (per < pace) short++; if (per > 0) { left -= per; last = d; } }
        d = addDays(d, 1);
      }
      res = { end: last, slip: wdBetween(t.expEnd || last, last), after, short, left: remainingOf(t) };
    }
    memo.set(t.name, res);
    return res;
  };
  for (const t of P.tasks) of(t);
  return { get: (n) => memo.get(n) || null, of };
}
/** Why a task lands late: follow what it waits on to the task that holds it up. */
function slipCause(t, FC, depth = 0) {
  const f = FC.get(t.name); if (!f || depth > 6) return '';
  if (f.after) return slipCause(TASK.get(f.after), FC, depth + 1) || `${TASK.get(f.after)?.subject} finishes ${fmt.day(FC.get(f.after)?.end)}`;
  if (depth === 0) return f.short ? `${namesList(t.assignees || [])} ${(t.assignees || []).length > 1 ? 'have' : 'has'} less time than it needs` : '';
  const who = t.assignees || [];
  const from = t.expStart > TODAY ? t.expStart : TODAY;
  const off = who.map((id) => { const ls = leavesOf(id, from, f.end); return ls.length ? `${cx.firstName(id)} ${ls.map((a, i) => (i ? leaveText(a).replace(/^off /, '') : leaveText(a))).join(', ')}` : null; }).filter(Boolean);
  if (t.status === 'Overdue') return `${t.subject} is late`;
  if (f.short && who.some((id) => focusOf(id) < 1)) return `${t.subject} at ${namesList(who)}'s availability (half their time goes on running things${off.length ? ', ' + off.join(', ') : ''})`;
  if (f.short) return `${t.subject}: ${off.length ? off.join(', ') : 'less time than it needs'}`;
  if (taskTotals(t).hours > (+t.expectedTime || 0) * ((t.progress || 0) / 100) && (t.progress || 0) > 0) return `${t.subject} is running over its estimate`;
  return `${t.subject} finishes ${fmt.day(f.end)}`;
}

/* ---------- a project's numbers and health ---------- */

const byEnd = (a, b) => String(a.expEnd).localeCompare(String(b.expEnd));
const gbpRate = (p) => (projCurrency(p) === 'GBP' ? 1 : cx.rate(TODAY));
/** Work done, budget, hours, margin, milestones: what the health and the portfolio read. */
function metricsOf(p, FC = forecastAll()) {
  const all = tasksOf(p.name).filter((t) => !t.isGroup && t.status !== 'Cancelled');
  const planHours = r2(sum(all, (t) => t.expectedTime));
  const done = planHours ? sum(all, (t) => (+t.expectedTime || 0) * (t.status === 'Completed' ? 1 : Math.min(1, (t.progress || 0) / 100))) / planHours : (p.percentComplete || 0) / 100;
  const tot = projTotals(p);
  const cost = r2(tot.cost + tot.purchase), budget = +p.estimatedCost || 0;
  const rate = gbpRate(p);
  const billedGbp = r2(tot.billed * rate), contractGbp = r2((tot.sales || 0) * rate);
  const margin = r2(billedGbp - cost);
  const stale = all.filter((t) => isOpenTask(t) && (t.progress || 0) >= 95 && t.expEnd && daysBetween(t.expEnd, TODAY) > 30);
  const milestones = all.filter((t) => t.isMilestone && isOpenTask(t)).sort(byEnd).map((t) => ({ t, f: FC.get(t.name), slip: Math.max(0, FC.get(t.name)?.slip || 0) }));
  const overdue = all.filter((t) => t.status === 'Overdue' && !stale.includes(t));
  const overrun = all.filter((t) => isOpenTask(t) && t.status !== 'Overdue' && !stale.includes(t) && +t.expectedTime > 0 && (t.progress || 0) > 0 && taskTotals(t).hours > t.expectedTime * Math.max(0.3, (t.progress || 0) / 100) * 1.25);
  const nextMs = milestones[0] || null;
  const nextPhase = !nextMs ? tasksOf(p.name).filter((t) => t.isGroup && isOpenTask(t)).sort(byEnd)[0] || all.filter((t) => isOpenTask(t) && !stale.includes(t)).sort(byEnd)[0] || null : null;
  return { all, planHours, done, tot, hours: tot.hours, cost, budget, used: budget ? cost / budget : null, costForecast: done > 0.02 ? cost / done : null, hoursForecast: done > 0.02 ? tot.hours / done : null, billedGbp, contractGbp, margin, marginPct: billedGbp ? margin / billedGbp : null, billed: p.billing && p.billing !== 'none', stale, milestones, overdue, overrun, nextMs, nextPhase };
}
const HEALTH_TONE = { 0: 'green', 1: 'orange', 2: 'red' };
const HEALTH_WORD = { 0: 'On track', 1: 'At risk', 2: 'Off track' };
/** The project's health, with the reasons the agent flags. Checked every morning at 07:00 and whenever the plan moves. */
function healthOf(p, FC = forecastAll()) {
  if (p.status === 'Completed') return { level: -1, label: p.actualEnd && p.expectedEnd && p.actualEnd > addDays(p.expectedEnd, 7) ? 'Delivered late' : 'Delivered', tone: 'green', reasons: [], notes: [] };
  if (p.status === 'Cancelled') return { level: -1, label: 'Cancelled', tone: 'gray', reasons: [], notes: [] };
  if (p.status === 'On hold') return { level: -1, label: 'On hold', tone: 'blue', reasons: [], notes: [`On hold since ${fmt.date(p.holdSince)}: nothing is checked until it resumes.`] };
  const m = metricsOf(p, FC);
  const reasons = [], notes = [];
  let level = 0;
  const flag = (lvl, text, href) => { reasons.push({ lvl, text, href }); level = Math.max(level, lvl); };
  const pc = (x) => fmt.pct(x, 0);
  if (m.budget) {
    if (m.cost > m.budget) flag(2, `Cost ${money(m.cost, 'GBP', 0)} is over the ${money(m.budget, 'GBP', 0)} budget`);
    else if (m.done >= 0.25 && m.costForecast > m.budget * 1.1) flag(m.costForecast > m.budget * 1.25 ? 2 : 1, `Cost heads for ${money(m.costForecast, 'GBP', 0)} against a ${money(m.budget, 'GBP', 0)} budget: ${pc(m.used)} spent for ${pc(m.done)} of the work`);
    else if (m.done < 0.25 && m.used > m.done + 0.2) flag(1, `${pc(m.used)} of the ${money(m.budget, 'GBP', 0)} budget is spent for ${pc(m.done)} of the work`);
  }
  if (m.planHours && m.done >= 0.25 && m.hoursForecast > m.planHours * 1.2) flag(m.hoursForecast > m.planHours * 1.5 && m.billed ? 2 : 1, `${fmt.int(m.hours)} h logged against the plan's ${fmt.int(m.planHours)} h, with ${pc(m.done)} of the work done`);
  for (const ms of m.milestones) if (ms.slip > 3) { const why = slipCause(ms.t, FC); flag(ms.slip > 10 ? 2 : 1, `${ms.t.subject} looks ${fmt.plural(ms.slip, 'working day')} late: ${fmt.date(ms.f.end)} against ${fmt.date(ms.t.expEnd)}${why ? '. Held up by ' + why : ''}`, ['task', ms.t.name]); }
  for (const t of m.overdue) { const h0 = taskTotals(t).hours; flag(1, `${t.subject} is ${fmt.plural(Math.max(1, wdBetween(t.expEnd, TODAY)), 'working day')} late${h0 > (t.expectedTime || 0) ? `, ${fmt.int(h0)} h logged of ${fmt.int(t.expectedTime)} h estimated` : ''}`, ['task', t.name]); }
  for (const t of m.overrun) flag(1, `${t.subject} has used ${fmt.int(taskTotals(t).hours)} h of ${fmt.int(t.expectedTime)} h at ${t.progress || 0}% done`, ['task', t.name]);
  if (m.stale.length) notes.push(`${fmt.plural(m.stale.length, 'task')} left at 95% or more for over a month: ${m.stale.map((t) => t.subject).join(', ')}.`);
  return { level, label: HEALTH_WORD[level], tone: HEALTH_TONE[level], reasons, notes, m };
}
const healthPill = (hl, o) => cx.pill(hl.label, hl.tone, o);
const CHECKED_AT = `${TODAY}T07:00:00Z`;

/* ---------- who is free: bookings from open tasks ---------- */

const isStale = (t) => isOpenTask(t) && (t.progress || 0) >= 95 && t.expEnd && daysBetween(t.expEnd, TODAY) > 30;
/** Hours booked per person per working day: the rest of each open task's estimate, spread over its remaining dates. */
function bookings() {
  const m = new Map();
  for (const t of P.tasks) {
    if (t.isGroup || !isOpenTask(t) || isStale(t) || !(t.assignees || []).length || PROJ.get(t.project)?.status !== 'Open') continue;
    const r = r2((+t.expectedTime || 0) * (1 - Math.min(1, (t.progress || 0) / 100))); if (r <= 0) continue;
    const from = !t.expStart || t.expStart < TODAY ? TODAY : t.expStart;
    let days = workdays(from, t.expEnd && t.expEnd >= from ? t.expEnd : from);
    if (days.length < 10 && (!t.expEnd || t.expEnd < TODAY)) days = workdays(from, addDays(from, 13));
    if (!days.length) continue;
    const per = r / days.length / t.assignees.length;
    for (const id of t.assignees) { let pm = m.get(id); if (!pm) m.set(id, (pm = new Map())); for (const d of days) pm.set(d, (pm.get(d) || 0) + per); }
  }
  return m;
}
/** Free hours for project work between two dates, after leave and what is booked. */
function freeHours(id, from, to, B = bookings(), skip = null) {
  let free = 0;
  for (const d of workdays(from, to)) { const cap = capOn(id, d); if (!cap) continue; let b = B.get(id)?.get(d) || 0; if (skip) b -= skip(d); free += Math.max(0, cap - b); }
  return r2(free);
}
const ACT_OF = (id) => { const by = new Map(); for (const l of LOGS) { const t = TSM.get(l.timesheet); if (t?.employee === id) by.set(l.activity, (by.get(l.activity) || 0) + l.hours); } return [...by.entries()].sort((a, b) => b[1] - a[1]); };
const ACTS = new Map();
const actsOf = (id) => { if (!ACTS.has(id)) ACTS.set(id, ACT_OF(id)); return ACTS.get(id); };
const mainActivity = (id) => actsOf(id).find(([a]) => !['Communication', 'Research'].includes(a))?.[0] || actsOf(id)[0]?.[0] || '';
/** Who should take a task: people whose work matches, ranked by the hours they have free in its dates. */
function suggestAssignee(o) {
  const B = bookings();
  const want = o.activity || (o.like ? mainActivity(o.like) : null);
  const words = String(o.subject || '').toLowerCase();
  return TEAM().filter((id) => !(o.exclude || []).includes(id) && focusOf(id) === 1).map((id) => {
    const fit = (want && mainActivity(id) === want ? 2 : 0) + (SKILLS[id] || []).filter((s0) => words.includes(s0.toLowerCase().split(' ')[0])).length + ((o.members || (o.project && PROJ.get(o.project)?.members) || []).includes(id) ? 1 : 0);
    const free = freeHours(id, o.from, o.to, B);
    const off = leavesOf(id, o.from, o.to);
    return { id, fit, free, off, score: fit * 40 + Math.min(free, o.hours || 80) + free / 100 };
  }).filter((x) => x.fit >= 2).sort((a, b) => b.score - a.score);
}
const offText = (id, from, to) => leavesOf(id, from, to).map((a, i) => (i ? leaveText(a).replace(/^off /, '') : leaveText(a))).join(', ');

/* =====================================================================================================
   Styles (tokens only)
   ===================================================================================================== */

cx.style('projects', `
.pj-bar { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.pj-bar .trk { width: 72px; height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; flex: none; }
.pj-bar .trk i { display: block; height: 100%; background: var(--accent); }
.pj-bar.pj-warn .trk i { background: var(--t-orange); }
.pj-port .lv-cell-title { min-width: 190px; }
.pj-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); }
.pj-ov { display: grid; gap: 14px; padding: 16px; min-width: 0; }
.pj-ov-head { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; font-size: 13.5px; }
.pj-ov-head .ms { font-weight: 600; }
.pj-need { display: grid; gap: 0; }
.pj-need a, .pj-need div.row { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 2px; border-bottom: 1px solid var(--line); color: var(--fg); text-decoration: none; font-size: 13px; }
.pj-need a:hover { background: var(--hover); }
@media (max-width: 640px) { .pj-need a, .pj-need div.row { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
.pj-need .why { font-size: 12px; font-weight: 600; }
.pj-need .ttl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pj-need .meta { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.pj-prof { display: grid; gap: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 640px) { .pj-prof { grid-template-columns: minmax(0, 1fr); } }
.pj-prof div { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r); }
.pj-prof small { display: block; color: var(--muted); font-size: 12px; }
.pj-prof b { font-size: 16px; font-variant-numeric: tabular-nums; }
.pj-heat { overflow-x: auto; padding-bottom: 4px; }
.pj-heat svg { display: block; }
.pj-tool { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.pj-tool .grow { flex: 1; }
.pj-tool > * { min-width: 0; max-width: 100%; }
.pj-tool select.ctl { text-overflow: ellipsis; }
.pj-seg { display: inline-flex; }
.pj-seg button { height: 30px; padding: 0 11px; border: 1px solid var(--line); background: var(--surface); color: var(--fg-2); cursor: pointer; font-size: 13px; }
.pj-seg button + button { margin-left: -1px; }
.pj-seg button:first-child { border-radius: var(--r) 0 0 var(--r); }
.pj-seg button:last-child { border-radius: 0 var(--r) var(--r) 0; }
.pj-seg button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); position: relative; font-weight: 600; }
.pj-gantt { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); min-width: 0; position: relative; overflow: hidden; }
.pj-g-body { display: grid; grid-template-columns: var(--lw, 230px) minmax(0, 1fr); min-width: 0; }
@media (max-width: 640px) { .pj-g-body { --lw: 128px; } }
.pj-g-labels { border-right: 1px solid var(--line); min-width: 0; background: var(--surface); }
.pj-g-labels .hd { height: 46px; display: flex; align-items: end; padding: 0 10px 7px; font-size: 11.5px; color: var(--muted); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; border-bottom: 1px solid var(--line); }
.pj-g-labels a { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; color: var(--fg); text-decoration: none; font-size: 12.5px; white-space: nowrap; overflow: hidden; border-bottom: 1px solid var(--chart-grid); }
.pj-g-labels a span { overflow: hidden; text-overflow: ellipsis; }
.pj-g-labels a.grp { font-weight: 600; }
.pj-g-labels a:hover { background: var(--hover); }
.pj-g-scroll { overflow-x: auto; min-width: 0; scrollbar-width: thin; }
.pj-g-scroll svg { display: block; }
.pj-g-scroll text { font: 11px var(--font-ui); fill: var(--muted); }
.pj-g-bar { cursor: grab; }
.pj-g-bar.dragging { cursor: grabbing; opacity: .85; }
.pj-g-scroll g:focus:not(:focus-visible) { outline: none; }
.pj-pop { position: absolute; z-index: 5; width: min(290px, calc(100% - 16px)); background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: 12px; display: grid; gap: 8px; font-size: 13px; }
.pj-pop h4 { font: 600 14px/1.3 var(--font-ui); }
.pj-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 8px 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
.pj-legend span { display: inline-flex; align-items: center; gap: 6px; }
.pj-legend i { width: 14px; height: 8px; border-radius: 2px; display: inline-block; }
.pj-kbc { display: grid; gap: 6px; }
.pj-kbc .sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pj-kbc .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.pj-kbc .row .grow { flex: 1; }
.pj-kbc .late { color: var(--neg); font-weight: 600; }
.pj-timer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 10px 12px; border-radius: var(--r); background: var(--accent-soft); color: var(--fg); }
.pj-timer .clock { font: 600 20px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--accent); }
.pj-timer .grow { flex: 1; }
.pj-inv { display: grid; gap: 12px; }
.pj-cost { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 900px) { .pj-cost { grid-template-columns: minmax(0, 1fr); } }
.pj-cost .box { border: 1px solid var(--line); border-radius: var(--r); padding: 12px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.pj-cost .box h4 { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
.pj-cost .big { font: 600 20px/1.2 var(--font-ui); font-variant-numeric: tabular-nums; }
.pj-health { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; }
.pj-health::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.pj-mem { display: inline-flex; align-items: center; }
.pj-mem .avatar { box-shadow: 0 0 0 2px var(--surface); }
.pj-mem .avatar + .avatar { margin-left: -6px; }
.pj-sum { display: grid; gap: 2px; font-size: 12.5px; color: var(--muted); }
.pj-delay { color: var(--neg); font-weight: 600; }
.pj-ontrack { height: 26px; display: flex; border-radius: var(--r); overflow: hidden; font-size: 12px; font-weight: 600; color: var(--surface); }
.pj-ontrack div { display: flex; align-items: center; padding: 0 10px; min-width: 0; white-space: nowrap; overflow: hidden; }
.pj-hl { display: grid; gap: 0; }
.pj-hl > a, .pj-hl > div { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px 2px; border-bottom: 1px solid var(--line); color: var(--fg); text-decoration: none; font-size: 13px; line-height: 1.45; }
.pj-hl > a:hover { background: var(--hover); }
.pj-hl > :last-child { border-bottom: 0; }
.pj-hl i { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: currentColor; }
.pj-hl .note { color: var(--muted); }
.pj-hhead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding-bottom: 6px; }
.pj-hhead .muted { font-size: 12.5px; }
.pj-src { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.pj-src .ic { width: 13px; height: 13px; }
.pj-note { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
.pj-cell { display: inline-block; min-width: 50px; padding: 3px 6px; border-radius: 4px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.pj-cell.l0 { background: var(--sunk); color: var(--muted); }
.pj-cell.l1 { background: var(--t-green-bg); color: var(--t-green); }
.pj-cell.l2 { background: var(--t-yellow-bg); color: var(--t-yellow); }
.pj-cell.l3 { background: var(--t-red-bg); color: var(--t-red); }
.pj-cell.off { background: var(--t-purple-bg); color: var(--t-purple); }
.pj-mini { display: inline-flex; height: 8px; width: 120px; border-radius: 4px; overflow: hidden; background: var(--sunk); vertical-align: middle; }
.pj-mini i { display: block; height: 100%; }
.pj-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pj-upd { display: grid; gap: 0; }
.pj-upd details { border-bottom: 1px solid var(--line); }
.pj-upd details:last-child { border-bottom: 0; }
.pj-upd summary { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; padding: 9px 2px; cursor: pointer; font-size: 13px; }
.pj-upd summary b { font-weight: 600; }
.pj-upd .body { padding: 2px 2px 12px 18px; display: grid; gap: 6px; font-size: 13px; line-height: 1.5; }
.pj-plan-head { display: grid; gap: 4px; font-size: 13px; line-height: 1.5; }
`);

/* =====================================================================================================
   Workspace and search
   ===================================================================================================== */

const myOpenTasks = () => P.tasks.filter((t) => (t.assignees || []).includes(cx.meId()) && ['Open', 'Working', 'Overdue', 'Pending Review'].includes(t.status) && !t.isGroup).length;
cx.workspace({
  id: 'projects', label: 'Projects', icon: 'projects', route: 'projects-home',
  badge: () => myOpenTasks() || null,
  nav: [
    { label: 'Home', route: 'projects-home' },
    { label: 'Portfolio', route: 'projects-portfolio' },
    { label: 'Projects', route: 'projects', match: ['project'] },
    { label: 'Resources', route: 'project-resources' },
    { label: 'Tasks', route: 'tasks', match: ['task', 'tasks-kanban', 'tasks-gantt', 'tasks-tree'] },
    { label: 'Timesheets', route: 'timesheets', match: ['timesheet'] },
    { section: 'Reports', items: [
      { label: 'Project summary', route: 'project-summary' },
      { label: 'Project billing summary', route: 'timesheet-billing', match: ['project-billing'] },
      { label: 'Daily timesheet summary', route: 'daily-timesheets' },
      { label: 'Delayed tasks summary', route: 'delayed-tasks' },
    ] },
    { section: 'Setup', collapsed: true, items: [
      { label: 'Activity types', route: 'activity-types', match: ['activity-type'] },
      { label: 'Project types', route: 'project-types' },
      { label: 'Projects options', route: 'projects-config' },
    ] },
  ],
});
cx.search.add((qq, limit) => {
  const t = qq.toLowerCase();
  const out = [];
  const take = (arr, f) => { let n = 0; for (const x of arr) { if (n >= limit) break; const r = f(x); if (r) { out.push(r); n++; } } };
  take(P.projects, (p) => (`${p.projectName} ${p.name} ${custName(p.customer)}`.toLowerCase().includes(t) ? { kind: 'Projects', label: `${p.projectName}`, sub: `${p.name} · ${projStatusText(p)}${p.customer ? ' · ' + custName(p.customer) : ''}`, route: 'project', id: p.name, icon: 'projects' } : null));
  take(P.tasks, (k) => (`${k.subject} ${k.name}`.toLowerCase().includes(t) ? { kind: 'Project tasks', label: k.subject, sub: `${k.name} · ${k.status} · ${projName(k.project)}`, route: 'task', id: k.name, icon: 'task' } : null));
  take([...P.timesheets].reverse(), (ts) => (`${ts.name} ${cx.name(ts.employee)}`.toLowerCase().includes(t) ? { kind: 'Timesheets', label: `${ts.name} · ${cx.name(ts.employee)}`, sub: `${fmt.date(ts.startDate)} · ${tsInfo(ts).status} · ${fmt.hours(tsInfo(ts).hours)}`, route: 'timesheet', id: ts.name, icon: 'clock' } : null));
  return out;
});

/* =====================================================================================================
   The workspace
   ===================================================================================================== */

const QSTART = (() => { const m = +TODAY.slice(5, 7); const qm = m - ((m - 1) % 3); return `${TODAY.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`; })();
const projCurrency = (p) => p?.currency || 'GBP';
function unbilledByProject() {
  const m = new Map();
  for (const l of unbilledOf(null)) { const p = PROJ.get(l.project); if (!p) continue; const o = m.get(p.name) || { p, hours: 0, amount: 0 }; o.hours += l.hours; o.amount += l.billingAmount; m.set(p.name, o); }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}
/** Hours logged by a person between two dates, against what they could have worked (leave and bank holidays out). */
function utilOf(id, from, to) {
  const out = { hours: 0, billable: 0, byProject: new Map() };
  for (const l of LOGS) {
    if (l.date < from || l.date > to) continue;
    const t = TSM.get(l.timesheet); if (!t || t.employee !== id || t.status === 'Cancelled') continue;
    out.hours += l.hours; if (l.billable) out.billable += l.hours;
    out.byProject.set(l.project || '', (out.byProject.get(l.project || '') || 0) + l.hours);
  }
  out.cap = workdays(from, to).filter((d) => !leaveOn(id, d)).length * DAY_H;
  out.util = out.cap ? out.hours / out.cap : 0; out.billUtil = out.cap ? out.billable / out.cap : 0;
  return out;
}
const LAST4 = { from: addDays(WEEK0, -28), to: addDays(WEEK0, -3) };
cx.route('projects-home', () => {
  const open = P.projects.filter((p) => p.status === 'Open');
  const nonDone = P.tasks.filter((t) => ['Open', 'Working', 'Overdue'].includes(t.status) && !t.isGroup);
  const unb = unbilledByProject();
  const FC = forecastAll();
  const hs = open.map((p) => ({ p, hl: healthOf(p, FC) }));
  const off = hs.filter((x) => x.hl.level === 2), risk = hs.filter((x) => x.hl.level === 1);
  const team = TEAM();
  const u = team.map((id) => utilOf(id, LAST4.from, LAST4.to));
  const cap = sum(u, (x) => x.cap), logged = sum(u, (x) => x.hours), billable = sum(u, (x) => x.billable);
  const mine = P.tasks.filter((t) => (t.assignees || []).includes(cx.meId()) && isOpenTask(t) && !t.isGroup).sort((a, b) => String(a.expEnd).localeCompare(String(b.expEnd)));
  const attention = hs.filter((x) => x.hl.reasons.length).sort((a, b) => b.hl.level - a.hl.level).flatMap((x) => x.hl.reasons.filter((r) => r.lvl >= 1).slice(0, 2).map((r) => ({ label: r.text, sub: `${x.p.projectName} · ${x.hl.label}`, route: r.href ? r.href[0] : 'project', id: r.href ? r.href[1] : x.p.name })));
  const ext = open.filter((p) => p.projectType === 'External' || p.estimatedCost);
  return cx.workspacePage({
    title: 'Projects', workspace: 'projects',
    actions: [cx.btn('Portfolio', { icon: 'chart', href: ['projects-portfolio'] }), cx.btn('Project', { icon: 'plus', kind: 'primary', needs: PM, onClick: () => newProjectModal() })],
    cards: [
      { label: 'Open projects', value: fmt.int(open.length), sub: `${off.length} off track · ${risk.length} at risk · ${P.projects.filter((p) => p.status === 'On hold').length} on hold`, href: ['projects-portfolio'] },
      { label: 'Billable time', value: fmt.pct(cap ? billable / cap : 0, 0), sub: `of working hours in the last four weeks; ${fmt.pct(cap ? logged / cap : 0, 0)} logged in all`, href: ['project-resources'] },
      { label: 'Non completed tasks', value: fmt.int(nonDone.length), sub: `${nonDone.filter((t) => t.status === 'Overdue').length} overdue`, href: ['tasks'] },
      { label: 'Unbilled time', value: unb.length ? unb.map((x) => fmt.compact(x.amount, projCurrency(x.p))).join(' + ') : '—', sub: unb.length ? `${fmt.num(sum(unb, (x) => x.hours), 1)} billable hours on submitted timesheets` : 'every billable hour is invoiced', href: ['timesheet-billing'] },
    ],
    charts: [{ title: 'Budget used against work done', wide: true, node: cx.chart.bar({ labels: ext.map((p) => p.projectName), height: 230, format: (v) => v + '%', tipFormat: (v) => v + '%', series: [{ name: 'Work done', values: ext.map((p) => Math.round(metricsOf(p, FC).done * 100)), color: '1' }, { name: 'Budget used', values: ext.map((p) => Math.round((metricsOf(p, FC).used || 0) * 100)), color: '3' }], onClick: (i) => cx.go('project', ext[i]?.name) }) }],
    shortcuts: [
      { label: 'Portfolio', route: 'projects-portfolio', count: off.length + risk.length || null, tone: 'orange', icon: 'chart' },
      { label: 'Resources', route: 'project-resources', icon: 'user' },
      { label: 'Task', route: 'tasks', count: nonDone.length, tone: 'orange', icon: 'task' },
      { label: 'Timesheet', route: 'timesheets', count: P.timesheets.filter((t) => t.status === 'Draft').length, tone: 'red', icon: 'clock' },
      { label: 'Gantt chart', route: 'tasks-gantt', icon: 'chart' },
      { label: 'Project billing summary', route: 'timesheet-billing', icon: 'report' },
    ],
    quick: [
      { title: 'Needs attention', items: attention.length ? attention.slice(0, 7) : [{ label: 'Every open project is on track' }] },
      { title: 'Unbilled time by project', items: unb.length ? unb.map((x) => ({ label: x.p.projectName, sub: `${x.p.name} · ${fmt.num(x.hours, 1)} h · ${custName(x.p.customer)}`, right: money(x.amount, projCurrency(x.p)), route: 'project', id: x.p.name })) : [{ label: 'Nothing waits to be billed' }] },
      { title: `${cx.firstName(cx.meId())}'s open tasks`, items: mine.length ? mine.slice(0, 7).map((t) => ({ label: t.subject, sub: `${projName(t.project)} · ${t.status}`, right: t.expEnd ? fmt.day(t.expEnd) : '', route: 'task', id: t.name })) : [{ label: 'No open tasks assigned to you' }] },
    ],
    links: [
      { title: 'Views', items: [{ label: 'Portfolio', route: 'projects-portfolio', count: P.projects.length }, { label: 'Resources', route: 'project-resources', count: team.length }, { label: 'Gantt chart', route: 'tasks-gantt' }, { label: 'Task status board', route: 'tasks-kanban' }] },
      { title: 'Reports', items: [{ label: 'Project summary', route: 'project-summary', kind: 'report' }, { label: 'Project billing summary', route: 'timesheet-billing', kind: 'report' }, { label: 'Daily timesheet summary', route: 'daily-timesheets', kind: 'report' }, { label: 'Delayed tasks summary', route: 'delayed-tasks', kind: 'report' }] },
      { title: 'Setup', items: [{ label: 'Activity types', route: 'activity-types', count: P.activityTypes.length }, { label: 'Project types', route: 'project-types', count: P.projectTypes.length }, { label: 'Projects options', route: 'projects-config' }] },
    ],
    fde: 'The Projects workspace',
  });
}, { workspace: 'projects', title: 'Projects' });

/* =====================================================================================================
   Portfolio and resources
   ===================================================================================================== */

const budgetBar = (m) => {
  if (!m.budget) return h('span.faint', 'No budget');
  const used = m.used || 0, warn = used > m.done + 0.15;
  return h('span.pj-bar', { class: { 'pj-warn': warn }, title: `${money(m.cost, 'GBP', 0)} of ${money(m.budget, 'GBP', 0)} · ${fmt.pct(m.done, 0)} of the work done` }, h('span.trk', h('i', { style: { width: Math.min(100, used * 100) + '%' } })), h('span.num', fmt.pct(used, 0)));
};
const marginCell = (p, m) => (!m.billed ? h('span.faint', 'Not billed') : h('span', { style: `color:var(${m.margin >= 0 ? '--pos' : '--neg'})` }, money(m.margin, 'GBP', 0), m.marginPct != null ? h('span.muted', ` · ${fmt.pct(m.marginPct, 0)}`) : null));
const msCell = (p, m) => {
  if (['Completed', 'Cancelled'].includes(p.status)) return h('span.muted', p.actualEnd ? `Ended ${fmt.date(p.actualEnd)}` : p.status);
  const x = m.nextMs; if (!x) return m.nextPhase ? h('span', m.nextPhase.subject, h('span.muted', ` · ${fmt.day(m.nextPhase.expEnd)}`)) : h('span.faint', '—');
  return h('span', { title: x.slip > 3 ? `Forecast ${fmt.date(x.f.end)}` : '' }, cx.link(x.t.subject, 'task', x.t.name), h('span.muted', ` · ${fmt.day(x.t.expEnd)}`), x.slip > 3 ? h('span', { style: 'color:var(--neg);font-weight:600' }, ` · +${x.slip} d`) : null);
};
const HEALTH_ORDER = { 'Off track': 0, 'At risk': 1, 'On track': 2, 'On hold': 3, Delivered: 4, 'Delivered late': 4, Cancelled: 5 };
cx.route('projects-portfolio', () => {
  const FC = forecastAll();
  const rows = P.projects.map((p) => { const hl = healthOf(p, FC); return { p, hl, m: hl.m || metricsOf(p, FC) }; });
  const live = rows.filter((r) => ['Open', 'On hold'].includes(r.p.status));
  const contract = sum(live, (r) => r.m.contractGbp), billed = sum(live, (r) => r.m.billedGbp);
  const margin = sum(rows.filter((r) => r.m.billed), (r) => r.m.margin), billedAll = sum(rows.filter((r) => r.m.billed), (r) => r.m.billedGbp);
  return cx.page({
    title: 'Portfolio', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    sub: `Every project's health, budget, margin and next milestone. The project agent checks them each morning at 07:00 and whenever a plan moves.`,
    actions: [cx.btn('Resources', { icon: 'user', href: ['project-resources'] }), cx.btn('Add project', { kind: 'primary', icon: 'plus', needs: PM, onClick: () => newProjectModal() })],
    fde: 'The projects portfolio',
    body: [
      h('div.ncards', cx.numberCard({ label: 'Running', value: fmt.int(live.length), sub: `${live.filter((r) => r.hl.level === 2).length} off track · ${live.filter((r) => r.hl.level === 1).length} at risk` }),
        cx.numberCard({ label: 'Contract value running', value: fmt.compact(contract, 'GBP'), sub: `${fmt.compact(billed, 'GBP')} billed so far (${fmt.pct(contract ? billed / contract : 0, 0)})` }),
        cx.numberCard({ label: 'Margin to date', value: money(margin, 'GBP', 0), sub: `${fmt.pct(billedAll ? margin / billedAll : 0, 0)} of everything billed, after labour and purchases`, color: margin >= 0 ? null : 'neg' }),
        cx.numberCard({ label: 'Delivered', value: fmt.int(rows.filter((r) => r.p.status === 'Completed').length), sub: `${rows.filter((r) => r.hl.label === 'Delivered late').length} more than a week late` })),
      h('div.pj-port', cx.listView({
        key: 'pj-portfolio', rows: () => rows, id: (r) => r.p.name, showId: false, selectable: false, strip: false,
        titleCol: { key: 'name', label: 'Project', get: (r) => r.p.projectName, sub: (r) => `${r.p.customer ? custName(r.p.customer) : r.p.projectType} · ${['Completed', 'Cancelled'].includes(r.p.status) ? 'ended ' + fmt.date(r.p.actualEnd || r.p.expectedEnd) : 'ends ' + fmt.date(r.p.expectedEnd)}` },
        status: (r) => healthPill(r.hl),
        columns: [
          { key: 'lead', label: 'Lead', get: (r) => leadOf(r.p), type: 'person' },
          { key: 'done', label: 'Work done', get: (r) => Math.round(r.m.done * 100), render: (r) => pctBar(r.p.status === 'Completed' ? 100 : r.m.done * 100) },
          { key: 'used', label: 'Budget used', get: (r) => Math.round((r.m.used || 0) * 100), render: (r) => budgetBar(r.m), keep: true },
          { key: 'margin', label: 'Margin to date', get: (r) => (r.m.billed ? r.m.margin : null), render: (r) => marginCell(r.p, r.m) },
          { key: 'ms', label: 'Next milestone', get: (r) => r.m.nextMs?.t.expEnd || '', render: (r) => msCell(r.p, r.m) },
        ],
        filters: [{ key: 'health', label: 'Health', type: 'select', get: (r) => r.hl.label, options: ['Off track', 'At risk', 'On track', 'On hold', 'Delivered', 'Delivered late'] }, { key: 'lead', label: 'Lead', type: 'person', get: (r) => leadOf(r.p), options: () => uniq(P.projects.map(leadOf)) }],
        tabs: [{ label: 'Running', filter: (r) => ['Open', 'On hold'].includes(r.p.status) }, { label: 'Delivered', filter: (r) => r.p.status === 'Completed' }, { label: 'All' }],
        sort: { options: [{ key: 'health', label: 'Health', get: (r) => HEALTH_ORDER[r.hl.label] ?? 9 }, { key: 'end', label: 'Expected end', get: (r) => r.p.expectedEnd }, { key: 'used', label: 'Budget used', get: (r) => r.m.used || 0 }], default: { key: 'health', dir: 'asc' } },
        groupBy: [{ key: 'health', label: 'Health', get: (r) => r.hl.label }, { key: 'lead', label: 'Lead', type: 'person', get: (r) => leadOf(r.p) }],
        href: (r) => ['project', r.p.name],
        noun: 'project', empty: 'No projects match.',
      })),
    ],
  });
}, { workspace: 'projects', title: 'Portfolio' });

const WEEKS_AHEAD = 6;
cx.route('project-resources', () => {
  const B = bookings();
  const team = TEAM();
  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => addDays(WEEK0, i * 7));
  const rows = team.map((id) => {
    const u = utilOf(id, LAST4.from, LAST4.to);
    const on = uniq(P.tasks.filter((t) => isOpenTask(t) && !t.isGroup && (t.assignees || []).includes(id)).map((t) => t.project));
    const wk = weeks.map((w) => {
      const days = workdays(w, addDays(w, 4));
      const offD = days.filter((d) => leaveOn(id, d)).length;
      const cap = sum(days, (d) => capOn(id, d));
      const booked = sum(days, (d) => B.get(id)?.get(d) || 0);
      return { w, offD, cap, booked, pct: cap ? booked / cap : null, days: days.length };
    });
    return { id, u, on, wk, lv: leavesOf(id, TODAY, addDays(WEEK0, WEEKS_AHEAD * 7)) };
  });
  const cell = (x) => {
    if (!x.days) return h('span.pj-cell.l0', 'Holiday');
    if (x.offD >= x.days) return h('span.pj-cell.off', { title: 'On leave all week' }, 'Off');
    const v = x.pct || 0, cls = v < 0.5 ? 'l0' : v <= 0.9 ? 'l1' : v <= 1.1 ? 'l2' : 'l3';
    return h('span', { class: `pj-cell ${cls}`, title: `${fmt.hours(r2(x.booked))} booked of ${fmt.hours(r2(x.cap))} for project tasks${x.offD ? `; ${fmt.plural(x.offD, 'day')} off` : ''}` }, fmt.pct(v, 0), x.offD ? h('span', { style: 'display:block;font-size:10.5px;color:var(--t-purple)' }, `${x.offD} d off`) : null);
  };
  const projColor = new Map(P.projects.filter((p) => ['Open', 'On hold'].includes(p.status)).map((p, i) => [p.name, `var(--chart-${(i % 6) + 1})`]));
  const split = (u) => h('span.pj-mini', { title: [...u.byProject.entries()].map(([k, v]) => `${projName(k) || 'No project'}: ${fmt.hours(r2(v))}`).join('\n') }, [...u.byProject.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('i', { style: { width: (u.cap ? Math.min(100, (v / u.cap) * 100) : 0) + '%', background: projColor.get(k) || 'var(--faint)' } })));
  const avgU = sum(rows, (r) => r.u.hours) / Math.max(1, sum(rows, (r) => r.u.cap));
  const avgB = sum(rows, (r) => r.u.billable) / Math.max(1, sum(rows, (r) => r.u.cap));
  const offSoon = rows.filter((r) => r.lv.length);
  const tbl = h('div.tbl-scroll', h('table.tbl.pj-res',
    h('thead', h('tr', h('th', 'Person'), h('th.opt', 'Skills'), h('th', 'Last four weeks'), h('th.opt', 'On'), weeks.map((w) => h('th', { style: 'text-align:center' }, `w/c ${fmt.day(w)}`)))),
    h('tbody', rows.map((r) => h('tr',
      h('td', cx.personChip(r.id), h('div.muted', { style: 'font-size:12px' }, cx.person(r.id)?.designation || '')),
      h('td.opt.wrap', { style: 'min-width:150px' }, h('div.pj-chips', [mainActivity(r.id), ...(SKILLS[r.id] || [])].filter(Boolean).slice(0, 3).map((x) => cx.tag(x)))),
      h('td', h('div', { style: 'display:grid;gap:4px' }, split(r.u), h('span.muted', { style: 'font-size:12px' }, `${fmt.pct(r.u.util, 0)} logged · ${fmt.pct(r.u.billUtil, 0)} billable`))),
      h('td.opt.wrap', { style: 'min-width:140px' }, r.on.length ? h('div.pj-chips', r.on.map((pn) => cx.link(projName(pn), 'project', pn))) : h('span.faint', 'No open tasks')),
      r.wk.map((x) => h('td', { style: 'text-align:center' }, cell(x))))))));
  return cx.page({
    title: 'Resources', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    sub: 'Who is on what, how much of their time went on project work, and what is booked for the next six weeks. Leave comes from HR; bank holidays from the holiday list.',
    actions: [cx.btn('Portfolio', { icon: 'chart', href: ['projects-portfolio'] })],
    fde: 'The resource view: who is on what',
    body: [
      h('div.ncards', cx.numberCard({ label: 'People on projects', value: fmt.int(rows.length), sub: `${rows.filter((r) => r.on.length).length} with open tasks` }),
        cx.numberCard({ label: 'Logged', value: fmt.pct(avgU, 0), sub: `of working hours, ${fmt.date(LAST4.from)} to ${fmt.date(LAST4.to)}` }),
        cx.numberCard({ label: 'Billable', value: fmt.pct(avgB, 0), sub: 'of working hours, on client projects' }),
        cx.numberCard({ label: 'Leave in the next six weeks', value: fmt.int(offSoon.length), sub: (() => { const long = LEAVES.filter((a) => a.leaveType !== 'Annual Leave' && a.leaveType !== 'Sick Leave' && a.toDate >= TODAY && a.fromDate <= addDays(WEEK0, WEEKS_AHEAD * 7)).sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0]; return long ? `people off, including ${cx.name(long.employee)}: ${leaveText(long)}` : offSoon.length ? 'people with leave booked or asked for' : 'Nobody is off'; })() })),
      cx.card({ title: 'Who is on what', flush: true, body: tbl, foot: h('div.pj-legend', { style: 'border:0;padding:0' }, h('span', h('i', { style: { background: 'var(--t-green-bg)' } }), 'Booked 50 to 90%'), h('span', h('i', { style: { background: 'var(--t-yellow-bg)' } }), '90 to 110%'), h('span', h('i', { style: { background: 'var(--t-red-bg)' } }), 'Over 110%'), h('span', h('i', { style: { background: 'var(--t-purple-bg)' } }), 'On leave'), h('span', 'Booked hours are what is left of each open task, spread over its dates. Leads and managers give half their day to tasks.')) }),
      offSoon.length ? cx.card({ title: 'Leave in the next six weeks', body: h('div.pj-hl', offSoon.map((r) => { const hit = uniq(r.lv.flatMap((a) => P.tasks.filter((t) => isOpenTask(t) && !t.isGroup && !isStale(t) && (t.assignees || []).includes(r.id) && t.expEnd >= a.fromDate && t.expStart <= a.toDate).map((t) => t.subject))); const asked = r.lv.some((a) => a.status === 'Open'); return h('div', h('i', { style: `color:var(--t-${asked ? 'orange' : 'purple'})` }), h('span', h('b', cx.name(r.id)), ` ${r.lv.map((a, i) => (i ? leaveText(a).replace(/^off /, '') : leaveText(a))).join(', ')}`, hit.length ? h('span.muted', ` · overlaps ${hit.slice(0, 3).join(', ')}`) : null)); })) }) : null,
    ],
  });
}, { workspace: 'projects', title: 'Resources' });

/* =====================================================================================================
   Projects: the list, a new project, the project's verbs
   ===================================================================================================== */

const pctBar = (v, warn) => h('span.pj-bar', { class: { 'pj-warn': warn } }, h('span.trk', h('i', { style: { width: Math.max(0, Math.min(100, v || 0)) + '%' } })), h('span.num', `${Math.round(v || 0)}%`));
const deptOpts = () => D.departments.map((d) => [d.id, d.name]);
const lc = (v) => String(v).toLowerCase().replace(/ /g, '-');
cx.route('projects', (ctx) => { const FC = forecastAll(); return cx.page({
  title: 'Projects', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
  actions: [cx.btn('Add project', { kind: 'primary', icon: 'plus', needs: PM, cmd: 'capxul org projects create "<name>" --type External --start … --end …', onClick: () => newProjectModal() })],
  fde: 'The list of projects',
  body: cx.listView({
    key: 'pj-projects', rows: () => P.projects, id: (p) => p.name,
    titleCol: { key: 'projectName', label: 'Project name', sub: (p) => (p.customer ? custName(p.customer) : `${p.projectType} · ${cx.deptName(p.department)}`) },
    status: (p) => projPill(p),
    columns: [{ key: 'health', label: 'Health', get: (p) => healthOf(p, FC).label, render: (p) => { const hl = healthOf(p, FC); return hl.level >= 0 ? healthPill(hl) : h('span.faint', '—'); } }, { key: 'lead', label: 'Lead', get: (p) => leadOf(p), type: 'person' }, { key: 'projectType', label: 'Project type' }, { key: 'percentComplete', label: '% completed', render: (p) => pctBar(p.percentComplete), keep: true }, { key: 'expectedStart', label: 'Expected start', type: 'date' }, { key: 'expectedEnd', label: 'Expected end', type: 'date' }, { key: 'estimatedCost', label: 'Estimated cost', type: 'currency', currency: 'GBP' }, { key: 'customerName', label: 'Customer', get: (p) => custName(p.customer) }],
    filters: [{ key: 'name', label: 'ID' }, { key: 'status', label: 'Status', type: 'select', options: ['Open', 'On hold', 'Completed', 'Cancelled'], default: 'Open' }, { key: 'projectType', label: 'Project type', type: 'select', options: () => P.projectTypes.map((t) => t.name) }, { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] }, { key: 'customer', label: 'Customer', type: 'select', options: () => uniq(P.projects.map((p) => p.customer)).map((id) => [id, custName(id)]) }],
    sort: { options: [{ key: 'expectedStart', label: 'Expected start' }, { key: 'expectedEnd', label: 'Expected end' }, { key: 'percentComplete', label: '% completed' }, { key: 'name', label: 'ID' }], default: { key: 'expectedStart', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'projectType', label: 'Project type' }, { key: 'department', label: 'Department', format: (v) => cx.deptName(v) }, { key: 'priority', label: 'Priority' }],
    href: (p) => ['project', p.name],
    cmd: (st) => { const f = st.filters; const parts = [f.status ? `--status ${lc(f.status)}` : null, f.projectType ? `--type ${q(f.projectType)}` : null, f.customer ? `--customer ${q(custName(f.customer))}` : null].filter(Boolean); return { cli: `capxul org projects list${parts.length ? ' ' + parts.join(' ') : ''}`, sdk: `client.org(orgId).projects.list(${parts.length ? `{ ${[f.status ? `status: "${lc(f.status)}"` : null, f.projectType ? `type: "${f.projectType}"` : null, f.customer ? `customer: "${custName(f.customer)}"` : null].filter(Boolean).join(', ')} }` : ''})` }; },
    noun: 'project',
  }),
}); }, { workspace: 'projects', title: 'Projects' });

/** A dialog of fields (the same shape the CRM uses). Its command is kept as data for the AI's side; nothing draws it. */
function formModal(o) {
  const m = o.model;
  const drawCmd = () => {};
  const mk = (f) => {
    if (!f) return null;
    if (f instanceof Node) return f;
    if (f.section) return h('div', { style: 'grid-column:1/-1;font:600 12px/1.3 var(--font-ui);letter-spacing:.05em;text-transform:uppercase;color:var(--faint);padding-top:4px' }, f.section);
    if (f.node) return h('div.field', { class: { wide: f.wide } }, h('label', f.label), f.node);
    return cx.field({ ...f, model: m, edit: !f.readOnly, onChange: (v) => { f.onChange?.(v, m); drawCmd(); } });
  };
  const body = h('div', { style: 'display:grid;gap:14px' },
    o.intro ? (o.intro instanceof Node ? o.intro : h('p.muted', { style: 'font-size:13px' }, o.intro)) : null,
    h('div.fields', { style: { '--cols': o.cols || 2 } }, o.fields.map(mk)),
    o.extra || null);
  const md = cx.modal({ title: o.title, wide: o.wide, body, onClose: () => cx.clearAction(),
    actions: [cx.btn('Cancel', { onClick: () => md.close() }), cx.btn(o.submit || 'Save', { kind: 'primary', needs: o.needs, onClick: async () => {
      for (const f of o.fields) if (f && f.reqd && !f.readOnly && f.key && (m[f.key] == null || m[f.key] === '')) { cx.toast(`${f.label} is required.`, { tone: 'warning' }); return; }
      const err = o.check?.(m); if (err) { cx.toast(err, { tone: 'warning' }); return; }
      await o.onSubmit(m, () => md.close(), o.cmd?.(m));
    } })] });
  md.redraw = drawCmd;
  return md;
}
function newProjectModal() {
  const m = { projectName: '', status: 'Open', projectType: 'External', percentCompleteMethod: 'Task Completion', priority: 'Medium', department: 'delivery', expectedStart: TODAY, expectedEnd: addDays(TODAY, 90), customer: '', estimatedCost: '', notes: '' };
  formModal({ title: 'New project', model: m, needs: PM, submit: 'Create', who: 'whoever wears the People hat, or a Director', wide: true,
    fields: [
      { label: 'Project name', key: 'projectName', reqd: true, wide: true, placeholder: 'Saltmarsh subscription boxes' },
      { label: 'Project type', key: 'projectType', type: 'select', options: P.projectTypes.map((t) => t.name) }, { label: '% complete method', key: 'percentCompleteMethod', type: 'select', options: ['Manual', 'Task Completion', 'Task Progress', 'Task Weight'] },
      { label: 'Priority', key: 'priority', type: 'select', options: ['Low', 'Medium', 'High'] }, { label: 'Department', key: 'department', type: 'select', options: deptOpts() },
      { label: 'Expected start date', key: 'expectedStart', type: 'date' }, { label: 'Expected end date', key: 'expectedEnd', type: 'date' },
      { label: 'Customer', key: 'customer', type: 'select', options: [['', '—'], ...(D.books.customers || []).map((c) => [c.id, c.name])] }, { label: 'Estimated cost', key: 'estimatedCost', type: 'currency' },
      { label: 'Notes', key: 'notes', type: 'textarea', wide: true },
    ],
    cmd: (x) => `capxul org projects create ${q(x.projectName || '<name>')} --type ${q(x.projectType)} --priority ${x.priority.toLowerCase()} --start ${x.expectedStart} --end ${x.expectedEnd}${x.customer ? ` --customer ${q(custName(x.customer))}` : ''} --progress ${lc(x.percentCompleteMethod)} --department ${x.department}${x.estimatedCost ? ` --estimated-cost ${x.estimatedCost}` : ''}${x.notes ? ` --notes ${q(x.notes)}` : ''}`,
    check: (x) => (x.expectedEnd < x.expectedStart ? 'The expected end comes before the start.' : null),
    onSubmit: (x, close, cmd) => {
      const name = nextName('PROJ-', P.projects.map((p) => p.name), 4);
      const cust = x.customer ? CUSTOMERS.get(x.customer) : null;
      const p = { name, projectName: x.projectName, status: 'Open', projectType: x.projectType, customer: x.customer || null, department: x.department, priority: x.priority, percentCompleteMethod: x.percentCompleteMethod, expectedStart: x.expectedStart, expectedEnd: x.expectedEnd, estimatedCost: x.estimatedCost ? +x.estimatedCost : 0, costCenter: cx.deptName(x.department), billing: x.customer ? 'tm' : 'none', members: [cx.meId()], notes: x.notes || null, holdSince: null, percentComplete: 0, actualStart: null, actualEnd: null, actualTime: 0, totalCostingAmount: 0, totalBillableAmount: 0, currency: cust?.currency === 'USD' ? 'USD' : 'GBP', totalBilledAmount: 0, totalSalesAmount: null, totalPurchaseCost: 0, grossMargin: 0, grossMarginPercent: 0, salesInvoices: [], timesheetCount: 0, taskCount: 0, createdAt: NOW(), createdBy: cx.meId(), history: [{ at: NOW(), who: cx.meId(), kind: 'created', text: 'created the project' }] };
      P.projects.push(p); PROJ.set(name, p); BASE.set(name, { cost: 0, billable: 0, billed: 0, hours: 0 });
      close(); cx.toast(`Created ${name}: ${p.projectName}`, { tone: 'success', cmd }); cx.go('project', name);
    } });
}
async function projectVerb(p, verb) {
  const cmd = `capxul org projects ${verb} ${p.name}`;
  const allow = cx.allowed(PM); if (!allow.ok) { cx.toast(allow.reason, { tone: 'warning' }); return; }
  if (verb === 'complete') {
    const open = tasksOf(p.name).filter((t) => isOpenTask(t) && !t.isGroup);
    if (open.length) { cx.toast(`Not yet: ${fmt.plural(open.length, 'task')} still open (${open.slice(0, 3).map((t) => t.subject).join(', ')}${open.length > 3 ? '…' : ''}). A project completes when every task is completed or cancelled.`, { tone: 'warning', cmd }); return; }
  }
  const words = { complete: ['Completed', 'Complete the project', 'It moves to Completed. Reopen brings it back.'], cancel: ['Cancelled', 'Cancel the project', 'It is kept, as Cancelled. Its timesheets and invoices stay as they are.'], hold: ['On hold', 'Put it on hold', 'Its percent complete no longer moves its status until it resumes.'], resume: ['Open', 'Resume it', 'On hold becomes Open.'], reopen: ['Open', 'Reopen it', 'It becomes Open again.'] }[verb];
  if (!(await cx.confirm({ title: `${words[1]}: ${p.projectName}?`, body: words[2], cmd, who: 'whoever wears the People hat, or a Director', confirmLabel: words[1], cancelLabel: 'Back', danger: verb === 'cancel' }))) return;
  const from = p.status; p.status = words[0];
  if (verb === 'hold') p.holdSince = TODAY; if (verb === 'resume') p.holdSince = null;
  if (verb === 'complete') p.actualEnd = p.actualEnd || TODAY;
  (p.history ||= []).push({ at: NOW(), who: cx.meId(), kind: 'status', text: `changed the status from ${from} to ${p.status}` });
  cx.toast(`${p.projectName}: ${p.status}`, { tone: 'success', cmd }); cx.refresh();
}

/* =====================================================================================================
   The project form: Overview, Details, Tasks, Customer, Costing, Budgets, More info, Connections
   ===================================================================================================== */

const weeksBetween = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 7)) out.push(d); if (out.at(-1) !== b) out.push(b); return out; };
function overviewTab(p, FC = forecastAll()) {
  const all = tasksOf(p.name);
  const tasks = all.filter((t) => !t.isGroup);
  if (!tasks.length) return h('div.pj-ov', cx.empty('No tasks yet', cx.btn('New task', { kind: 'primary', icon: 'plus', needs: MEMBER, onClick: () => newTaskModal({ project: p.name }) })));
  if (tasks.every((t) => t.status === 'Cancelled')) return h('div.pj-ov', cx.empty('All tasks were cancelled', cx.btn('View tasks', { href: ['tasks', p.name] })));
  const open = tasks.filter(isOpenTask);
  const soon = open.filter((t) => t.expEnd && t.expEnd >= TODAY && daysBetween(TODAY, t.expEnd) <= 7);
  const overdue = open.filter((t) => t.status === 'Overdue');
  const oldest = overdue.reduce((m, t) => Math.max(m, daysBetween(t.expEnd, TODAY)), 0);
  const tot = projTotals(p);
  const expected = sum(tasks, (t) => t.expectedTime);
  const unb = unbilledOf(p.name);
  const cur = projCurrency(p);
  const ms = tasks.filter((t) => t.isMilestone && isOpenTask(t)).sort((a, b) => String(a.expEnd).localeCompare(String(b.expEnd)))[0];
  const closed = ['Completed', 'Cancelled'].includes(p.status);
  const head = h('div.pj-ov-head',
    closed ? h('span.ms', `${p.status} ${fmt.date(p.actualEnd || p.expectedEnd)} · ${p.actualEnd && p.actualEnd <= p.expectedEnd ? 'On time' : 'Late'} · planned ${fmt.date(p.expectedEnd)}`)
      : ms ? h('span', 'Next milestone: ', h('span.ms', ms.subject), ` · ${fmt.date(ms.expEnd)} · ${daysBetween(TODAY, ms.expEnd) >= 0 ? 'in ' + fmt.plural(daysBetween(TODAY, ms.expEnd), 'day') : fmt.plural(-daysBetween(TODAY, ms.expEnd), 'day') + ' late'}`) : h('span.ms', 'All milestones met'),
    h('span.muted', `${fmt.date(p.expectedStart)} – ${fmt.date(p.expectedEnd)}`));
  const stats = h('div.pj-stats',
    cx.numberCard({ label: 'Open tasks', value: fmt.int(open.length), sub: `${soon.length} due in the next 7 days`, href: ['tasks', p.name] }),
    cx.numberCard({ label: 'Overdue', value: fmt.int(overdue.length), sub: overdue.length ? `Oldest ${fmt.plural(oldest, 'day')} late` : 'Nothing overdue', color: overdue.length ? 'neg' : null }),
    cx.numberCard({ label: 'Hours logged', value: fmt.hours(tot.hours), sub: expected ? `${Math.round((tot.hours / expected) * 100)}% of ${fmt.num(expected, 0)} h expected` : 'no expected hours set' }),
    unb.length ? cx.numberCard({ label: 'Unbilled', value: money(sum(unb, (l) => l.billingAmount), cur), sub: `${fmt.num(sum(unb, (l) => l.hours), 1)} h of billable time not invoiced`, href: ['timesheet-billing'] }) : null);
  // planned vs completed, by week
  const from = p.expectedStart, to = p.expectedEnd > TODAY ? p.expectedEnd : TODAY;
  const weeks = weeksBetween(from, to);
  const W = sum(tasks, (t) => t.weight || 1) || 1;
  const planned = weeks.map((d) => Math.round((sum(tasks.filter((t) => t.expEnd && t.expEnd <= d), (t) => t.weight || 1) / W) * 100));
  const done = weeks.map((d) => (d > TODAY ? null : Math.round((sum(tasks.filter((t) => !isOpenTask(t) && (t.completedOn || t.expEnd) <= d), (t) => t.weight || 1) / W) * 100)));
  const pvc = cx.chart.line({ labels: weeks.map((d) => fmt.day(d)), height: 200, format: (v) => v + '%', series: [{ name: 'Planned', values: planned, color: '3' }, { name: 'Completed', values: done.map((v) => v ?? 0).map((v, i) => (weeks[i] > TODAY ? null : v)), color: '1' }] });
  const byStatus = cx.chart.hbar({ items: TASK_STATUSES.map((st) => ({ label: st, value: tasks.filter((t) => t.status === st).length, color: TASK_TONE[st] === 'orange' ? 'orange' : TASK_TONE[st] })).filter((x) => x.value), format: (v) => fmt.int(v) });
  const reasons = [];
  for (const t of overdue) reasons.push({ why: 'Overdue', tone: 'red', t, meta: `${fmt.plural(daysBetween(t.expEnd, TODAY), 'day')} late` });
  for (const t of open.filter((x) => x.status !== 'Overdue' && (x.dependsOn || []).some((d) => isOpenTask(TASK.get(d) || {})))) reasons.push({ why: 'Blocked', tone: 'orange', t, meta: `waits on ${(t.dependsOn || []).map((d) => TASK.get(d)).filter((x) => x && isOpenTask(x)).map((x) => x.subject).join(', ')}` });
  for (const t of open.filter((x) => !(x.assignees || []).length)) reasons.push({ why: 'Unassigned', tone: 'gray', t, meta: '' });
  for (const t of soon.filter((x) => x.status !== 'Overdue')) reasons.push({ why: 'Due soon', tone: 'blue', t, meta: fmt.date(t.expEnd) });
  const seen = new Set();
  const need = reasons.filter((r) => (seen.has(r.t.name) ? false : seen.add(r.t.name))).slice(0, 10);
  const byWho = new Map(); for (const t of open) { const ks = (t.assignees || []).length ? t.assignees : ['']; for (const k of ks) byWho.set(k, (byWho.get(k) || 0) + 1); }
  const whoBars = cx.chart.hbar({ items: [...byWho.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k ? cx.name(k) : 'Unassigned', value: v, color: k ? '2' : 'muted' })), format: (v) => fmt.int(v) });
  return h('div.pj-ov', head, healthCard(p, FC), stats,
    h('div.grid.c2', cx.card({ class: 'chart-card', title: 'Planned vs completed', body: pvc }), cx.card({ class: 'chart-card', title: 'Tasks by status', body: byStatus })),
    h('div.grid.c2',
      cx.card({ title: 'Needs attention', body: need.length ? h('div.pj-need', need.map((r) => h('a', { href: cx.href('task', r.t.name) }, h('span.why', { style: `color:var(--t-${r.tone})` }, r.why), h('span.ttl', r.t.subject, (r.t.assignees || []).length ? h('span.muted', ` · ${r.t.assignees.map(cx.name).join(', ')}`) : null), h('span.meta', r.meta)))) : cx.empty('Nothing needs attention') }),
      cx.card({ class: 'chart-card', title: 'Open tasks by assignee', body: open.length ? whoBars : cx.empty('No open tasks') })),
    cx.card({ title: 'Profitability', body: h('div.pj-prof', h('div', h('small', 'Billed'), h('b', money(tot.billed, cur))), h('div', h('small', 'Cost'), h('b', money(tot.cost + tot.purchase, 'GBP'))), h('div', h('small', 'Margin'), h('b', { style: `color:var(${tot.margin >= 0 ? '--pos' : '--neg'})` }, `${money(tot.margin, cur)}`), h('small', `${fmt.num(tot.marginPct, 1)}% of billed`))) }));
}
function heatmap(projectName) {
  const days = new Map();
  for (const l of logIndex().byProject.get(projectName) || []) if (liveTs(l.timesheet)) days.set(l.date, (days.get(l.date) || 0) + l.hours);
  const end = TODAY; let start = addDays(end, -364); while (weekday(start) !== 1) start = addDays(start, -1);
  const max = Math.max(1, ...days.values());
  const cells = []; const C = 11, G = 2;
  let col = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = (weekday(d) + 6) % 7; if (wd === 0 && d !== start) col++;
    const v = days.get(d) || 0;
    cells.push(s('rect', { x: 24 + col * (C + G), y: 16 + wd * (C + G), width: C, height: C, rx: 2, style: v ? `fill:var(--accent);opacity:${(0.18 + 0.82 * (v / max)).toFixed(2)}` : 'fill:var(--sunk)' }, s('title', `${fmt.date(d)}: ${fmt.hours(v)}`)));
  }
  const W = 24 + (col + 1) * (C + G) + 4, H = 16 + 7 * (C + G) + 4;
  const months = [];
  for (let c = 0, d = start; d <= end; d = addDays(d, 7), c++) if (+d.slice(8, 10) <= 7) months.push(s('text', { x: 24 + c * (C + G), y: 10, style: 'font-size:10px;fill:var(--muted)' }, fmt.month(d.slice(0, 7)).slice(0, 3)));
  const lbl = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, i) => (t ? s('text', { x: 0, y: 16 + i * (C + G) + 9, style: 'font-size:9.5px;fill:var(--muted)' }, t) : null));
  return h('div', { style: 'display:grid;gap:6px' }, h('p.muted', { style: 'font-size:12.5px' }, 'This is based on the timesheets logged against this project.'), h('div.pj-heat', s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Hours logged each day' }, months, lbl, cells)));
}
function costingTab(p) {
  const tot = projTotals(p);
  const cur = projCurrency(p);
  const est = p.estimatedCost || 0;
  const used = est ? (tot.cost + tot.purchase) / est : 0;
  const forecast = p.percentComplete > 0 ? (tot.cost + tot.purchase) / (p.percentComplete / 100) : null;
  const variance = forecast != null && est ? forecast - est : null;
  const health = !est ? ['No estimate', 'var(--muted)'] : used > 1 ? ['Over budget', 'var(--neg)'] : forecast && forecast > est * 1.05 ? ['At risk', 'var(--t-orange)'] : ['On track', 'var(--pos)'];
  const months = new Map();
  for (const l of logIndex().byProject.get(p.name) || []) if (liveTs(l.timesheet)) { const k = l.date.slice(0, 7); months.set(k, (months.get(k) || 0) + l.hours * l.costingRate); }
  const mk = [...months.keys()].sort().slice(-12);
  const invoices = (p.salesInvoices || []).map((n) => D.books.salesInvoices.find((i) => i.name === n)).filter(Boolean);
  const extra = D.books.salesInvoices.filter((i) => i.project === p.name && !(p.salesInvoices || []).includes(i.name));
  const allInv = [...invoices, ...extra];
  return h('div', { style: 'display:grid;gap:0' },
    h('section.section', h('div.section-head', h('h3', 'Costing dashboard')),
      h('div.pj-cost',
        h('div.box', h('h4', 'Cost against estimate'), h('div.big', money(tot.cost + tot.purchase, 'GBP')), est ? cx.chart.meter({ total: est, parts: [{ label: 'Labour', value: tot.cost }, { label: 'Purchases', value: tot.purchase, color: '3' }], warnAt: 0.85, format: (v) => fmt.compact(v, 'GBP'), legend: true }) : h('span.muted', 'No estimated cost'),
          h('div.pj-sum', h('span', `${est ? Math.round(used * 100) + '% of ' + money(est, 'GBP', 0) + ' used' : '—'}`), forecast != null && !['Completed', 'Cancelled'].includes(p.status) ? h('span', `Forecast at completion ${money(forecast, 'GBP', 0)}${variance != null ? ` · ${variance > 0 ? 'over' : 'under'} by ${money(Math.abs(variance), 'GBP', 0)}` : ''}`) : null), h('span.pj-health', { style: `color:${health[1]}` }, health[0])),
        h('div.box', h('h4', 'Contract and billing'), h('div.big', money(tot.billed, cur)), h('div.pj-sum', h('span', tot.sales ? `${Math.round((tot.billed / tot.sales) * 100)}% of the ${money(tot.sales, cur, 0)} contract billed` : 'No contract value'), h('span', `${money(tot.billable, cur)} billable from timesheets`), unbilledOf(p.name).length ? h('span', `${money(sum(unbilledOf(p.name), (l) => l.billingAmount), cur)} not yet invoiced`) : null)),
        h('div.box', h('h4', 'Margin'), h('div.big', { style: `color:var(${tot.margin >= 0 ? '--pos' : '--neg'})` }, money(tot.margin, cur)), h('div.pj-sum', h('span', `${fmt.num(tot.marginPct, 2)}% of billed`), h('span', 'Billed, less labour, purchases and materials'))))),
    mk.length ? h('section.section', h('div.section-head', h('h3', 'Labour cost by month')), cx.chart.bar({ labels: mk.map((k) => fmt.month(k)), height: 180, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v), series: [{ name: 'Labour', values: mk.map((k) => r2(months.get(k))), color: '1' }] })) : null,
    cx.section({ label: 'Costing and billing', columns: [
      [{ label: 'Total costing amount (via timesheet)', value: tot.cost, type: 'currency', currency: 'GBP' }, { label: 'Total purchase cost (via purchase invoice)', value: tot.purchase, type: 'currency', currency: 'GBP' }, { label: 'Total sales amount (via sales order)', value: tot.sales, type: 'currency', currency: cur }],
      [{ label: 'Total billable amount (via timesheet)', value: tot.billable, type: 'currency', currency: cur }, { label: 'Total billed amount (via invoice)', value: tot.billed, type: 'currency', currency: cur }, { label: 'Total consumed material cost', value: 0, type: 'currency', currency: 'GBP' }]] }),
    cx.section({ label: 'Margin', columns: [[{ label: 'Gross margin', value: tot.margin, type: 'currency', currency: cur }], [{ label: 'Gross margin %', value: tot.marginPct, type: 'float', dp: 2 }]] }),
    cx.section({ label: `Invoices (${allInv.length})`, desc: 'Each invoice opens in Books with its payment and its proof.', table: cx.grid({ numbered: false, rows: allInv, empty: 'No invoices yet', rowHref: (i) => ['sales-invoice', i.name], columns: [
      { key: 'name', label: 'Invoice', render: (i) => cx.link(i.name, 'sales-invoice', i.name) }, { key: 'postingDate', label: 'Date', type: 'date' },
      { key: 'grandTotal', label: 'Grand total', render: (i) => money(i.grandTotal, i.currency) }, { key: 'outstanding', label: 'Outstanding', opt: true, render: (i) => money(i.outstanding || 0, i.currency) },
      { key: 'st', label: 'Status', render: (i) => cx.pill(i.docstatus === 0 ? 'Draft' : i.docstatus === 2 ? 'Cancelled' : (i.outstanding || 0) > 0.005 ? (i.dueDate < TODAY ? 'Overdue' : 'Unpaid') : 'Paid') }] }) }));
}
function budgetsTab(p) {
  const b = cx.budgetOn(p.department);
  const holders = cx.holders(p.department).filter((x) => !String(x).startsWith('@'));
  return h('div', cx.section({ label: 'Department budget', desc: 'A project spends nothing itself: its purchases are paid from its department\'s budget, by whoever wears the department\'s hat now.', node: b ? h('div', { style: 'display:grid;gap:10px' },
    h('div', h('b', `${cx.deptName(p.department)} budget`), ` · ${b.quarter || ''} · `, h('b', fmt.usdc(b.left)), ` left of ${fmt.usdc(b.amount)}`),
    cx.chart.meter({ total: b.amount, parts: [{ label: 'Spent', value: b.spent }, { label: 'Committed', value: b.committed || 0, color: '3' }], warnAt: 0.85, format: (v) => fmt.compact(v, 'USDC'), legend: true }),
    h('div.muted', { style: 'font-size:13px' }, 'Spent by whoever wears the ', cx.hat(cx.deptName(p.department)), ` hat: ${holders.length ? namesList(holders) : 'nobody'} now.`),
    h('div', cx.btn(`Open ${cx.deptName(p.department)}`, { sm: true, href: ['department', p.department], cmd: `capxul org department show ${p.department}` }))) : cx.empty('No budget for this department this quarter.') }));
}
function membersTab(p, canPM) {
  const rows = (p.members || []).map((id) => ({ id }));
  return h('div', cx.section({ label: 'Members', desc: 'Members see the project and log time to it. Only people with a seat are members; nobody outside Harbourline is.', table: cx.grid({ numbered: true, rows, empty: 'No members', columns: [
    { key: 'id', label: 'Member', render: (r) => cx.personChip(r.id) }, { key: 'email', label: 'Email', opt: true, render: (r) => emailOf(r.id) },
    { key: 'dept', label: 'Department', opt: true, render: (r) => cx.deptName(cx.person(r.id)?.department) }, { key: 'seat', label: 'Seat', render: (r) => (cx.hasSeat(r.id) ? cx.pill('Seat', 'green') : cx.pill('No seat', 'gray')) },
    { key: 'x', label: '', render: (r) => cx.btn('Remove', { sm: true, kind: 'ghost', needs: PM, cmd: `capxul org projects member remove ${p.name} ${emailOf(r.id)}`, onClick: () => { p.members = p.members.filter((x) => x !== r.id); cx.toast(`${cx.name(r.id)} removed from ${p.projectName}`, { tone: 'success', cmd: `capxul org projects member remove ${p.name} ${emailOf(r.id)}` }); cx.refresh(); } }) }] }),
    actions: cx.btn('Add a member', { sm: true, icon: 'plus', needs: PM, onClick: () => addMemberModal(p) }) }));
}
function addMemberModal(p) {
  const m = { who: '' };
  const opts = D.people.filter((x) => x.status === 'Active' && !(p.members || []).includes(x.id)).map((x) => [x.id, `${x.name} · ${x.designation}`]);
  formModal({ title: `Add a member to ${p.projectName}`, model: m, cols: 1, needs: PM, submit: 'Add', who: 'whoever wears the People hat, or a Director',
    fields: [{ label: 'Member', key: 'who', type: 'select', reqd: true, options: [['', 'Choose someone'], ...opts] }],
    cmd: (x) => `capxul org projects member add ${p.name} ${x.who ? emailOf(x.who) : '<member>'}`,
    onSubmit: (x, close, cmd) => { (p.members ||= []).push(x.who); close(); cx.toast(`${cx.name(x.who)} is on ${p.projectName}`, { tone: 'success', cmd }); cx.refresh(); } });
}
function projectTasksTab(p) {
  const rows = treeOrder(tasksOf(p.name)).map((x) => x.t);
  const quick = (t) => taskQuickDialog(t);
  return h('div', h('div.section', h('div.section-head', h('h3', `Tasks (${rows.length})`), cx.btn('Add task', { sm: true, icon: 'plus', needs: MEMBER, cmd: `capxul org projects task create "<subject>" --project ${p.name}`, onClick: () => newTaskModal({ project: p.name }) }), cx.btn('Gantt chart', { sm: true, icon: 'chart', href: ['tasks-gantt', p.name] })),
    cx.grid({ numbered: false, rows, empty: 'No tasks in this project yet.', columns: [
      { key: 'subject', label: 'Task name', render: (t) => h('a', { href: cx.href('task', t.name), style: { paddingLeft: (t.parent ? 16 : 0) + 'px', fontWeight: t.isGroup ? 600 : null }, onclick: (e) => { e.preventDefault(); quick(t); } }, t.subject) },
      { key: 'status', label: 'Status', render: (t) => taskPill(t.status) },
      { key: 'priority', label: 'Priority', opt: true, render: (t) => cx.pill(t.priority || 'Low', PRIORITY_TONE[t.priority] || 'gray') },
      { key: 'expStart', label: 'Start date', type: 'date', opt: true }, { key: 'expEnd', label: 'End date', type: 'date' },
      { key: 'progress', label: 'Progress', render: (t) => pctBar(t.status === 'Completed' ? 100 : t.progress) },
      { key: 'assignees', label: 'Assigned to', opt: true, render: (t) => avatars(t.assignees) }] })));
}
const avatars = (ids) => ((ids || []).length ? h('span.pj-mem', { title: ids.map(cx.name).join(', ') }, ids.map((id) => cx.avatar(id, { size: 'sm' }))) : h('span.faint', '—'));
/** The quick dialog a task opens in from a project: its fields, Save, and the full form. */
function taskQuickDialog(t) {
  const m = { subject: t.subject, priority: t.priority, expStart: t.expStart, expEnd: t.expEnd, expectedTime: t.expectedTime, description: t.description || '' };
  const tt = taskTotals(t);
  const md = formModal({ title: t.subject, model: m, needs: MEMBER, submit: 'Save', who: 'any member',
    intro: h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, taskPill(t.status), h('span.muted', { style: 'font-size:12.5px' }, `${t.name} · ${projName(t.project)} · ${t.actualStart ? 'started ' + fmt.date(t.actualStart) : 'not started'} · ${fmt.hours(tt.hours)} logged`), avatars(t.assignees)),
    fields: [{ label: 'Subject', key: 'subject', reqd: true, wide: true }, { label: 'Priority', key: 'priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] }, { label: 'Expected time (hours)', key: 'expectedTime', type: 'float' }, { label: 'Expected start', key: 'expStart', type: 'date' }, { label: 'Expected end', key: 'expEnd', type: 'date' }, { label: 'Description', key: 'description', type: 'textarea', wide: true }],
    extra: h('div', cx.btn('Open the full form', { sm: true, icon: 'right', onClick: () => { md.close(); cx.go('task', t.name); } })),
    cmd: (x) => taskChangeCmd(t, x),
    onSubmit: (x, close, cmd) => { applyTaskChange(t, x); close(); cx.toast(`${t.subject} saved`, { tone: 'success', cmd: [].concat(cmd)[0] }); cx.refresh(); } });
}
function taskChangeCmd(t, x) {
  const f = [];
  if (x.subject !== t.subject) f.push(`--subject ${q(x.subject)}`);
  if (x.expStart !== t.expStart) f.push(`--start ${x.expStart}`);
  if (x.expEnd !== t.expEnd) f.push(`--end ${x.expEnd}`);
  if (+x.expectedTime !== +t.expectedTime) f.push(`--hours ${x.expectedTime}`);
  if (x.priority !== t.priority) f.push(`--priority ${String(x.priority).toLowerCase()}`);
  if (x.weight != null && +x.weight !== +t.weight) f.push(`--weight ${x.weight}`);
  if (x.isMilestone != null && !!x.isMilestone !== !!t.isMilestone) f.push(x.isMilestone ? '--milestone' : '--clear milestone');
  if (x.dependsOn != null && x.dependsOn !== (t.dependsOn || []).join(',')) f.push(...String(x.dependsOn).split(',').filter(Boolean).map((d) => `--depends-on ${d.trim()}`));
  return `capxul org projects task change ${t.name}${f.length ? ' ' + f.join(' ') : ''}`;
}
function applyTaskChange(t, x) {
  const was = { ...t };
  t.subject = x.subject; t.priority = x.priority; t.expStart = x.expStart; t.expEnd = x.expEnd; t.expectedTime = +x.expectedTime || 0;
  if (x.description != null) t.description = x.description;
  if (x.weight != null) t.weight = +x.weight || 0;
  if (x.isMilestone != null) t.isMilestone = !!x.isMilestone;
  if (x.dependsOn != null) t.dependsOn = String(x.dependsOn).split(',').map((d) => d.trim()).filter(Boolean);
  if (t.status === 'Overdue' && t.expEnd >= TODAY) { t.status = t.actualStart ? 'Working' : 'Open'; noteOn(t, `moved the expected end to ${fmt.date(t.expEnd)}, so it is ${t.status} again`); }
  else if (isOpenTask(t) && t.status !== 'Pending Review' && t.expEnd && t.expEnd < TODAY && !t.isGroup) t.status = 'Overdue';
  const ch = ['subject', 'priority', 'expStart', 'expEnd', 'expectedTime'].filter((k) => String(was[k]) !== String(t[k]));
  if (ch.length) noteOn(t, `changed ${ch.map((k) => ({ subject: 'Subject', priority: 'Priority', expStart: 'Expected start', expEnd: 'Expected end', expectedTime: 'Expected time' })[k]).join(', ')}`, 'change');
}
function projectTimeline(p) {
  const items = [];
  const plan = planOf(p);
  if (p.createdAt || p.actualStart) items.push({ at: p.createdAt || p.actualStart + 'T09:00:00Z', who: p.createdBy || plan.acceptedBy || cx.holders(p.department)[0], kind: 'created', text: plan.byAgent ? 'opened this project from the accepted plan' : 'created this project' });
  if (plan.byAgent) {
    items.push({ at: plan.draftedAt, who: AGENT, kind: 'note', text: 'drafted the plan from the signed proposal', sub: plan.deal ? `${plan.deal.subject}, won ${fmt.date(plan.deal.closedDate)}` : null, body: `${fmt.plural(plan.taskCount, 'task')} in ${fmt.plural(plan.phases, 'phase')}, ${fmt.int(plan.hours)} h, for ${cx.name(plan.acceptedBy)} to accept.`, href: plan.deal && cx.hasRoute('deal') ? ['deal', plan.deal.name] : null });
    if (plan.acceptedAt) items.push({ at: plan.acceptedAt, who: plan.acceptedBy, kind: 'approval', text: 'accepted the plan' });
  }
  for (const x of p.history || []) items.push({ at: x.at, who: x.who, kind: ['status', 'email', 'note', 'approval'].includes(x.kind) ? x.kind : 'change', text: x.text, sub: x.sub || null, body: x.body || null });
  for (const u of updatesOf(p).filter((x) => x.status === 'Sent' && !x.live)) items.push({ at: u.sentAt, who: u.sentBy, kind: 'email', text: `sent the weekly update to ${u.toName}`, sub: `Week of ${spanText(u.week, addDays(u.week, 4))}`, body: 'Drafted by the project agent from the week’s progress.' });
  for (const n of p.salesInvoices || []) { const i = D.books.salesInvoices.find((x) => x.name === n); if (i) items.push({ at: (i.submittedAt || i.postingDate + 'T17:00:00Z'), who: i.submittedBy || i.createdBy || null, kind: 'link', text: `invoiced ${fmt.money(i.grandTotal, i.currency)}: ${i.name}`, href: ['sales-invoice', i.name], body: i.kind === 'timesheets' && i.postingDate >= PLAN_SINCE ? 'Billable hours gathered into a draft by the project agent.' : null }); }
  for (const t of tasksOf(p.name).filter((x) => x.completedOn && !x.isGroup)) items.push({ at: t.completedOn + 'T16:00:00Z', who: t.completedBy || (t.assignees || [])[0], kind: 'task', text: `completed ${t.subject}`, href: ['task', t.name] });
  const hl = healthOf(p);
  if (hl.level >= 1) items.push({ at: CHECKED_AT, who: AGENT, kind: 'status', text: `flagged the project ${hl.label.toLowerCase()}`, body: hl.reasons.filter((r) => r.lvl >= 1).slice(0, 3).map((r) => r.text).join('. ') + '.' });
  return items.filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 24);
}

/* ---------- the plan a won deal becomes ---------- */

const DEAL_OF = new Map();
for (const d of D.crm?.deals || []) if (d.project && d.status === 'Won') DEAL_OF.set(d.project, d);
const PLAN_SINCE = '2026-02-01';
/** A project's plan: drafted by the project agent from the signed proposal (deals won since the agent started), else made by hand. */
function planOf(p) {
  if (p.plan) return p.plan;
  const lead = leadOf(p);
  const tasks = tasksOf(p.name).filter((t) => !t.createdAt);
  const base = { lead, taskCount: tasks.filter((t) => !t.isGroup).length, phases: tasks.filter((t) => t.isGroup).length, hours: r2(sum(tasks.filter((t) => !t.isGroup), (t) => t.expectedTime)) };
  const d = DEAL_OF.get(p.name);
  if (!d || !d.closedDate || d.closedDate < PLAN_SINCE) return { ...base, byAgent: false };
  let acc = nextWorkday(nextWorkday(d.closedDate)); if (acc >= p.expectedStart) acc = nextWorkday(d.closedDate);
  return { ...base, byAgent: true, deal: d, draftedAt: `${d.closedDate}T${d.closedDate === '2026-10-28' ? '15:10' : '16:20'}:00Z`, acceptedAt: `${acc}T10:05:00Z`, acceptedBy: lead, contract: d.dealValue, currency: d.currency || 'GBP' };
}
function planTab(p, FC) {
  const plan = planOf(p);
  const m = metricsOf(p, FC);
  const cur = projCurrency(p);
  const contract = plan.contract ?? p.totalSalesAmount;
  const BILL = { tm: 'time and materials, billed monthly in arrears', retainer: 'a retainer, invoiced monthly', fixed: 'a fixed price, invoiced in stages', none: 'not billed' };
  const head = h('div.pj-plan-head',
    plan.byAgent
      ? h('div', 'Drafted by the project agent from the signed proposal on ', cx.hasRoute('deal') ? cx.link(plan.deal.subject, 'deal', plan.deal.name) : h('b', plan.deal.subject), ` (won ${fmt.date(plan.deal.closedDate)}), and accepted by `, h('b', cx.name(plan.acceptedBy)), ` on ${fmt.date(plan.acceptedAt)}.`)
      : h('div', `Planned by hand when the project was set up${p.createdBy ? ' by ' + cx.name(p.createdBy) : ''}.`),
    h('div.muted', `Led by ${cx.name(plan.lead)}. Budget in hours is what the plan's tasks estimate; budget in money is the estimated cost.`));
  const phases = tasksOf(p.name).filter((t) => t.isGroup).sort((a, b) => String(a.expStart).localeCompare(String(b.expStart)));
  const loose = tasksOf(p.name).filter((t) => !t.isGroup && !t.parent);
  const rowsOf = (kids) => ({ hours: sum(kids, (k) => k.expectedTime), logged: sum(kids, (k) => taskTotals(k).hours), done: sum(kids, (k) => k.expectedTime) ? sum(kids, (k) => (k.expectedTime || 0) * (k.status === 'Completed' ? 1 : (k.progress || 0) / 100)) / sum(kids, (k) => k.expectedTime) : 0 });
  const prow = [...phases.map((g) => { const kids = P.tasks.filter((k) => k.parent === g.name && !k.isGroup && k.status !== 'Cancelled'); return { t: g, ...rowsOf(kids), f: FC.get(g.name) }; }), ...(loose.length ? [{ t: { name: '', subject: phases.length ? 'Other tasks' : 'Tasks', expStart: loose.reduce((x, k) => (k.expStart < x ? k.expStart : x), loose[0].expStart), expEnd: loose.reduce((x, k) => (k.expEnd > x ? k.expEnd : x), loose[0].expEnd) }, ...rowsOf(loose.filter((k) => k.status !== 'Cancelled')), f: null }] : [])];
  const ms = tasksOf(p.name).filter((t) => t.isMilestone).sort(byEnd);
  return h('div', { style: 'display:grid;gap:0' },
    h('section.section', h('div.section-head', h('h3', 'Plan')), head),
    cx.section({ label: 'Budget', columns: [
      [{ label: 'Contract', value: contract, readOnly: true, render: () => h('span', contract ? money(contract, plan.currency || cur, 0) : '—', h('span.muted', ` · ${BILL[p.billing] || '—'}`)) }, { label: 'Budget in money (estimated cost)', value: m.budget, type: 'currency', currency: 'GBP', readOnly: true }, { label: 'Cost to date', value: m.cost, readOnly: true, render: () => h('span', money(m.cost, 'GBP', 0), m.budget ? h('span.muted', ` · ${fmt.pct(m.used, 0)} of budget`) : null) }],
      [{ label: 'Budget in hours (the tasks’ estimates)', value: m.planHours, type: 'float', dp: 1, readOnly: true }, { label: 'Hours logged', value: m.hours, readOnly: true, render: () => h('span', fmt.hours(m.hours), m.planHours ? h('span.muted', ` · ${fmt.pct(m.hours / m.planHours, 0)} of the plan`) : null) }, { label: 'Work done', value: m.done, readOnly: true, render: () => pctBar(p.status === 'Completed' ? 100 : m.done * 100) }]] }),
    cx.section({ label: `Phases (${prow.length})`, table: cx.grid({ numbered: false, rows: prow, empty: 'No phases', rowHref: (r) => (r.t.name ? ['task', r.t.name] : null), columns: [
      { key: 'phase', label: 'Phase', render: (r) => (r.t.name ? cx.link(r.t.subject, 'task', r.t.name) : r.t.subject) },
      { key: 'dates', label: 'Planned', opt: true, render: (r) => `${fmt.day(r.t.expStart)} to ${fmt.date(r.t.expEnd)}` },
      { key: 'hours', label: 'Plan hours', render: (r) => fmt.int(r.hours) }, { key: 'logged', label: 'Logged', render: (r) => h('span', { style: r.logged > r.hours * 1.1 && r.hours ? 'color:var(--neg)' : null }, fmt.int(r.logged)) },
      { key: 'done', label: 'Done', render: (r) => pctBar(r.done * 100) },
      { key: 'fc', label: 'Forecast end', opt: true, render: (r) => (r.f && !r.f.done && r.f.slip > 3 ? h('span', { style: 'color:var(--neg)' }, `${fmt.date(r.f.end)} (+${r.f.slip} d)`) : r.f ? fmt.date(r.f.end) : '') }] }) }),
    cx.section({ label: `Milestones (${ms.length})`, table: cx.grid({ numbered: false, rows: ms, empty: 'No milestones in this plan', rowHref: (t) => ['task', t.name], columns: [
      { key: 'subject', label: 'Milestone', render: (t) => cx.link(t.subject, 'task', t.name) }, { key: 'expEnd', label: 'Planned', type: 'date' },
      { key: 'fc', label: 'Forecast', render: (t) => { const f = FC.get(t.name); if (!isOpenTask(t)) return h('span.muted', `Met ${fmt.date(t.completedOn || t.expEnd)}`); return f && f.slip > 3 ? h('span', { style: 'color:var(--neg);font-weight:600' }, `${fmt.date(f.end)} · ${f.slip} working days late`) : h('span', { style: 'color:var(--pos)' }, 'On time'); } },
      { key: 'who', label: 'Owner', opt: true, render: (t) => avatars(t.assignees) }] }) }));
}

/* ---------- the weekly client update ---------- */

const UPDATE_PROJECTS = ['PROJ-0011', 'PROJ-0012', 'PROJ-0010'];
const UPD = new Map();
function contactOf(p) {
  const d = DEAL_OF.get(p.name);
  const c = d?.contacts?.find((x) => x.primary) || d?.contacts?.[0];
  const ct = c && (D.crm?.contacts || []).find((x) => x.id === c.contact);
  return ct ? { name: ct.name, first: ct.firstName || ct.name.split(' ')[0], email: ct.email } : null;
}
/** The week's progress in the client's words: hours, what closed, what is next, and what to watch. */
function weekLines(p, mon, FC) {
  const fri = addDays(mon, 4);
  const logs = (logIndex().byProject.get(p.name) || []).filter((l) => l.date >= mon && l.date <= fri && liveTs(l.timesheet));
  const hours = r2(sum(logs, (l) => l.hours)), people = uniq(logs.map((l) => TSM.get(l.timesheet)?.employee));
  const byTask = new Map(); for (const l of logs) if (l.task) byTask.set(l.task, (byTask.get(l.task) || 0) + l.hours);
  const top = [...byTask.entries()].filter(([n]) => TASK.get(n)?.project === p.name).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, h0]) => `${TASK.get(n)?.subject} (${fmt.hours(r2(h0))})`);
  const closed = tasksOf(p.name).filter((t) => !t.isGroup && t.completedOn && t.completedOn >= mon && t.completedOn <= fri);
  const nm = addDays(mon, 7), nf = addDays(mon, 11);
  const next = tasksOf(p.name).filter((t) => !t.isGroup && isOpenTask(t) && t.expStart <= nf && t.expEnd >= nm && !((t.progress || 0) >= 95 && daysBetween(t.expEnd, TODAY) > 30)).sort(byEnd).slice(0, 3);
  const lines = [`This week: ${fmt.hours(hours)} from ${fmt.plural(people.length, 'person', 'people')}${top.length ? ', most on ' + top.join(' and ') : ''}.`,
    closed.length ? `Done: ${closed.map((t) => t.subject).join(', ')}.` : 'Done: nothing closed this week; the work above carries on.',
    next.length ? `Next week: ${next.map((t) => `${t.subject} (due ${fmt.day(t.expEnd)})`).join(', ')}.` : null];
  if (FC && mon === addDays(WEEK0, -7)) {
    const late = tasksOf(p.name).filter((t) => !t.isGroup && t.status === 'Overdue' && t.expEnd >= addDays(TODAY, -30));
    for (const t of late) { const f = FC.get(t.name); if (f) lines.push(`Watching: ${t.subject} ran past ${fmt.day(t.expEnd)}; we now expect it by ${fmt.day(f.end)}.`); }
  }
  return lines.filter(Boolean);
}
function updatesOf(p) {
  if (UPD.has(p.name)) return UPD.get(p.name);
  const list = [];
  const c = contactOf(p);
  if (UPDATE_PROJECTS.includes(p.name) && c && p.status === 'Open') {
    const lead = leadOf(p);
    const last = addDays(WEEK0, -7);
    let wk = mondayOf(p.expectedStart > addDays(WEEK0, -28) ? p.expectedStart : addDays(WEEK0, -28));
    for (let i = 0; wk <= last; wk = addDays(wk, 7), i++) {
      const fri = addDays(wk, 4);
      const draft = p.name === 'PROJ-0011' && wk === last;
      list.push({ project: p.name, week: wk, status: draft ? 'Draft' : 'Sent', draftedAt: `${fri}T15:00:00Z`, sentAt: draft ? null : `${fri}T16:${String(12 + i * 7).padStart(2, '0')}:00Z`, sentBy: draft ? null : lead, to: c.email, toName: c.name, first: c.first, subject: `${p.projectName}: the week of ${spanText(wk, fri)}`, lines: null });
    }
  }
  UPD.set(p.name, list);
  return list;
}
const updateLines = (p, u, FC) => (u.lines ||= weekLines(p, u.week, FC || forecastAll()));
function sendUpdate(p, u) {
  if (u.status === 'Sent') return;
  u.status = 'Sent'; u.sentAt = NOW(); u.sentBy = cx.meId(); u.live = true;
  (p.history ||= []).push({ at: u.sentAt, who: cx.meId(), kind: 'email', text: `sent the weekly update to ${u.toName}`, sub: `Week of ${spanText(u.week, addDays(u.week, 4))}`, body: 'Drafted by the project agent from the week’s progress.' });
  cx.toast(`Sent to ${u.toName} (mock-up: nothing is sent)`, { tone: 'success' });
  cx.refresh();
}
function updatesCard(p, FC) {
  const list = updatesOf(p).slice().reverse();
  if (!list.length) return null;
  return cx.card({ title: 'Weekly client updates', body: h('div.pj-upd', list.map((u, i) => h('details', { open: i === 0 ? true : null },
    h('summary', h('b', `Week of ${spanText(u.week, addDays(u.week, 4))}`), u.status === 'Draft' ? cx.pill('Draft', 'orange') : cx.pill('Sent', 'green'), h('span.muted', u.status === 'Draft' ? `drafted by the project agent for ${cx.firstName(leadOf(p))} to send` : `to ${u.toName} by ${cx.firstName(u.sentBy)}, ${fmt.datetime(u.sentAt)} · drafted by the project agent`)),
    h('div.body', h('div.muted', `To ${u.to} · ${u.subject}`), h('div', `Hi ${u.first},`), updateLines(p, u, FC).map((l) => h('div', l)), h('div', cx.firstName(leadOf(p))),
      u.status === 'Draft' ? h('div', cx.btn('Send it', { sm: true, kind: 'primary', icon: 'send', needs: () => (cx.meId() === leadOf(p) ? true : `${cx.name(leadOf(p))} leads this project and sends its updates.`), onClick: () => { const it = cx.agentWork?.list({ kind: 'proposal' }).find((x) => x.key === `pj-update-${p.name}-${u.week}`); if (it) cx.agentWork.approve(it); else sendUpdate(p, u); } })) : null)))) });
}

/* ---------- the health card and the project's timeline tab ---------- */

function healthCard(p, FC) {
  const hl = healthOf(p, FC);
  if (hl.level < 0 && !hl.notes.length) return null;
  const rows = [...hl.reasons.sort((a, b) => b.lvl - a.lvl).map((r) => h(r.href ? 'a' : 'div', { href: r.href ? cx.href(r.href[0], r.href[1]) : null }, h('i', { style: `color:var(--t-${HEALTH_TONE[r.lvl]})` }), h('span', r.text))),
    ...hl.notes.map((n) => h('div', h('i', { style: 'color:var(--faint)' }), h('span.note', n)))];
  return cx.card({ title: 'Health', body: h('div', h('div.pj-hhead', healthPill(hl, { lg: true }), h('span.muted', hl.level >= 0 ? `Checked by the project agent today at ${fmt.time(CHECKED_AT)}: budget, hours, milestones and late tasks.` : '')),
    rows.length ? h('div.pj-hl', rows) : h('p.muted', { style: 'font-size:13px' }, 'Nothing to flag: the budget, the hours and every milestone are where the plan put them.')) });
}
function timelineTab(p, FC) {
  const all = tasksOf(p.name);
  const groups = all.filter((t) => t.isGroup).sort((a, b) => String(a.expStart).localeCompare(String(b.expStart)));
  const rows = [];
  for (const g of groups) {
    const kids = all.filter((k) => k.parent === g.name && !k.isGroup);
    const W = sum(kids, (k) => k.expectedTime) || 1;
    rows.push({ id: g.name, label: g.subject, start: g.expStart, end: g.expEnd, progress: sum(kids, (k) => (k.expectedTime || 0) * (k.status === 'Completed' ? 1 : (k.progress || 0) / 100)) / W, color: '1', href: ['task', g.name] });
    for (const k of kids.filter((x) => x.isMilestone)) rows.push({ id: k.name, label: `◆ ${k.subject}`, start: k.expStart, end: k.expEnd, progress: k.status === 'Completed' ? 1 : (k.progress || 0) / 100, color: '6', href: ['task', k.name], deps: k.dependsOn, sub: FC.get(k.name)?.slip > 3 ? `Forecast ${fmt.date(FC.get(k.name).end)}` : null });
  }
  for (const k of all.filter((x) => !x.isGroup && !x.parent).sort(byEnd)) rows.push({ id: k.name, label: k.subject, start: k.expStart, end: k.expEnd, progress: k.status === 'Completed' ? 1 : (k.progress || 0) / 100, color: k.isMilestone ? '6' : '2', href: ['task', k.name] });
  const dated = rows.filter((r) => r.start && r.end);
  const chart = dated.length ? cx.chart.gantt({ rows: dated, today: TODAY, title: `Phases and milestones of ${p.projectName}` }) : cx.empty('No dated phases yet');
  const FCm = metricsOf(p, FC).milestones;
  return h('div', { style: 'display:grid;gap:14px;padding:16px;min-width:0' },
    cx.card({ class: 'chart-card', title: 'Phases and milestones', actions: cx.btn('Gantt chart', { sm: true, icon: 'chart', href: ['tasks-gantt', p.name] }), body: h('div', { style: 'display:grid;gap:8px' }, chart, FCm.some((x) => x.slip > 3) ? h('p.pj-note', FCm.filter((x) => x.slip > 3).map((x) => `${x.t.subject}: forecast ${fmt.date(x.f.end)}, ${x.slip} working days after ${fmt.date(x.t.expEnd)}.`).join(' ')) : null) }),
    updatesCard(p, FC),
    h('p.pj-note', 'The project’s history, from the plan to the last update, is under Activity below.'));
}
function projectPage(p) {
  const canPM = cx.allowed(PM).ok;
  const FC = forecastAll();
  const hl = healthOf(p, FC);
  const lead = leadOf(p);
  const draft = { ...p };
  const cur = projCurrency(p);
  const tot = projTotals(p);
  const keys = ['projectName', 'projectType', 'percentCompleteMethod', 'priority', 'department', 'expectedStart', 'expectedEnd', 'estimatedCost', 'customer', 'notes'];
  const FLAG = { projectName: '--name', projectType: '--type', percentCompleteMethod: '--progress', priority: '--priority', department: '--department', expectedStart: '--start', expectedEnd: '--end', estimatedCost: '--estimated-cost', customer: '--customer', notes: '--notes' };
  const changed = () => keys.filter((k) => String(draft[k] ?? '') !== String(p[k] ?? ''));
  const changeCmd = () => `capxul org projects change ${p.name} ${changed().map((k) => `${FLAG[k]} ${k === 'percentCompleteMethod' || k === 'priority' ? lc(draft[k]) : k === 'customer' ? q(custName(draft[k])) : q(draft[k])}`).join(' ')}`;
  const saveBtn = cx.btn('Save', { kind: 'primary', needs: PM, onClick: () => {
    const ks = changed(); if (!ks.length) { cx.toast('Nothing to save'); return; }
    const cmd = changeCmd();
    for (const k of ks) p[k] = k === 'estimatedCost' ? +draft[k] || 0 : draft[k];
    p.costCenter = cx.deptName(p.department);
    (p.history ||= []).push({ at: NOW(), who: cx.meId(), kind: 'change', text: `changed ${ks.length === 1 ? ks[0].replace(/([A-Z])/g, ' $1').toLowerCase() : fmt.plural(ks.length, 'field')}` });
    cx.toast(`${p.projectName} saved`, { tone: 'success', cmd }); cx.refresh();
  } });
  saveBtn.hidden = true;
  const onChange = () => { const n = changed().length; saveBtn.hidden = !n; if (n) cx.showAction(changeCmd(), 'Save', { pin: true }); };
  const holders = cx.holders(p.department).filter((x) => !String(x).startsWith('@'));
  const unb = unbilledOf(p.name);
  const tsCount = P.timesheets.filter((t) => tsLogs(t.name).some((l) => l.project === p.name) || t.project === p.name).length;
  const pinv = (D.books.purchaseInvoices || []).filter((i) => i.project === p.name || (i.items || []).some((it) => it.project === p.name));
  const sinv = D.books.salesInvoices.filter((i) => i.project === p.name || (p.salesInvoices || []).includes(i.name));
  const form = cx.formView({
    doc: draft, editable: canPM, tabKey: 'pj-project', onChange,
    tabs: [
      { label: 'Overview', render: () => overviewTab(p, FC) },
      { label: 'Plan', render: () => planTab(p, FC) },
      { label: 'Timeline', render: () => timelineTab(p, FC) },
      { label: 'Details', sections: [
        { columns: [
          [{ label: 'Project name', key: 'projectName', reqd: true }, { label: 'Status', value: p.status, readOnly: true, type: 'status', render: () => projPill(p) }, { label: 'Project type', key: 'projectType', type: 'select', options: P.projectTypes.map((t) => t.name) }, { label: '% complete method', key: 'percentCompleteMethod', type: 'select', options: ['Manual', 'Task Completion', 'Task Progress', 'Task Weight'] }],
          [{ label: 'Priority', key: 'priority', type: 'select', options: ['Low', 'Medium', 'High'] }, { label: 'Department', key: 'department', type: 'select', options: deptOpts(), render: (d) => h('span', cx.deptName(d.department), h('span.muted', holders.length ? ` · worn by ${namesList(holders)}` : '')) }, { label: '% completed', value: p.percentComplete, readOnly: true, render: () => pctBar(p.percentComplete) }]] },
        { label: 'Timeline', columns: [
          [{ label: 'Expected start date', key: 'expectedStart', type: 'date' }, { label: 'Expected end date', key: 'expectedEnd', type: 'date' }],
          [{ label: 'Actual start date (via timesheet)', value: p.actualStart, type: 'date', readOnly: true }, { label: 'Actual end date (via timesheet)', value: p.actualEnd, type: 'date', readOnly: true }, { label: 'Actual time in hours (via timesheet)', value: tot.hours, type: 'float', dp: 1, readOnly: true }]] },
        { label: 'Accounting', columns: [[{ label: 'Estimated cost', key: 'estimatedCost', type: 'currency', currency: 'GBP' }], [{ label: 'Default cost centre', value: cx.deptName(p.department), readOnly: true }]] },
      ] },
      { label: 'Tasks', count: tasksOf(p.name).length, render: () => projectTasksTab(p) },
      { label: 'Customer', sections: [
        { columns: [[{ label: 'Customer', key: 'customer', type: 'select', options: [['', '—'], ...(D.books.customers || []).map((c) => [c.id, c.name])], render: (d) => custLink(d.customer) }], [{ label: 'Billing', value: { tm: 'Time and materials: hours billed monthly in arrears', retainer: 'Retainer: a fixed monthly invoice', fixed: 'Fixed price, in stages', none: 'Not billed' }[p.billing] || '—', readOnly: true }]] },
        { label: 'Notes', collapsible: true, collapsed: false, cols: 1, fields: [{ label: 'Notes', key: 'notes', type: 'textarea', placeholder: 'How this project is run and billed' }] },
      ] },
      { label: 'Costing', render: () => costingTab(p) },
      { label: 'Budgets', render: () => budgetsTab(p) },
      { label: 'More info', render: () => membersTab(p, canPM) },
      { label: 'Connections', render: () => h('div', { style: 'display:grid;gap:14px;padding:16px' }, heatmap(p.name),
        h('div', { style: 'display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))' },
          [['Project', [['Task', tasksOf(p.name).length, ['tasks', p.name]], ['Timesheet', tsCount, ['timesheets', p.name]]]],
            ['Sales', [['Invoice', sinv.length, ['sales-invoices']]]],
            ['Purchase', [['Bill', pinv.length, ['purchase-invoices']]]],
            ['Reports', [['Project billing summary', null, ['timesheet-billing']]]]].map(([g, items]) => h('div', h('h4', { style: 'font-size:12px;color:var(--muted);font-weight:600;margin-bottom:6px' }, g), h('div', { style: 'display:grid;gap:6px' }, items.map(([label, n, href]) => h('a.shortcut', { href: cx.href(href[0], href[1]), style: 'padding:7px 10px' }, h('span.lbl', label), n != null ? h('span.cnt.t-gray', String(n)) : null))))))) },
    ],
    side: { id: p.name, title: p.projectName, cmd: `capxul org projects get ${p.name}`,
      extra: h('div', { style: 'display:grid;gap:10px' },
        lead ? h('div.side-sec', h('h4', 'Lead'), cx.personChip(lead)) : null,
        hl.level >= 0 ? h('div.side-sec', h('h4', 'Health'), healthPill(hl), h('div.muted', { style: 'margin-top:4px;font-size:12.5px' }, hl.reasons.length ? fmt.plural(hl.reasons.length, 'flag') + ' from the project agent' : 'Nothing flagged')) : null,
        h('div.side-sec', h('h4', 'Department'), h('div', cx.hat(cx.deptName(p.department)), h('div.muted', { style: 'margin-top:4px' }, holders.length ? `Worn by ${namesList(holders)}` : 'Nobody wears it'))),
        h('div.side-sec', h('h4', `Members (${(p.members || []).length})`), h('div.chips', (p.members || []).slice(0, 12).map((id) => cx.avatar(id)))),
        p.customer ? h('div.side-sec', h('h4', 'Customer'), custLink(p.customer)) : null,
        unb.length ? h('div.side-sec', h('h4', 'Not yet invoiced'), h('div', h('b', money(sum(unb, (l) => l.billingAmount), cur)), h('span.muted', ` · ${fmt.num(sum(unb, (l) => l.hours), 1)} h`))) : null),
      created: { by: p.createdBy || (planOf(p).byAgent ? planOf(p).acceptedBy : holders[0]), at: p.createdAt || (p.actualStart || p.expectedStart) + 'T09:00:00Z' }, modified: p.modifiedAt ? { by: p.modifiedBy, at: p.modifiedAt } : null },
    timeline: { items: projectTimeline(p), comment: false },
  });
  const verbs = [
    { heading: 'Set project status' },
    { label: 'Completed', icon: 'check', needs: PM, disabled: p.status === 'Completed', cmd: `capxul org projects complete ${p.name}`, onClick: () => projectVerb(p, 'complete') },
    { label: 'Cancelled', icon: 'x', needs: PM, disabled: p.status === 'Cancelled', danger: true, cmd: `capxul org projects cancel ${p.name}`, onClick: () => projectVerb(p, 'cancel') },
    p.status === 'Open' ? { label: 'Put on hold', icon: 'clock', needs: PM, cmd: `capxul org projects hold ${p.name}`, onClick: () => projectVerb(p, 'hold') } : p.status === 'On hold' ? { label: 'Resume', icon: 'right', needs: PM, cmd: `capxul org projects resume ${p.name}`, onClick: () => projectVerb(p, 'resume') } : { label: 'Reopen', icon: 'refresh', needs: PM, cmd: `capxul org projects reopen ${p.name}`, onClick: () => projectVerb(p, 'reopen') },
    { divider: true },
    { label: 'Add a member', icon: 'user', needs: PM, cmd: `capxul org projects member add ${p.name} <member>`, onClick: () => addMemberModal(p) },
    { label: 'Add task', icon: 'plus', needs: MEMBER, cmd: `capxul org projects task create "<subject>" --project ${p.name}`, onClick: () => newTaskModal({ project: p.name }) },
  ];
  const actions = [
    saveBtn,
    cx.menu('View', [{ label: 'Portfolio', icon: 'chart', href: ['projects-portfolio'] }, { label: 'Resources', icon: 'user', href: ['project-resources'] }, { divider: true }, { label: 'Gantt chart', icon: 'chart', href: ['tasks-gantt', p.name] }, { label: 'Kanban board', icon: 'kanban', href: ['tasks-kanban', p.name] }, { label: 'Task tree', icon: 'tree', href: ['tasks-tree', p.name] }, { label: 'Timesheets', icon: 'clock', href: ['timesheets', p.name] }, { label: 'Billing summary', icon: 'report', onClick: () => cx.go('timesheet-billing', null, { report: { project: p.name, groupBy: 'project' } }) }]),
    cx.menu('Actions', verbs),
    unb.length && p.customer ? cx.btn('Bill hours', { kind: 'primary', icon: 'file', needs: 'Invoicing', cmd: `capxul org projects timesheet bill ${uniq(unb.map((l) => l.timesheet)).slice(0, 3).join(' ')}${uniq(unb.map((l) => l.timesheet)).length > 3 ? ' …' : ''} --to ${accountsEmail(p.customer)}`, onClick: () => billModal(uniq(unb.map((l) => l.timesheet)), p.name) }) : null,
  ];
  return cx.page({
    title: p.projectName, workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Projects', route: 'projects' }],
    status: [projPill(p, { lg: true }), hl.level >= 0 ? healthPill(hl, { lg: true }) : null].filter(Boolean),
    sub: `${p.name} · ${p.projectType}${p.customer ? ' · ' + custName(p.customer) : ''} · ${cx.deptName(p.department)}${lead ? ' · led by ' + cx.name(lead) : ''}${p.status === 'On hold' && p.holdSince ? ' · on hold since ' + fmt.date(p.holdSince) : ''}`,
    actions,
    banner: !canPM ? cx.banner(`Any member adds and works tasks here. ${pmLine()}`, { tone: 'info', icon: 'lock' }) : null,
    cmd: { cli: `capxul org projects get ${p.name}`, sdk: `client.org(orgId).projects.get("${p.name}")` },
    fde: `Project ${p.name}, ${p.projectName}: ${projStatusText(p)}, ${p.customer ? 'for ' + custName(p.customer) : p.projectType}`,
    body: form,
  });
}
cx.route('project', (ctx) => {
  const p = cx.find(P.projects, 'name', ctx.id);
  if (!p) return cx.page({ title: 'Not found', workspace: 'projects', body: cx.empty('No such project.', cx.btn('All projects', { href: ['projects'] })) });
  return projectPage(p);
}, { workspace: 'projects', title: 'Project' });

/* =====================================================================================================
   Tasks: list, kanban, Gantt, tree; a new task
   ===================================================================================================== */

const taskViews = (active, pid) => [{ label: 'List', route: 'tasks', icon: 'list' }, { label: 'Kanban', route: 'tasks-kanban', icon: 'kanban' }, { label: 'Gantt', route: 'tasks-gantt', icon: 'chart' }, { label: 'Tree', route: 'tasks-tree', icon: 'tree' }].map((v) => ({ ...v, id: pid || null, active: v.route === active }));
const viewBar = (views, ...left) => h('div.pj-tool', ...left, h('span.grow'), h('div.btn-group', views.map((v) => h('a.btn', { href: cx.href(v.route, v.id), class: { primary: v.active }, 'aria-current': v.active ? 'page' : null }, cx.icon(v.icon), h('span', v.label)))));
const openProjects = () => P.projects.filter((p) => ['Open', 'On hold'].includes(p.status));
function projectSelect(route, current, allLabel) {
  return h('select.ctl', { 'aria-label': 'Project', style: 'width:auto;max-width:100%;min-width:0;flex:0 1 auto', onchange: (e) => cx.go(route, e.target.value || null) },
    allLabel ? h('option', { value: '' }, allLabel) : null,
    P.projects.slice().sort((a, b) => (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1) || b.name.localeCompare(a.name)).map((p) => h('option', { value: p.name, selected: p.name === current }, `${p.name} · ${p.projectName}${p.status !== 'Open' ? ' (' + p.status + ')' : ''}`)));
}
const TASK_TABS = [
  { label: 'Not completed', filter: isOpenTask, status: 'open' },
  { label: 'Open', filter: (t) => t.status === 'Open', status: 'open' },
  { label: 'Overdue', filter: (t) => t.status === 'Overdue', status: 'overdue' },
  { label: 'All' },
];
async function bulkTasks(rows, to) {
  let n = 0;
  for (const t of rows) if (t.status !== to && !t.isGroup) { if (await taskMove(t, to, { confirmed: true })) n++; }
  if (n) { cx.toast(`${fmt.plural(n, 'task')} set to ${to}`, { tone: 'success' }); cx.refresh(); }
}
cx.route('tasks', (ctx) => {
  const proj = ctx.id ? cx.find(P.projects, 'name', ctx.id) : null;
  return cx.page({
    title: 'Tasks', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    sub: proj ? h('span', 'In ', projLink(proj.name, proj.projectName)) : 'Project tasks. The CRM keeps its own tasks.',
    actions: [cx.btn('Add task', { kind: 'primary', icon: 'plus', needs: MEMBER, cmd: `capxul org projects task create "<subject>"${proj ? ' --project ' + proj.name : ''}`, onClick: () => newTaskModal({ project: proj?.name }) })],
    fde: proj ? `The tasks of ${proj.projectName}` : 'The project tasks',
    body: cx.listView({
      key: 'pj-tasks', rows: () => P.tasks, id: (t) => t.name, initial: proj ? { filters: { project: proj.name } } : null,
      titleCol: { key: 'subject', label: 'Subject', sub: (t) => projName(t.project) },
      status: (t) => taskPill(t.status),
      columns: [{ key: 'project', label: 'Project' }, { key: 'isGroup', label: 'Is group', type: 'check' }, { key: 'priority', label: 'Priority', render: (t) => cx.pill(t.priority || 'Low', PRIORITY_TONE[t.priority] || 'gray') }, { key: 'isMilestone', label: 'Is milestone', type: 'check' }, { key: 'expEnd', label: 'Expected end', type: 'date' }, { key: 'assignees', label: 'Assigned to', render: (t) => avatars(t.assignees) }],
      filters: [{ key: 'name', label: 'ID' }, { key: 'subject', label: 'Subject' }, { key: 'project', label: 'Project', type: 'select', options: () => P.projects.map((p) => [p.name, `${p.name} · ${p.projectName}`]) }, { key: 'status', label: 'Status', type: 'select', options: TASK_STATUSES }, { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] }],
      tabs: TASK_TABS,
      sort: { options: [{ key: 'expEnd', label: 'Expected end' }, { key: 'expStart', label: 'Expected start' }, { key: 'name', label: 'ID' }, { key: 'priority', label: 'Priority' }], default: { key: 'expEnd', dir: 'asc' } },
      groupBy: [{ key: 'status', label: 'Status' }, { key: 'project', label: 'Project', format: (v) => projName(v) }, { key: 'priority', label: 'Priority' }],
      href: (t) => ['task', t.name],
      bulk: [{ label: 'Set as open', icon: 'refresh', needs: MEMBER, cmd: 'capxul org projects task reopen <task>', onClick: (rows) => bulkTasks(rows, 'Open') }, { label: 'Set as completed', icon: 'check', needs: MEMBER, cmd: 'capxul org projects task complete <task>', onClick: (rows) => bulkTasks(rows, 'Completed') }],
      views: taskViews('tasks', proj?.name),
      cmd: (st) => { const f = st.filters; const status = f.status ? lc(f.status) : TASK_TABS[st.tab]?.status; const parts = [f.project ? `--project ${f.project}` : null, status ? `--status ${status}` : null].filter(Boolean); return { cli: `capxul org projects task list${parts.length ? ' ' + parts.join(' ') : ''}`, sdk: `client.org(orgId).projects.tasks.list(${parts.length ? `{ ${[f.project ? `project: "${f.project}"` : null, status ? `status: "${status}"` : null].filter(Boolean).join(', ')} }` : ''})` }; },
      noun: 'task', empty: 'No tasks match.',
    }),
  });
}, { workspace: 'projects', title: 'Tasks' });

cx.route('tasks-kanban', (ctx) => {
  const proj = ctx.id ? cx.find(P.projects, 'name', ctx.id) : null;
  const scope = proj ? [proj.name] : openProjects().map((p) => p.name);
  const rows = P.tasks.filter((t) => scope.includes(t.project) && !t.isGroup);
  const sortFor = (st) => (st === 'Completed' ? (a, b) => String(b.completedOn || '').localeCompare(String(a.completedOn || '')) : (a, b) => String(a.expEnd || '').localeCompare(String(b.expEnd || '')));
  const card = (t) => h('div.pj-kbc', h('div.kb-title', t.subject), h('div.sub', `${t.name} · ${projName(t.project)}`),
    h('div.row', cx.pill(t.priority || 'Low', PRIORITY_TONE[t.priority] || 'gray'), t.isMilestone ? cx.tag('Milestone') : null, h('span.grow'), t.expEnd ? h('span', { class: isOpenTask(t) && t.expEnd < TODAY ? 'late' : null }, fmt.day(t.expEnd)) : null),
    !['Open'].includes(t.status) || t.progress ? pctBar(t.status === 'Completed' ? 100 : t.progress) : null,
    (t.assignees || []).length ? h('div.row', avatars(t.assignees), h('span', t.assignees.map(cx.firstName).join(', '))) : h('div.row', h('span.faint', 'Unassigned')));
  return cx.page({
    title: proj ? `${proj.projectName}: tasks` : 'Task status board', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Tasks', route: 'tasks' }],
    sub: proj ? null : 'The tasks of the open projects and the one on hold.',
    actions: [cx.btn('Add task', { kind: 'primary', icon: 'plus', needs: MEMBER, onClick: () => newTaskModal({ project: proj?.name }) })],
    cmd: { cli: `capxul org projects task list${proj ? ' --project ' + proj.name : ''}`, note: 'A drop runs the task\'s verb: start, review, complete, reopen or cancel. A task falls Overdue on its own.' },
    fde: proj ? `The kanban board of ${proj.projectName}'s tasks` : 'The task status board',
    body: h('div', { style: 'display:grid;gap:10px;min-width:0' }, viewBar(taskViews('tasks-kanban', proj?.name), projectSelect('tasks-kanban', proj?.name, 'All open projects')),
      cx.kanban({ key: 'pj-kb', id: (t) => t.name, limit: 10,
        columns: TASK_STATUSES.map((st) => ({ key: st, label: st, color: TASK_TONE[st], items: rows.filter((t) => t.status === st).sort(sortFor(st)) })),
        card: (t) => card(t),
        onMove: (t, to) => taskMove(t, to),
        onOpen: (t) => cx.go('task', t.name) })),
  });
}, { workspace: 'projects', title: 'Tasks' });

/* ---------- the Gantt chart, drawn to scale ---------- */

const GMODES = { Day: 34, Week: 11, Month: 3.4 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ganttView(project, rows, o) {
  const root = h('div.pj-gantt');
  let keepScroll = null;
  const draw = () => {
    const prevScroll = root.querySelector('.pj-g-scroll')?.scrollLeft;
    const mode = cx.store.get('pj-gantt-mode', 'Week');
    const ppd = GMODES[mode] || GMODES.Week;
    const RH = 30, HEAD = 46;
    const dated = rows.filter((r) => r.t.expStart && r.t.expEnd);
    if (!dated.length) { cx.fill(root, cx.empty('No dated tasks in this project yet.')); return; }
    let from = dated.reduce((m, r) => (r.t.expStart < m ? r.t.expStart : m), dated[0].t.expStart);
    let to = dated.reduce((m, r) => (r.t.expEnd > m ? r.t.expEnd : m), dated[0].t.expEnd);
    if (TODAY > to) to = TODAY; if (TODAY < from) from = TODAY;
    from = addDays(from, -({ Day: 3, Week: 10, Month: 20 }[mode]));
    if (mode !== 'Day') { while (weekday(from) !== 1) from = addDays(from, -1); }
    if (mode === 'Month') from = from.slice(0, 8) + '01';
    to = addDays(to, { Day: 5, Week: 21, Month: 45 }[mode]);
    const days = daysBetween(from, to) + 1;
    const W = Math.round(days * ppd) + 190, H = HEAD + rows.length * RH + 4;
    const x = (d) => daysBetween(from, d) * ppd;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Gantt chart of ${projName(project)}` });
    // grid and headers
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i), xx = x(d), dd = +d.slice(8, 10), wd = weekday(d);
      if (mode === 'Day' && (wd === 0 || wd === 6)) svg.append(s('rect', { x: xx, y: HEAD, width: ppd, height: H - HEAD, style: 'fill:var(--surface-2)' }));
      const unitStart = mode === 'Day' ? true : mode === 'Week' ? wd === 1 : dd === 1;
      if (unitStart) svg.append(s('line', { x1: xx, x2: xx, y1: 22, y2: H, style: `stroke:var(--chart-grid);stroke-width:1` }));
      if (mode === 'Day') svg.append(s('text', { x: xx + ppd / 2, y: 39, 'text-anchor': 'middle', style: wd === 0 || wd === 6 ? 'fill:var(--faint)' : null }, String(dd)));
      if (mode === 'Week' && wd === 1) svg.append(s('text', { x: xx + 4, y: 39 }, `${dd} ${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)}`));
      if (mode === 'Month' && dd === 1) svg.append(s('text', { x: xx + 4, y: 39 }, MONTHS[+d.slice(5, 7) - 1].slice(0, 3)));
      const topStart = mode === 'Month' ? d.slice(5, 10) === '01-01' || i === 0 : dd === 1 || i === 0;
      if (topStart) { svg.append(s('line', { x1: xx, x2: xx, y1: 0, y2: 22, style: 'stroke:var(--line);stroke-width:1' })); svg.append(s('text', { x: xx + 5, y: 15, style: 'font-weight:600;fill:var(--fg-2)' }, mode === 'Month' ? d.slice(0, 4) : `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`)); }
    }
    svg.append(s('line', { x1: 0, x2: W, y1: 22, y2: 22, style: 'stroke:var(--line)' }), s('line', { x1: 0, x2: W, y1: HEAD, y2: HEAD, style: 'stroke:var(--line)' }));
    rows.forEach((_, i) => svg.append(s('line', { x1: 0, x2: W, y1: HEAD + (i + 1) * RH, y2: HEAD + (i + 1) * RH, style: 'stroke:var(--chart-grid)' })));
    const tx = x(TODAY) + ppd / 2;
    svg.append(s('line', { x1: tx, x2: tx, y1: 22, y2: H, style: 'stroke:var(--neg);stroke-width:1.5;stroke-dasharray:3 3' }), s('text', { x: tx + 4, y: H - 6, style: 'fill:var(--neg);font-weight:600' }, 'Today'));
    // bars
    const pos = new Map();
    const deps = s('g'); svg.append(deps);
    rows.forEach(({ t }, i) => {
      if (!t.expStart || !t.expEnd) return;
      const y = HEAD + i * RH;
      const x0 = x(t.expStart), x1 = x(addDays(t.expEnd, 1));
      const fill = TASK_FILL[t.status] || 'var(--chart-1)';
      const prog = t.status === 'Completed' ? 1 : Math.max(0, Math.min(1, (t.progress || 0) / 100));
      const g = s('g', { class: t.isGroup ? null : 'pj-g-bar', tabindex: '0', 'aria-label': `${t.subject}, ${fmt.date(t.expStart)} to ${fmt.date(t.expEnd)}`, style: t.isGroup ? 'cursor:pointer' : 'touch-action:pan-y' });
      g.append(s('title', `${t.subject}\n${fmt.date(t.expStart)} to ${fmt.date(t.expEnd)} · ${t.status}${t.isGroup ? '' : ` · ${Math.round(prog * 100)}%`}`));
      if (t.isMilestone) {
        const cx0 = x(t.expEnd) + ppd / 2, cy = y + RH / 2;
        g.append(s('path', { d: `M${cx0},${cy - 8} L${cx0 + 8},${cy} L${cx0},${cy + 8} L${cx0 - 8},${cy} Z`, style: `fill:${t.status === 'Completed' ? 'var(--t-green)' : 'var(--chart-6)'}` }));
        pos.set(t.name, { x0: cx0 - 8, x1: cx0 + 8, y: cy });
        g.append(s('text', { x: cx0 + 13, y: cy + 4, style: 'fill:var(--fg-2);font-weight:600' }, t.subject));
      } else if (t.isGroup) {
        g.append(s('rect', { x: x0, y: y + 10, width: Math.max(4, x1 - x0), height: 7, rx: 1, style: 'fill:var(--fg-2);opacity:.75' }), s('path', { d: `M${x0},${y + 17} l0,5 l6,-5 Z M${x1},${y + 17} l0,5 l-6,-5 Z`, style: 'fill:var(--fg-2);opacity:.75' }));
        g.append(s('text', { x: x1 + 8, y: y + 19, style: 'fill:var(--fg);font-weight:600' }, t.subject));
        pos.set(t.name, { x0, x1, y: y + RH / 2 });
      } else {
        const w = Math.max(4, x1 - x0);
        g.append(s('rect', { x: x0, y: y + 7, width: w, height: 16, rx: 3, style: `fill:${fill};opacity:.28` }));
        if (prog) g.append(s('rect', { x: x0, y: y + 7, width: Math.max(3, w * prog), height: 16, rx: 3, style: `fill:${fill}` }));
        const label = t.subject.length > 46 ? t.subject.slice(0, 45) + '…' : t.subject;
        g.append(s('text', { x: x0 + w + 6, y: y + 19, style: 'fill:var(--fg-2)' }, label));
        pos.set(t.name, { x0, x1: x0 + w, y: y + RH / 2 });
      }
      bindBar(g, t, ppd);
      svg.append(g);
    });
    for (const { t } of rows) for (const dn of t.dependsOn || []) {
      const a = pos.get(dn), b = pos.get(t.name); if (!a || !b) continue;
      const mid = b.x0 - 10 >= a.x1 + 6 ? Math.max(a.x1 + 6, b.x0 - 10) : null;
      const d = mid != null ? `M${a.x1},${a.y} H${mid} V${b.y} H${b.x0 - 1}` : `M${a.x1},${a.y} h8 V${(a.y + b.y) / 2} H${b.x0 - 10} V${b.y} H${b.x0 - 1}`;
      deps.append(s('path', { d, style: 'fill:none;stroke:var(--chart-axis);stroke-width:1.2' }), s('path', { d: `M${b.x0 - 1},${b.y} l-5,-3.5 v7 z`, style: 'fill:var(--chart-axis)' }));
    }
    const labels = h('div.pj-g-labels', h('div.hd', 'Task'), rows.map(({ t, depth }) => h('a', { href: cx.href('task', t.name), class: { grp: t.isGroup }, style: { paddingLeft: (10 + depth * 14) + 'px' }, title: t.subject },
      t.isMilestone ? s('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: 'M5,0 L10,5 L5,10 L0,5 Z', style: 'fill:var(--chart-6)' })) : h('span', { style: `width:8px;height:8px;border-radius:2px;flex:none;background:${t.isGroup ? 'var(--fg-2)' : TASK_FILL[t.status]}` }), h('span', t.subject))));
    const scroll = h('div.pj-g-scroll', svg);
    const legend = h('div.pj-legend', TASK_STATUSES.map((st) => h('span', h('i', { style: { background: TASK_FILL[st] } }), st)), h('span', h('i', { style: { background: 'var(--fg-2)', height: '5px' } }), 'Group'), h('span', h('i', { style: { background: 'var(--chart-6)', width: '9px', height: '9px', transform: 'rotate(45deg)', borderRadius: '1px' } }), 'Milestone'), h('span', h('i', { style: { background: 'var(--neg)', width: '2px' } }), 'Today'), h('span', cx.allowed(MEMBER).ok ? 'Drag a bar to move its dates.' : ''));
    cx.fill(root, h('div.pj-g-body', labels, scroll), legend);
    keepScroll = true;
    const restore = prevScroll;
    requestAnimationFrame(() => { scroll.scrollLeft = restore != null ? restore : Math.max(0, tx - Math.min(160, scroll.clientWidth * 0.3)); });
  };
  function bindBar(g, t, ppd) {
    let start = null, moved = 0;
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') popup(t, g); });
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = e.clientX; moved = 0;
      if (t.isGroup) return;
      try { g.setPointerCapture(e.pointerId); } catch { /* */ }
      g.classList.add('dragging');
    });
    g.addEventListener('pointermove', (e) => { if (start == null || t.isGroup) return; moved = e.clientX - start; g.setAttribute('transform', `translate(${Math.round(moved / ppd) * ppd},0)`); });
    const end = () => {
      if (start == null) return;
      start = null; g.classList.remove('dragging');
      const dd = Math.round(moved / ppd);
      if (Math.abs(moved) < 4 || t.isGroup) { g.removeAttribute('transform'); popup(t, g); return; }
      if (!dd) { g.removeAttribute('transform'); return; }
      const allow = cx.allowed(MEMBER);
      if (!allow.ok) { cx.toast(allow.reason, { tone: 'warning' }); g.removeAttribute('transform'); return; }
      const was = { s: t.expStart, e: t.expEnd, st: t.status };
      const x = { subject: t.subject, priority: t.priority, expStart: addDays(t.expStart, dd), expEnd: addDays(t.expEnd, dd), expectedTime: t.expectedTime };
      const cmd = taskChangeCmd(t, x);
      applyTaskChange(t, x);
      cx.showAction(cmd, 'Move the dates', { pin: true });
      cx.toast(`${t.subject}: ${fmt.date(t.expStart)} to ${fmt.date(t.expEnd)}`, { tone: 'success', cmd, action: { label: 'Undo', onClick: () => { t.expStart = was.s; t.expEnd = was.e; t.status = was.st; cx.toast('Moved back', { tone: 'info', cmd: `capxul org projects task change ${t.name} --start ${was.s} --end ${was.e}` }); draw(); } } });
      draw();
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', () => { start = null; g.classList.remove('dragging'); g.removeAttribute('transform'); });
  }
  function popup(t, g) {
    root.querySelector('.pj-pop')?.remove();
    const b = g.getBoundingClientRect(), r = root.getBoundingClientRect();
    const tt = taskTotals(t);
    const pop = h('div.pj-pop', { role: 'dialog', 'aria-label': t.subject },
      h('h4', t.subject),
      cx.kv([['Project', projLink(t.project, projName(t.project))], ['Expected', `${fmt.date(t.expStart)} to ${fmt.date(t.expEnd)}`], ['Status', taskPill(t.status)], t.isGroup ? null : ['Progress', `${t.status === 'Completed' ? 100 : t.progress || 0}% · ${fmt.hours(tt.hours)} logged`], ['Assigned to', (t.assignees || []).length ? t.assignees.map(cx.name).join(', ') : 'Nobody'], (t.dependsOn || []).length ? ['Depends on', t.dependsOn.map((d) => TASK.get(d)?.subject || d).join(', ')] : null]),
      h('div', { style: 'display:flex;gap:6px' }, cx.btn('Open the task', { sm: true, kind: 'primary', href: ['task', t.name] }), cx.btn('Close', { sm: true, onClick: () => pop.remove() })));
    pop.style.left = Math.max(8, Math.min(r.width - 300, b.left - r.left + 40)) + 'px';
    root.appendChild(pop);
    const below = b.bottom - r.top + 6;
    pop.style.top = (below + pop.offsetHeight > r.height - 8 ? Math.max(8, b.top - r.top - pop.offsetHeight - 6) : below) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  root.redraw = draw;
  draw();
  return root;
}
cx.route('tasks-gantt', (ctx) => {
  const proj = (ctx.id ? cx.find(P.projects, 'name', ctx.id) : null) || PROJ.get(cx.store.get('pj-gantt-project', 'PROJ-0011')) || openProjects()[0];
  cx.store.set('pj-gantt-project', proj.name);
  const rows = treeOrder(tasksOf(proj.name));
  const mode = cx.store.get('pj-gantt-mode', 'Week');
  let chart;
  const seg = h('div.pj-seg', { role: 'group', 'aria-label': 'View mode' }, Object.keys(GMODES).map((m) => h('button', { type: 'button', 'aria-pressed': String(m === mode), onclick: (e) => { cx.store.set('pj-gantt-mode', m); [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); chart.redraw(); } }, m)));
  const todayBtn = cx.btn('Today', { icon: 'calendar', onClick: () => { const sc = chart.querySelector('.pj-g-scroll'); const line = [...chart.querySelectorAll('.pj-g-scroll svg text')].find((t) => t.textContent === 'Today'); if (sc && line) sc.scrollTo({ left: Math.max(0, +line.getAttribute('x') - 160), behavior: 'smooth' }); } });
  chart = ganttView(proj.name, rows, {});
  return cx.page({
    title: 'Gantt chart', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Tasks', route: 'tasks' }],
    sub: h('span', projLink(proj.name, `${proj.name} · ${proj.projectName}`), ` · ${fmt.date(proj.expectedStart)} to ${fmt.date(proj.expectedEnd)} · ${fmt.plural(rows.length, 'task')}`),
    actions: [cx.btn('Add task', { icon: 'plus', needs: MEMBER, onClick: () => newTaskModal({ project: proj.name }) })],
    cmd: { cli: `capxul org projects task list --project ${proj.name}`, sdk: `client.org(orgId).projects.tasks.list({ project: "${proj.name}" })`, note: 'A drag runs capxul org projects task change with --start and --end.' },
    fde: `The Gantt chart of ${proj.projectName}`,
    body: [viewBar(taskViews('tasks-gantt', proj.name), projectSelect('tasks-gantt', proj.name), seg, todayBtn), chart],
  });
}, { workspace: 'projects', title: 'Gantt chart' });

/* ---------- the task tree ---------- */

cx.route('tasks-tree', (ctx) => {
  const proj = (ctx.id ? cx.find(P.projects, 'name', ctx.id) : null) || PROJ.get('PROJ-0011') || openProjects()[0];
  const list = tasksOf(proj.name);
  const node = (t) => ({ id: t.name, label: t.subject, sub: t.name, group: t.isGroup, href: ['task', t.name], badges: [taskPill(t.status), t.isMilestone ? cx.tag('Milestone') : null, (t.dependsOn || []).length ? cx.tag(`after ${(t.dependsOn || []).map((d) => TASK.get(d)?.subject || d).join(', ')}`) : null].filter(Boolean), value: t.isGroup ? null : `${t.status === 'Completed' ? 100 : t.progress || 0}%`, children: list.filter((c) => c.parent === t.name).sort((a, b) => String(a.expStart).localeCompare(String(b.expStart))).map(node) });
  const roots = [{ id: 'all', label: 'All Tasks', group: true, open: true, children: list.filter((t) => !t.parent).sort((a, b) => String(a.expStart).localeCompare(String(b.expStart))).map(node) }];
  return cx.page({
    title: 'Task tree', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Tasks', route: 'tasks' }],
    sub: h('span', projLink(proj.name, `${proj.name} · ${proj.projectName}`)),
    cmd: { cli: `capxul org projects task list --project ${proj.name}`, note: 'Add child runs capxul org projects task create with --parent.' },
    fde: `The task tree of ${proj.projectName}`,
    body: [viewBar(taskViews('tasks-tree', proj.name), projectSelect('tasks-tree', proj.name)),
      cx.card({ body: cx.treeView({ key: 'pj-tree-' + proj.name, depth: 2, roots,
        toolbar: (n) => {
          const t = TASK.get(n.id);
          if (n.id === 'all') return [cx.btn('Add child', { sm: true, icon: 'plus', needs: MEMBER, cmd: `capxul org projects task create "<subject>" --project ${proj.name}`, onClick: () => newTaskModal({ project: proj.name, stay: true }) }), cx.btn('Add multiple', { sm: true, needs: MEMBER, onClick: () => addMultiple(proj, null) })];
          return [cx.btn('Open', { sm: true, href: ['task', t.name], cmd: `capxul org projects task get ${t.name}` }), t.isGroup ? cx.btn('Add child', { sm: true, icon: 'plus', needs: MEMBER, cmd: `capxul org projects task create "<subject>" --project ${proj.name} --parent ${t.name}`, onClick: () => newTaskModal({ project: proj.name, parent: t.name, stay: true }) }) : null, t.isGroup ? cx.btn('Add multiple', { sm: true, needs: MEMBER, onClick: () => addMultiple(proj, t) }) : null].filter(Boolean);
        } }) })],
  });
}, { workspace: 'projects', title: 'Task tree' });
function addMultiple(proj, parent) {
  const m = { subjects: '' };
  formModal({ title: parent ? `Add tasks under ${parent.subject}` : `Add tasks to ${proj.projectName}`, model: m, cols: 1, needs: MEMBER, submit: 'Add', who: 'any member',
    fields: [{ label: 'Subjects, one a line', key: 'subjects', type: 'textarea', rows: 6, reqd: true, placeholder: 'Order history screen\nPush notifications\nApp Store listing' }],
    cmd: (x) => { const ls = x.subjects.split('\n').map((v) => v.trim()).filter(Boolean); return (ls.length ? ls : ['<subject>']).map((sbj) => `capxul org projects task create ${q(sbj)} --project ${proj.name}${parent ? ' --parent ' + parent.name : ''}`); },
    onSubmit: (x, close) => { const ls = x.subjects.split('\n').map((v) => v.trim()).filter(Boolean); ls.forEach((sbj) => createTask({ subject: sbj, project: proj.name, parent: parent?.name || null })); close(); cx.toast(`${fmt.plural(ls.length, 'task')} added`, { tone: 'success' }); cx.refresh(); } });
}
function createTask(x) {
  const name = nextName(`TASK-${TODAY.slice(0, 4)}-`, P.tasks.map((t) => t.name));
  const p = PROJ.get(x.project);
  const t = { project: x.project, subject: x.subject, phase: null, expStart: x.expStart || TODAY, expEnd: x.expEnd || addDays(TODAY, 14), isGroup: !!x.isGroup, weight: +x.weight || (x.isGroup ? 0 : 1), assignees: [], expectedTime: +x.expectedTime || 0, isMilestone: !!x.isMilestone, dependsOn: x.dependsOn ? [x.dependsOn] : [], status: 'Open', progress: 0, name, priority: x.priority || 'Medium', department: p?.department || null, parent: x.parent || null, description: x.description || null, actualTime: 0, actualStart: null, actualEnd: null, totalCosting: 0, totalBillable: 0, createdAt: NOW(), createdBy: cx.meId(), history: [{ at: NOW(), who: cx.meId(), kind: 'created', text: 'created the task' }] };
  P.tasks.push(t); TASK.set(name, t); TBASE.set(name, { cost: 0, billable: 0, hours: 0 });
  if (p) { p.taskCount = (p.taskCount || 0) + 1; recalcProject(p); }
  if (t.parent) recalcGroup(t.parent);
  return t;
}
function newTaskModal(pre = {}) {
  const proj0 = pre.project || 'PROJ-0011';
  const best = suggestAssignee({ activity: DEPT_ACT[PROJ.get(proj0)?.department] || 'Engineering', project: proj0, from: TODAY, to: addDays(TODAY, 14), hours: 16 })[0];
  const m = { subject: '', project: proj0, parent: pre.parent || '', isGroup: 0, priority: 'Medium', expStart: TODAY, expEnd: addDays(TODAY, 14), expectedTime: 16, weight: 1, isMilestone: 0, dependsOn: '', who: best?.id || '' };
  formModal({ title: 'New task', model: m, needs: MEMBER, submit: 'Create', who: 'any member', wide: true,
    fields: [
      { label: 'Subject', key: 'subject', reqd: true, wide: true, placeholder: 'Order history screen' },
      { label: 'Project', key: 'project', type: 'select', options: P.projects.map((p) => [p.name, `${p.name} · ${p.projectName}`]) },
      { label: 'Parent task', key: 'parent', type: 'select', options: [['', '—'], ...P.tasks.filter((t) => t.isGroup).map((t) => [t.name, `${t.subject} · ${t.project}`])], help: 'A group task in the same project' },
      { label: 'Priority', key: 'priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] }, { label: 'Weight', key: 'weight', type: 'int' },
      { label: 'Expected start date', key: 'expStart', type: 'date' }, { label: 'Expected end date', key: 'expEnd', type: 'date' },
      { label: 'Expected time (in hours)', key: 'expectedTime', type: 'float' }, { label: 'Depends on', key: 'dependsOn', type: 'select', options: [['', '—'], ...P.tasks.filter((t) => !t.isGroup && isOpenTask(t)).map((t) => [t.name, `${t.subject} · ${t.project}`])] },
      { label: 'Is group', key: 'isGroup', type: 'check', checkLabel: 'Holds other tasks' }, { label: 'Is milestone', key: 'isMilestone', type: 'check', checkLabel: 'A milestone' },
      { label: 'Assigned to', key: 'who', type: 'select', wide: true, options: [['', 'Nobody yet'], ...TEAM().map((id) => [id, `${cx.name(id)} · ${cx.person(id)?.designation || ''}`])], help: best ? `The project agent suggests ${cx.name(best.id)} for the next two weeks: ${whyText(best, TODAY, addDays(TODAY, 14))}.` : null },
    ],
    cmd: (x) => `capxul org projects task create ${q(x.subject || '<subject>')} --project ${x.project}${x.parent ? ' --parent ' + x.parent : ''}${x.isGroup ? ' --group' : ''}${x.dependsOn ? ' --depends-on ' + x.dependsOn : ''} --start ${x.expStart} --end ${x.expEnd}${x.expectedTime ? ' --hours ' + x.expectedTime : ''} --priority ${x.priority.toLowerCase()}${x.weight ? ' --weight ' + x.weight : ''}${x.isMilestone ? ' --milestone' : ''}`,
    check: (x) => (x.expEnd < x.expStart ? 'The expected end comes before the start.' : x.parent && TASK.get(x.parent)?.project !== x.project ? 'The parent task is in another project.' : x.dependsOn && TASK.get(x.dependsOn)?.project !== x.project ? 'A dependency must be in the same project.' : null),
    onSubmit: (x, close, cmd) => { const t = createTask(x); if (x.who) { t.assignees = [x.who]; t.assignNote = best && x.who === best.id ? { why: whyText(best, TODAY, addDays(TODAY, 14)), acceptedBy: cx.meId(), at: NOW() } : null; } close(); cx.toast(`Created ${t.name}: ${t.subject}`, { tone: 'success', cmd }); if (pre.stay) cx.refresh(); else cx.go('task', t.name); } });
}

/* ---------- who works a task: the agent's suggestion, and the change ---------- */

const DEPT_ACT = { design: 'Design', engineering: 'Engineering', delivery: 'Engineering', growth: 'Design', operations: 'Planning' };
function activityOfTask(t) {
  const by = new Map(); for (const l of logIndex().byTask.get(t.name) || []) by.set(l.activity, (by.get(l.activity) || 0) + l.hours);
  const top = [...by.entries()].filter(([a]) => !['Communication', 'Research'].includes(a)).sort((a, b) => b[1] - a[1])[0]?.[0];
  return top || ((t.assignees || [])[0] && mainActivity(t.assignees[0])) || DEPT_ACT[t.department || PROJ.get(t.project)?.department] || 'Engineering';
}
const skillText = (id) => [mainActivity(id), ...(SKILLS[id] || [])].filter(Boolean).slice(0, 3).join(', ').toLowerCase();
/** Why the agent picked someone: what they do, what they have free, and their leave in the task's dates. */
function whyText(x, from, to) {
  const did = P.tasks.filter((k) => k.status === 'Completed' && (k.assignees || []).includes(x.id)).sort((a, b) => String(b.completedOn).localeCompare(String(a.completedOn)))[0];
  return `${skillText(x.id)}${did ? `, built ${did.subject}` : ''}; ${fmt.int(x.free)} h free ${spanText(from, to)}${x.off.length ? ' (' + x.off.map(leaveText).join(', ') + ')' : ''}`;
}
function assignNoteOf(t) {
  if (t.assignNote !== undefined) return t.assignNote;
  const p = PROJ.get(t.project); const plan = p ? planOf(p) : null;
  if (!plan?.byAgent || t.createdAt || t.isGroup || !(t.assignees || []).length) return null;
  return { why: t.assignees.map((id) => `${cx.firstName(id)}: ${skillText(id)}`).join('; '), withPlan: true, acceptedBy: plan.acceptedBy, at: plan.acceptedAt };
}
const assignNoteEl = (t) => { const n = assignNoteOf(t); return n ? h('p.pj-note', `Suggested by the project agent${n.withPlan ? ' with the plan' : ''} from availability and skills (${n.why}), accepted by ${cx.name(n.acceptedBy)} on ${fmt.date(n.at)}.`) : null; };
function forecastText(t, FC) {
  const f = FC.get(t.name); if (!f) return h('span.faint', '—');
  if (f.slip <= 0) return h('span', fmt.date(f.end), h('span', { style: 'color:var(--pos)' }, ' · on time'));
  const why = slipCause(t, FC);
  return h('span', h('span', { style: 'color:var(--neg);font-weight:600' }, `${fmt.date(f.end)} · ${fmt.plural(f.slip, 'working day')} late`), why ? h('span.muted', ` · ${why}`) : null);
}
function reassign(t, to, o = {}) {
  const was = (t.assignees || []).slice();
  if (!to || (was.length === 1 && was[0] === to)) return false;
  t.assignees = [to];
  t.assignNote = o.note ? { ...o.note, acceptedBy: cx.meId(), at: NOW() } : null;
  noteOn(t, `assigned it to ${cx.name(to)}${was.length ? ' instead of ' + namesList(was) : ''}${o.note ? ', as the project agent suggested' : ''}`, 'change');
  const p = PROJ.get(t.project); if (p && !(p.members || []).includes(to)) (p.members ||= []).push(to);
  cx.toast(`${t.subject}: assigned to ${cx.name(to)}`, { tone: 'success' });
  cx.refresh();
  return true;
}
function assignModal(t) {
  const from = t.expStart > TODAY ? t.expStart : TODAY, to = t.expEnd >= from ? t.expEnd : addDays(from, 14);
  const B = bookings();
  const sug = suggestAssignee({ subject: t.subject, activity: activityOfTask(t), project: t.project, from, to, hours: remainingOf(t) || t.expectedTime });
  const best = sug[0];
  const m = { who: best?.id || (t.assignees || [])[0] || '' };
  const opts = TEAM().map((id) => [id, `${cx.name(id)} · ${fmt.int(freeHours(id, from, to, B))} h free${offText(id, from, to) ? ' · ' + offText(id, from, to) : ''}`]);
  formModal({ title: `Who works on "${t.subject}"`, model: m, cols: 1, needs: MEMBER, submit: 'Assign',
    intro: h('div', { style: 'display:grid;gap:6px' }, h('p.muted', { style: 'font-size:13px' }, `${fmt.hours(remainingOf(t))} left, ${spanText(from, to)}. Free hours count leave from HR and what each person is already booked on.`),
      best ? h('p', { style: 'font-size:13px' }, h('b', `The project agent suggests ${cx.name(best.id)}`), `: ${whyText(best, from, to)}.`) : null),
    fields: [{ label: 'Assigned to', key: 'who', type: 'select', options: opts }],
    onSubmit: (x, close) => { close(); reassign(t, x.who, best && x.who === best.id ? { note: { why: whyText(best, from, to) } } : {}); } });
}

/* =====================================================================================================
   The task form
   ===================================================================================================== */

function taskTimeline(t) {
  const items = [];
  if (t.createdAt) items.push({ at: t.createdAt, who: t.createdBy, kind: 'created', text: 'created this task' });
  const byTs = new Map();
  for (const l of logIndex().byTask.get(t.name) || []) { if (!liveTs(l.timesheet)) continue; const o = byTs.get(l.timesheet) || { hours: 0, from: l.date, to: l.date }; o.hours += l.hours; if (l.date < o.from) o.from = l.date; if (l.date > o.to) o.to = l.date; byTs.set(l.timesheet, o); }
  for (const [name, o] of byTs) { const ts = TSM.get(name); items.push({ at: (ts?.submittedAt || o.to + 'T17:30:00Z'), who: ts?.employee, kind: 'call', icon: 'clock', text: `logged ${fmt.hours(r2(o.hours))} in ${name}`, sub: o.from === o.to ? fmt.date(o.from) : `${fmt.date(o.from)} to ${fmt.date(o.to)}`, href: ['timesheet', name] }); }
  if (t.completedOn && !(t.history || []).some((x) => x.text === 'completed the task')) items.push({ at: t.completedOn + 'T16:00:00Z', who: t.completedBy, kind: 'status', text: 'completed the task' });
  for (const x of t.history || []) items.push({ at: x.at, who: x.who, kind: x.kind === 'created' ? 'created' : x.kind === 'change' ? 'change' : 'status', text: x.text });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 24);
}
function taskPage(t) {
  const p = PROJ.get(t.project);
  const canEdit = cx.allowed(MEMBER).ok;
  const FC = forecastAll();
  const fc = FC.get(t.name);
  const draft = { subject: t.subject, priority: t.priority, expStart: t.expStart, expEnd: t.expEnd, expectedTime: t.expectedTime, weight: t.weight, isMilestone: t.isMilestone ? 1 : 0, description: t.description || '', dependsOn: (t.dependsOn || []).join(', ') };
  const tt = taskTotals(t);
  const cur = projCurrency(p);
  const changed = () => taskChangeCmd(t, draft) !== `capxul org projects task change ${t.name}` || (draft.description || '') !== (t.description || '');
  const saveBtn = cx.btn('Save', { kind: 'primary', needs: MEMBER, onClick: () => { const cmd = taskChangeCmd(t, draft); applyTaskChange(t, draft); cx.toast(`${t.subject} saved`, { tone: 'success', cmd }); cx.refresh(); } });
  saveBtn.hidden = true;
  const onChange = () => { const c = changed(); saveBtn.hidden = !c; if (c) cx.showAction(taskChangeCmd(t, draft), 'Save', { pin: true }); };
  const logs = (logIndex().byTask.get(t.name) || []).filter((l) => liveTs(l.timesheet)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const deps = (t.dependsOn || []).map((d) => TASK.get(d)).filter(Boolean);
  const dependents = P.tasks.filter((x) => (x.dependsOn || []).includes(t.name));
  const kids = P.tasks.filter((x) => x.parent === t.name);
  const form = cx.formView({
    doc: draft, editable: canEdit, tabKey: 'pj-task', onChange,
    tabs: [
      { label: 'Details', sections: [
        { columns: [
          [{ label: 'Subject', key: 'subject', reqd: true }, { label: 'Project', value: t.project, readOnly: true, render: () => projLink(t.project, `${t.project} · ${projName(t.project)}`) }, { label: 'Is group', value: t.isGroup ? 1 : 0, readOnly: true, type: 'check' }],
          [{ label: 'Status', value: t.status, readOnly: true, render: () => taskPill(t.status) }, { label: 'Priority', key: 'priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'] }, { label: 'Weight', key: 'weight', type: 'int' }, { label: 'Parent task', value: t.parent, readOnly: true, render: () => taskLink(t.parent) }]] },
        t.status === 'Completed' ? { columns: [[{ label: 'Completed by', value: t.completedBy, readOnly: true, type: 'person' }], [{ label: 'Completed on', value: t.completedOn, readOnly: true, type: 'date' }]] } : null,
        { label: 'Timeline', collapsible: true, columns: [
          [{ label: 'Expected start date', key: 'expStart', type: 'date' }, { label: 'Expected time (in hours)', key: 'expectedTime', type: 'float' }],
          [{ label: 'Expected end date', key: 'expEnd', type: 'date' }, { label: '% progress', value: t.status === 'Completed' ? 100 : t.progress, readOnly: true, render: () => pctBar(t.status === 'Completed' ? 100 : t.progress), help: 'From the work logged against it.' }, { label: 'Is milestone', key: 'isMilestone', type: 'check', checkLabel: 'A milestone' }, isOpenTask(t) && !t.isGroup ? { label: 'Forecast end', value: fc?.end, readOnly: true, render: () => forecastText(t, FC), help: 'Worked out by the project agent from what is left, what it waits on, and its people’s time and leave.' } : null].filter(Boolean)] },
        { label: 'Details', cols: 1, fields: [{ label: 'Task description', key: 'description', type: 'textarea', placeholder: 'What this task covers' }] },
        { label: 'Assigned to', actions: !t.isGroup && isOpenTask(t) ? cx.btn((t.assignees || []).length ? 'Change' : 'Assign', { sm: true, icon: 'user', needs: MEMBER, onClick: () => assignModal(t) }) : null, node: h('div', { style: 'display:grid;gap:6px' }, (t.assignees || []).length ? h('div.chips', t.assignees.map((id) => cx.personChip(id))) : h('span.faint', 'Nobody yet'), assignNoteEl(t)) },
      ].filter(Boolean) },
      { label: 'Dependencies', sections: [
        { label: 'Dependent tasks', desc: 'This task completes only after these.', table: cx.grid({ numbered: true, rows: deps, empty: 'No dependencies', rowHref: (d) => ['task', d.name], columns: [{ key: 'name', label: 'Task', render: (d) => cx.link(d.name, 'task', d.name) }, { key: 'subject', label: 'Subject' }, { key: 'status', label: 'Status', render: (d) => taskPill(d.status) }] }) },
        { cols: 1, fields: [{ label: 'Depends on (task IDs, comma separated)', key: 'dependsOn', placeholder: 'TASK-2026-00079' }] },
        dependents.length ? { label: 'Tasks that wait on this one', table: cx.grid({ numbered: false, rows: dependents, rowHref: (d) => ['task', d.name], columns: [{ key: 'subject', label: 'Subject', render: (d) => cx.link(d.subject, 'task', d.name) }, { key: 'status', label: 'Status', render: (d) => taskPill(d.status) }] }) } : null,
        kids.length ? { label: `Child tasks (${kids.length})`, table: cx.grid({ numbered: false, rows: kids, rowHref: (d) => ['task', d.name], columns: [{ key: 'subject', label: 'Subject', render: (d) => cx.link(d.subject, 'task', d.name) }, { key: 'status', label: 'Status', render: (d) => taskPill(d.status) }, { key: 'expEnd', label: 'Expected end', type: 'date' }] }) } : null,
        { columns: [[{ label: 'Actual start date (via timesheet)', value: t.actualStart, readOnly: true, type: 'date' }, { label: 'Actual time in hours (via timesheet)', value: tt.hours, readOnly: true, type: 'float', dp: 1 }], [{ label: 'Actual end date (via timesheet)', value: t.actualEnd, readOnly: true, type: 'date' }]] },
        { label: 'Costing', collapsible: true, columns: [[{ label: 'Total costing amount (via timesheet)', value: tt.cost, readOnly: true, type: 'currency', currency: 'GBP' }], [{ label: 'Total billable amount (via timesheet)', value: tt.billable, readOnly: true, type: 'currency', currency: cur }]] },
      ].filter(Boolean) },
      { label: 'Time logs', count: logs.length, render: () => h('div.section', cx.grid({ numbered: false, rows: logs.slice(0, 60), empty: 'No time logged yet', rowHref: (l) => ['timesheet', l.timesheet], columns: [
        { key: 'date', label: 'Date', type: 'date' }, { key: 'emp', label: 'Employee', render: (l) => cx.personChip(TSM.get(l.timesheet)?.employee, { link: false }) }, { key: 'activity', label: 'Activity type', opt: true },
        { key: 'hours', label: 'Hrs', type: 'float', dp: 1 }, { key: 'billable', label: 'Billable', type: 'check', opt: true, render: (l) => (l.billable ? cx.icon('check') : '') }, { key: 'timesheet', label: 'Timesheet', render: (l) => cx.link(l.timesheet, 'timesheet', l.timesheet) }] }), logs.length > 60 ? h('p.muted', { style: 'font-size:12.5px;margin-top:8px' }, `and ${logs.length - 60} earlier logs`) : null) },
      { label: 'More info', sections: [{ columns: [[{ label: 'Review date', value: t.reviewDate, readOnly: true, type: 'date' }, { label: 'Closing date', value: t.completedOn, readOnly: true, type: 'date' }], [{ label: 'Department', value: t.department, readOnly: true, render: () => h('span', cx.deptName(t.department || p?.department)) }]] }] },
    ],
    side: { id: t.name, title: t.subject, cmd: `capxul org projects task get ${t.name}`,
      extra: h('div', { style: 'display:grid;gap:10px' },
        h('div.side-sec', h('h4', 'Assigned to'), (t.assignees || []).length ? h('div.chips', t.assignees.map((id) => cx.personChip(id))) : h('div.faint', 'Nobody')),
        h('div.side-sec', h('h4', 'Logged'), h('div', h('b', fmt.hours(tt.hours)), h('span.muted', t.expectedTime ? ` of ${fmt.hours(t.expectedTime)} expected` : ''))),
        h('div.side-sec', h('h4', 'Project'), projLink(t.project, projName(t.project)))),
      created: t.createdAt ? { by: t.createdBy, at: t.createdAt } : null, modified: t.modifiedAt ? { by: t.modifiedBy, at: t.modifiedAt } : null },
    timeline: { items: taskTimeline(t), comment: false },
  });
  const verb = (label, to, o = {}) => cx.btn(label, { kind: o.primary ? 'primary' : null, icon: o.icon, needs: MEMBER, cmd: o.cmd, onClick: async () => { if (await taskMove(t, to)) cx.refresh(); } });
  const st = t.status;
  const verbs = t.isGroup ? [] : st === 'Open' ? [verb('Start', 'Working', { primary: true, icon: 'right', cmd: `capxul org projects task start ${t.name}` }), verb('Complete', 'Completed', { icon: 'check', cmd: `capxul org projects task complete ${t.name}` })]
    : st === 'Working' ? [verb('Send for review', 'Pending Review', { cmd: `capxul org projects task review ${t.name} --by …` }), verb('Complete', 'Completed', { primary: true, icon: 'check', cmd: `capxul org projects task complete ${t.name}` })]
    : st === 'Pending Review' ? [verb('Back to working', 'Working', { cmd: `capxul org projects task start ${t.name}` }), verb('Complete', 'Completed', { primary: true, icon: 'check', cmd: `capxul org projects task complete ${t.name}` })]
    : st === 'Overdue' ? [cx.btn('Move the end date', { icon: 'calendar', needs: MEMBER, cmd: `capxul org projects task change ${t.name} --end ${addDays(TODAY, 7)}`, onClick: () => taskQuickDialog(t) }), verb('Complete', 'Completed', { primary: true, icon: 'check', cmd: `capxul org projects task complete ${t.name}` })]
    : [verb('Reopen', 'Open', { icon: 'refresh', cmd: `capxul org projects task reopen ${t.name}` })];
  const actions = [saveBtn, ...verbs,
    cx.menu('Create', [{ label: 'Timesheet', icon: 'clock', needs: MEMBER, cmd: `capxul org projects timesheet create --project ${t.project}`, onClick: () => newTimesheetModal({ project: t.project, task: t.name }) }, { label: 'Child task', icon: 'plus', needs: MEMBER, disabled: !t.isGroup, reason: 'Only a group task holds child tasks.', cmd: `capxul org projects task create "<subject>" --project ${t.project} --parent ${t.name}`, onClick: () => newTaskModal({ project: t.project, parent: t.name }) }]),
    cx.menu(null, [isOpenTask(t) ? { label: 'Cancel the task', icon: 'x', danger: true, needs: MEMBER, cmd: `capxul org projects task cancel ${t.name}`, onClick: async () => { if (await taskMove(t, 'Cancelled')) cx.refresh(); } } : null, { label: 'Gantt chart', icon: 'chart', href: ['tasks-gantt', t.project] }, { label: 'Kanban board', icon: 'kanban', href: ['tasks-kanban', t.project] }].filter(Boolean))];
  return cx.page({
    title: t.subject, workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Tasks', route: 'tasks' }, { label: projName(t.project), route: 'project', id: t.project }],
    status: [taskPill(t.status, { lg: true }), t.isMilestone ? cx.pill('Milestone', 'purple', { lg: true }) : null].filter(Boolean),
    sub: `${t.name} · ${fmt.date(t.expStart)} to ${fmt.date(t.expEnd)}${t.status === 'Overdue' ? ` · ${fmt.plural(daysBetween(t.expEnd, TODAY), 'day')} late` : ''}${t.status === 'Pending Review' && t.reviewDate ? ` · review by ${fmt.date(t.reviewDate)}` : ''}`,
    actions,
    banner: openBlockers(t).length && isOpenTask(t) ? cx.banner(`It waits on ${openBlockers(t).map((x) => x.subject).join(', ')}: a task completes only after the tasks it depends on${t.isGroup ? ', and a group after its children' : ''}.`, { tone: 'warning' }) : null,
    cmd: { cli: `capxul org projects task get ${t.name}`, sdk: `client.org(orgId).projects.tasks.get("${t.name}")` },
    fde: `Task ${t.name}: ${t.subject} in ${projName(t.project)}, ${t.status}`,
    body: form,
  });
}
cx.route('task', (ctx) => {
  const t = cx.find(P.tasks, 'name', ctx.id);
  if (!t) return cx.page({ title: 'Not found', workspace: 'projects', body: cx.empty('No such task.', cx.btn('All tasks', { href: ['tasks'] })) });
  return taskPage(t);
}, { workspace: 'projects', title: 'Task' });

/* =====================================================================================================
   Timesheets: the list, a new one, logging time, the timer, submit and cancel, and billing into an invoice
   ===================================================================================================== */

if (!P.settings) P.settings = { allowUserOverlap: false, allowEmployeeOverlap: false, fetchTimesheets: false };
const tsProjects = (t) => uniq([t.project, ...tsLogs(t.name).map((l) => l.project)]);
const keeper = (ts) => () => (ts.employee === cx.meId() ? true : cx.wears('People') || cx.wears('Director') ? true : `Only ${cx.name(ts.employee)} keeps this timesheet, or whoever wears the People hat (${namesList(wearers('People'))}), or a Director.`);
const draftInvoicesOf = (tsName) => D.books.salesInvoices.filter((i) => i.docstatus === 0 && (i.timesheets || []).some((x) => x.timesheet === tsName));
const accountsEmail = (cust) => { const c = CUSTOMERS.get(cust); return c?.website ? `accounts@${c.website.replace(/^www\./, '')}` : 'accounts@customer'; };
const TS_TABS = [
  { label: 'All' },
  { label: 'Drafts', filter: (t) => t.status === 'Draft', status: 'draft' },
  { label: 'To bill', filter: (t) => t.status !== 'Draft' && t.status !== 'Cancelled' && tsInfo(t).unbilled.length > 0, status: 'submitted' },
  { label: 'Mine', filter: (t) => t.employee === cx.meId(), mine: true },
];
cx.route('timesheets', (ctx) => {
  const proj = ctx.id ? cx.find(P.projects, 'name', ctx.id) : null;
  return cx.page({
    title: 'Timesheets', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    sub: proj ? h('span', 'With time on ', projLink(proj.name, proj.projectName)) : null,
    actions: [cx.btn('Add timesheet', { kind: 'primary', icon: 'plus', needs: MEMBER, cmd: 'capxul org projects timesheet create --project <project>', onClick: () => newTimesheetModal({ project: proj?.name }) })],
    fde: 'The timesheets',
    body: cx.listView({
      key: 'pj-ts', rows: () => P.timesheets, id: (t) => t.name, initial: proj ? { filters: { project: proj.name } } : null,
      titleCol: { key: 'employeeName', label: 'Employee name', get: (t) => cx.name(t.employee), sub: (t) => (t.loggedBy && t.loggedBy !== t.employee ? `for ${cx.firstName(t.employee)}, by ${cx.name(t.loggedBy)}` : `${fmt.date(t.startDate)} to ${fmt.date(t.endDate)}`) },
      status: (t) => tsPill(tsInfo(t).status),
      columns: [{ key: 'startDate', label: 'Start date', type: 'date' }, { key: 'perBilled', label: '% amount billed', get: (t) => tsInfo(t).perBilled, render: (t) => `${tsInfo(t).perBilled}` , align: 'right' }, { key: 'hours', label: 'Total hours', get: (t) => tsInfo(t).hours, type: 'float', dp: 1 }, { key: 'projects', label: 'Project', get: (t) => tsProjects(t).join(', ') }, { key: 'billable', label: 'Billable amount', get: (t) => tsInfo(t).billableAmount, render: (t) => money(tsInfo(t).billableAmount, t.currency || 'GBP') }],
      filters: [{ key: 'name', label: 'ID' }, { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Partially Billed', 'Billed', 'Cancelled'], get: (t) => tsInfo(t).status }, { key: 'employee', label: 'Employee', type: 'person', options: () => uniq(P.timesheets.map((t) => t.employee)) }, { key: 'project', label: 'Project', type: 'select', options: () => P.projects.map((p) => [p.name, `${p.name} · ${p.projectName}`]), match: (t, v) => tsProjects(t).includes(v) }],
      tabs: TS_TABS,
      sort: { options: [{ key: 'startDate', label: 'Start date' }, { key: 'name', label: 'ID' }, { key: 'hours', label: 'Total hours', get: (t) => tsInfo(t).hours }], default: { key: 'name', dir: 'desc' } },
      groupBy: [{ key: 'employee', label: 'Employee', type: 'person' }, { key: 'status', label: 'Status', get: (t) => tsInfo(t).status }],
      href: (t) => ['timesheet', t.name],
      bulk: [{ label: 'Create invoice', icon: 'file', needs: 'Invoicing', cmd: 'capxul org projects timesheet bill <timesheet>… --to <mailbox>', onClick: (rows) => billModal(rows.map((r) => r.name)) }, { label: 'Submit', icon: 'check', needs: MEMBER, cmd: 'capxul org projects timesheet submit <timesheet>', onClick: async (rows) => { const ds = rows.filter((r) => r.status === 'Draft'); if (!ds.length) { cx.toast('None of those is a draft.', { tone: 'info' }); return; } let n = 0; for (const t of ds) { if (keeper(t)() === true && tsLogs(t.name).length) { t.status = 'Submitted'; t.submittedAt = NOW(); n++; } } cx.toast(`${fmt.plural(n, 'timesheet')} submitted${n < ds.length ? `; ${ds.length - n} not yours to submit or empty` : ''}`, { tone: n ? 'success' : 'warning', cmd: ds.slice(0, 3).map((t) => `capxul org projects timesheet submit ${t.name}`)[0] }); cx.refresh(); } }],
      cmd: (st) => { const f = st.filters; const tab = TS_TABS[st.tab]; const status = f.status ? lc(f.status) : tab?.status; const who = f.employee || (tab?.mine ? cx.meId() : null); const parts = [who ? `--for ${emailOf(who)}` : null, f.project ? `--project ${f.project}` : null, status ? `--status ${status}` : null].filter(Boolean); return { cli: `capxul org projects timesheet list${parts.length ? ' ' + parts.join(' ') : ''}`, sdk: `client.org(orgId).projects.timesheets.list(${parts.length ? `{ ${[who ? `for: "${emailOf(who)}"` : null, f.project ? `project: "${f.project}"` : null, status ? `status: "${status}"` : null].filter(Boolean).join(', ')} }` : ''})` }; },
      noun: 'timesheet', empty: 'No timesheets match.',
    }),
  });
}, { workspace: 'projects', title: 'Timesheets' });

function newTimesheetModal(pre = {}) {
  const meEmp = cx.me()?.kind === 'employee';
  const canOthers = cx.wears('People') || cx.wears('Director');
  const m = { employee: meEmp ? cx.meId() : D.people.find((p) => p.status === 'Active')?.id, project: pre.project || '', note: '' };
  const opts = canOthers ? D.people.filter((p) => p.status === 'Active').map((p) => [p.id, `${p.name}${cx.hasSeat(p.id) ? '' : ' (no seat)'}`]) : [[cx.meId(), cx.name(cx.meId())]];
  formModal({ title: 'New timesheet', model: m, needs: MEMBER, submit: 'Create', who: canOthers ? 'the worker for their own time; People or a Director for anyone' : 'the worker, for their own time',
    intro: canOthers ? 'You may keep a timesheet for anyone, including people with no seat.' : 'You keep your own time. Someone who wears People keeps time for others.',
    fields: [{ label: 'Employee', key: 'employee', type: 'select', options: opts }, { label: 'Project', key: 'project', type: 'select', options: [['', '—'], ...openProjects().map((p) => [p.name, `${p.name} · ${p.projectName}`])] }, { label: 'Note', key: 'note', type: 'textarea', wide: true }],
    cmd: (x) => `capxul org projects timesheet create${x.employee !== cx.meId() ? ` --for ${emailOf(x.employee)} --employee ${cx.person(x.employee)?.employee}` : ''}${x.project ? ' --project ' + x.project : ''}${x.note ? ' --note ' + q(x.note) : ''}`,
    check: (x) => (x.employee !== cx.meId() && !canOthers ? 'Only People or a Director keep time for someone else.' : null),
    onSubmit: (x, close, cmd) => {
      const name = nextName(`TS-${TODAY.slice(0, 4)}-`, P.timesheets.map((t) => t.name));
      const p = PROJ.get(x.project);
      const ts = { employee: x.employee, startDate: TODAY, currency: p?.currency || 'GBP', name, endDate: TODAY, project: x.project || null, customer: p?.customer || null, department: cx.person(x.employee)?.department, loggedBy: cx.meId(), status: 'Draft', submittedAt: null, totalHours: 0, totalBillableHours: 0, totalBillableAmount: 0, totalCostingAmount: 0, totalBilledHours: 0, totalBilledAmount: 0, perBilled: 0, salesInvoices: [], logCount: 0, note: x.note || null, createdAt: NOW(), presetTask: pre.task || null };
      P.timesheets.push(ts); TSM.set(name, ts);
      close(); cx.toast(`Created ${name} for ${cx.name(x.employee)}`, { tone: 'success', cmd }); cx.go('timesheet', name);
    } });
}
/** The rates a new log takes: this project's last rate for the activity, else the activity type's defaults. */
function ratesFor(employee, activity, project) {
  const at = P.activityTypes.find((a) => a.name === activity) || { costing: 0, billing: 0 };
  const prevBill = [...LOGS].reverse().find((l) => l.project === project && l.activity === activity && l.billable && l.billingRate);
  const prevCost = [...LOGS].reverse().find((l) => TSM.get(l.timesheet)?.employee === employee && l.activity === activity && l.costingRate);
  return { billing: prevBill?.billingRate ?? at.billing, costing: prevCost?.costingRate ?? at.costing };
}
const disabledType = (name) => !!P.activityTypes.find((a) => a.name === name)?.disabled;
function addLogModal(ts, pre = {}) {
  const proj = pre.project || ts.project || tsProjects(ts)[0] || 'PROJ-0011';
  const lastEnd = (() => { const today = tsLogs(ts.name).filter((l) => l.date === TODAY); if (!today.length) return `${TODAY}T09:00`; const e = today.reduce((m, l) => (toTime(l) > m ? toTime(l) : m), ''); return e.slice(0, 16); })();
  const m = { activity: pre.activity || 'Engineering', start: pre.start || lastEnd, hours: pre.hours ?? 1, project: proj, task: pre.task || ts.presetTask || '', billable: PROJ.get(proj)?.billing === 'tm' ? 1 : 0, note: pre.note || '', completed: 0 };
  const startIn = h('input.finput', { type: 'datetime-local', value: m.start, oninput: (e) => { m.start = e.target.value; md.redraw?.(); } });
  const calc = h('div.muted', { style: 'font-size:13px' });
  const drawCalc = () => { const r = ratesFor(ts.employee, m.activity, m.project); cx.fill(calc, `Billing rate ${money(m.billable ? r.billing : 0, ts.currency || 'GBP')} · billing amount `, h('b', money(m.billable ? r.billing * (+m.hours || 0) : 0, ts.currency || 'GBP')), ` · costing rate ${money(r.costing, 'GBP')} · costing amount ${money(r.costing * (+m.hours || 0), 'GBP')}`); };
  const taskOpts = (p) => [['', '—'], ...tasksOf(p).filter((t) => !t.isGroup && isOpenTask(t)).map((t) => [t.name, t.subject])];
  const md = formModal({ title: `Add time to ${ts.name}`, model: m, needs: keeper(ts), submit: 'Add', who: `${cx.name(ts.employee)}, or People or a Director`,
    fields: [
      { label: 'Activity type', key: 'activity', type: 'select', options: P.activityTypes.filter((a) => !a.disabled).map((a) => a.name), onChange: drawCalc },
      { label: 'From time', node: startIn }, { label: 'Hrs', key: 'hours', type: 'float', onChange: drawCalc },
      { label: 'Project', key: 'project', type: 'select', options: openProjects().map((p) => [p.name, `${p.name} · ${p.projectName}`]), onChange: drawCalc },
      { label: 'Task', key: 'task', type: 'select', options: taskOpts(proj), help: 'Tasks of the project chosen when the dialog opened' },
      { label: 'Is billable', key: 'billable', type: 'check', checkLabel: 'Bill this time to the customer', onChange: drawCalc },
      { label: 'Completed', key: 'completed', type: 'check', checkLabel: 'This finishes the task' },
      { label: 'Description', key: 'note', type: 'textarea', wide: true },
    ],
    extra: calc,
    cmd: (x) => `capxul org projects timesheet log ${ts.name} --activity ${q(x.activity)} --start ${x.start} --hours ${x.hours || 0}${x.task ? ' --task ' + x.task : ''}${x.project ? ' --project ' + x.project : ''}${x.billable ? ' --billable' : ''}${x.completed ? ' --completed' : ''}${x.note ? ' --note ' + q(x.note) : ''}`,
    check: (x) => {
      if (!(+x.hours > 0)) return 'Hours must be more than zero.';
      if (disabledType(x.activity)) return `${x.activity} is disabled: it takes no new logs.`;
      const s0 = Date.parse(x.start + ':00Z'), e0 = s0 + (+x.hours) * 3600000;
      const mine = LOGS.filter((l) => TSM.get(l.timesheet)?.employee === ts.employee && liveTs(l.timesheet) && l.date === x.start.slice(0, 10));
      logIndex();
      const clash = mine.find((l) => { const a = Date.parse(l.fromTime), b = a + l.hours * 3600000; return s0 < b && e0 > a; });
      if (clash && !P.settings.allowEmployeeOverlap) return `It overlaps ${clash.timesheet}'s ${clash.activity} from ${fmt.time(clash.fromTime)}. Projects options can allow overlaps.`;
      return null;
    },
    onSubmit: (x, close, cmd) => {
      const r = ratesFor(ts.employee, x.activity, x.project);
      const idx = (tsLogs(ts.name).reduce((mx, l) => Math.max(mx, l.idx), 0) || 0) + 1;
      const log = { timesheet: ts.name, idx, date: x.start.slice(0, 10), hours: +x.hours, activity: x.activity, project: x.project || null, task: x.task || null, billable: x.billable ? 1 : 0, billingRate: x.billable ? r.billing : 0, billingAmount: x.billable ? r2(r.billing * +x.hours) : 0, costingRate: r.costing, invoice: null, completed: x.completed ? 1 : 0, fromTime: x.start + ':00Z', note: x.note || null };
      LOGS.push(log); reindex();
      if (log.date < ts.startDate) ts.startDate = log.date; if (log.date > ts.endDate) ts.endDate = log.date;
      ts.logCount = (ts.logCount || 0) + 1;
      if (!ts.project && tsProjects(ts).length === 1) ts.project = tsProjects(ts)[0];
      const t = TASK.get(x.task); if (t && !t.actualStart) t.actualStart = log.date;
      if (pre.timer) TIMERS.delete(ts.name);
      close(); cx.toast(`Logged ${fmt.hours(+x.hours)} of ${x.activity} on ${ts.name}`, { tone: 'success', cmd }); cx.refresh();
    } });
  drawCalc();
}
const TIMERS = new Map();
function startTimerModal(ts) {
  const proj = ts.project || tsProjects(ts)[0] || 'PROJ-0011';
  const m = { activity: 'Engineering', project: proj, task: ts.presetTask || '', expected: 1 };
  formModal({ title: 'Start timer', model: m, needs: keeper(ts), submit: 'Start', who: `${cx.name(ts.employee)}, or People or a Director`,
    intro: 'The timer runs on this page. Complete writes the time log with its start and its hours.',
    fields: [{ label: 'Activity type', key: 'activity', type: 'select', options: P.activityTypes.filter((a) => !a.disabled).map((a) => a.name) }, { label: 'Project', key: 'project', type: 'select', options: openProjects().map((p) => [p.name, `${p.name} · ${p.projectName}`]) }, { label: 'Task', key: 'task', type: 'select', options: [['', '—'], ...tasksOf(proj).filter((t) => !t.isGroup && isOpenTask(t)).map((t) => [t.name, t.subject])] }, { label: 'Expected hrs', key: 'expected', type: 'float' }],
    cmd: (x) => `capxul org projects timesheet log ${ts.name} --activity ${q(x.activity)} --start ${TODAY}T${fmt.time(NOW())} …`,
    onSubmit: (x, close) => { TIMERS.set(ts.name, { ...x, t0: performance.now(), at: NOW() }); close(); cx.toast('Timer started', { tone: 'info' }); cx.refresh(); } });
}
function timerBar(ts) {
  const tm = TIMERS.get(ts.name);
  if (!tm) return null;
  const clock = h('span.clock', '00:00:00');
  const tick = () => { const s0 = Math.floor((performance.now() - tm.t0) / 1000); clock.textContent = [Math.floor(s0 / 3600), Math.floor((s0 % 3600) / 60), s0 % 60].map((v) => String(v).padStart(2, '0')).join(':'); };
  tick();
  const iv = setInterval(() => { if (!clock.isConnected) { clearInterval(iv); return; } tick(); }, 1000);
  return h('div.pj-timer', cx.icon('clock'), clock, h('div', h('b', tm.activity), h('div.muted', { style: 'font-size:12.5px' }, `${projName(tm.project)}${tm.task ? ' · ' + (TASK.get(tm.task)?.subject || tm.task) : ''} · started ${fmt.time(tm.at)} · ${fmt.hours(+tm.expected || 0)} expected`)), h('span.grow'),
    cx.btn('Complete', { kind: 'primary', icon: 'check', onClick: () => { const hrs = Math.max(0.25, Math.round(((performance.now() - tm.t0) / 3600000) * 4) / 4); addLogModal(ts, { activity: tm.activity, project: tm.project, task: tm.task, hours: hrs, start: tm.at.slice(0, 16), timer: true }); } }),
    cx.btn('Discard', { kind: 'ghost', onClick: () => { TIMERS.delete(ts.name); cx.refresh(); } }));
}
async function submitTimesheet(ts) {
  const ok = keeper(ts)(); if (ok !== true) { cx.toast(ok, { tone: 'warning' }); return; }
  const info = tsInfo(ts);
  if (!info.logs.length) { cx.toast('Add at least one time log before submitting.', { tone: 'warning' }); return; }
  const cmd = `capxul org projects timesheet submit ${ts.name}`;
  if (!(await cx.confirm({ title: `Submit ${ts.name}?`, body: `${fmt.hours(info.hours)} for ${cx.name(ts.employee)}. Its rates lock, and its hours roll into its tasks and projects.`, cmd, who: `${cx.name(ts.employee)}, or People or a Director`, confirmLabel: 'Submit' }))) return;
  ts.status = 'Submitted'; ts.submittedAt = NOW(); ts.submittedBy = cx.meId();
  if (info.logs.some((l) => l.fromCalendar && !l.confirmed)) { for (const l of info.logs) if (l.fromCalendar) l.confirmed = 1; settle(`pj-cal-${ts.name}`, `${cx.name(ts.employee)} confirmed the calendar rows on ${ts.name}`); }
  for (const l of info.logs) { const t = TASK.get(l.task); if (t && !t.actualStart) t.actualStart = l.date; if (t && l.completed && isOpenTask(t)) await taskMove(t, 'Completed', { confirmed: true }); }
  cx.toast(`Submitted ${ts.name}`, { tone: 'success', cmd }); cx.refresh();
}
async function cancelTimesheet(ts) {
  const info = tsInfo(ts);
  const cmd = `capxul org projects timesheet cancel ${ts.name}`;
  if (info.billedAmount > 0) { cx.toast(`${ts.name} is billed on ${info.invoices.join(', ')}: a billed timesheet is not cancelled.`, { tone: 'warning', cmd }); return; }
  const ok = keeper(ts)(); if (ok !== true) { cx.toast(ok, { tone: 'warning' }); return; }
  if (!(await cx.confirm({ title: `Cancel ${ts.name}?`, body: `Its ${fmt.hours(info.hours)} leave their tasks and projects. It is kept, as Cancelled; a new timesheet takes its place.`, cmd, who: `${cx.name(ts.employee)}, or People or a Director`, confirmLabel: 'Cancel the timesheet', cancelLabel: 'Back', danger: true }))) return;
  ts.status = 'Cancelled'; ts.cancelledAt = NOW();
  cx.toast(`Cancelled ${ts.name}`, { tone: 'success', cmd }); cx.refresh();
}

/* ---------- billing hours into an invoice ---------- */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
  if (n < 1e6) return words(n / 1000) + ' Thousand' + (n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + words(n % 1000) : '');
  return words(n / 1e6) + ' Million' + (n % 1e6 ? ' ' + words(n % 1e6) : '');
}
const inWords = (amt, cur) => { const whole = Math.floor(amt), minor = Math.round((amt - whole) * 100); return `${cur} ${words(whole) || 'Zero'}${minor ? ` and ${minor}/100` : ''} only.`; };
const activityItem = (act, cc) => (act === 'Design' || act === 'Research' ? 'Design services' : act === 'Engineering' || act === 'Execution' ? 'Engineering services' : cc === 'Design' ? 'Design services' : 'Engineering services');
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Bill the unbilled, billable hours of these timesheets: one invoice, one line per activity and rate. */
function billModal(tsNames, onlyProject) {
  const inDraft = new Set(D.books.salesInvoices.filter((i) => i.docstatus === 0).flatMap((i) => (i.timesheets || []).map((x) => x.timesheet)));
  const logs = tsNames.map((n) => TSM.get(n)).filter((t) => t && t.status !== 'Draft' && t.status !== 'Cancelled').flatMap((t) => tsInfo(t).unbilled).filter((l) => (!onlyProject || l.project === onlyProject) && !inDraft.has(l.timesheet));
  if (!logs.length) { cx.toast(inDraft.size && tsNames.some((n) => inDraft.has(n)) ? 'That time is on a draft invoice already. Post it in Books.' : 'Nothing to bill: no submitted, billable time without an invoice.', { tone: 'info' }); return; }
  const projs = uniq(logs.map((l) => l.project));
  if (projs.length > 1) { cx.toast(`That time spans ${fmt.plural(projs.length, 'project')} (${projs.join(', ')}). One invoice bills one project: choose its timesheets, or bill from the project.`, { tone: 'warning' }); return; }
  const p = PROJ.get(projs[0]);
  if (!p?.customer) { cx.toast(`${projName(projs[0])} has no customer to bill.`, { tone: 'warning' }); return; }
  const cur = projCurrency(p);
  const cust = CUSTOMERS.get(p.customer);
  const groups = new Map();
  for (const l of logs) { const k = `${l.activity}|${l.billingRate}`; const g = groups.get(k) || { activity: l.activity, rate: l.billingRate, hours: 0, amount: 0 }; g.hours = r2(g.hours + l.hours); g.amount = r2(g.amount + l.billingAmount); groups.set(k, g); }
  const lines = [...groups.values()].sort((a, b) => b.amount - a.amount);
  const from = logs.reduce((m, l) => (l.date < m ? l.date : m), logs[0].date), to = logs.reduce((m, l) => (l.date > m ? l.date : m), logs[0].date);
  const net = r2(sum(lines, (g) => g.amount)), vat = cur === 'GBP' ? r2(net * 0.2) : 0, total = r2(net + vat);
  const tsList = uniq(logs.map((l) => l.timesheet));
  const m = { to: accountsEmail(p.customer) };
  const onChain = D.crm?.companies?.find((c) => c.id === p.customer)?.onCapxul;
  formModal({ title: `Create invoice: ${custName(p.customer)}`, model: m, cols: 1, needs: 'Invoicing', submit: 'Create invoice', wide: true,
    intro: h('div', { style: 'display:grid;gap:10px' },
      cx.kv([['Project', projLink(p.name, `${p.name} · ${p.projectName}`)], ['Time', `${fmt.date(from)} to ${fmt.date(to)} · ${fmt.plural(tsList.length, 'timesheet')} · ${fmt.hours(r2(sum(logs, (l) => l.hours)))} billable`], ['Currency', cur]]),
      cx.grid({ numbered: true, rows: lines, totals: ['hours', 'amount'], columns: [{ key: 'activity', label: 'Activity' }, { key: 'hours', label: 'Hours', type: 'float', dp: 1 }, { key: 'rate', label: 'Rate', type: 'currency', currency: cur }, { key: 'amount', label: 'Amount', type: 'currency', currency: cur }] }),
      h('div', { style: 'display:grid;gap:2px;justify-items:end;font-size:13.5px' }, h('span', `Net ${money(net, cur)}`), cur === 'GBP' ? h('span', `VAT 20% ${money(vat, cur)}`) : h('span.muted', 'No VAT: a business outside the UK'), h('b', { style: 'font-size:15px' }, `Total ${money(total, cur)}`)),
      cx.banner(onChain ? `${custName(p.customer)} is on Capxul: it pays from its own Safe in USDC, and the payment carries a document hash committing to these lines.` : `${custName(p.customer)} pays by bank transfer into Harbourline's Bridge account; it lands as USDC in the Treasury, and the payment carries a document hash committing to these lines and the VAT.`, { tone: 'info', icon: 'shield' })),
    fields: [{ label: 'Who pays (the invoice goes to)', key: 'to', reqd: true }],
    cmd: (x) => `capxul org projects timesheet bill ${tsList.slice(0, 6).join(' ')}${tsList.length > 6 ? ` … (${tsList.length} timesheets)` : ''} --to ${x.to}`,
    onSubmit: (x, close, cmd) => {
      let max = 0; for (const i of D.books.salesInvoices) { const mm = /^ACC-SINV-(\d{4})-(\d+)$/.exec(i.name); if (mm && mm[1] === TODAY.slice(0, 4)) max = Math.max(max, +mm[2]); }
      const name = `ACC-SINV-${TODAY.slice(0, 4)}-${String(max + 1).padStart(5, '0')}`;
      const cc = p.costCenter || cx.deptName(p.department);
      const period = from.slice(0, 7) === to.slice(0, 7) ? `${MONTHS_LONG[+to.slice(5, 7) - 1]} ${to.slice(0, 4)}${to < monthEnd(to.slice(0, 7)) ? ` to ${fmt.day(to)}` : ''}` : `${fmt.date(from)} to ${fmt.date(to)}`;
      const ITEM_ACC = { 'Engineering services': '4000', 'Design services': '4100' };
      const items = lines.map((g, i) => { const item = activityItem(g.activity, cc); return { idx: i + 1, uom: 'Hour', item, description: `${g.activity}: ${p.projectName}, ${period}`, qty: g.hours, rate: g.rate, incomeAccount: ITEM_ACC[item], costCenter: cc, project: p.name, amount: g.amount }; });
      const byTsAct = new Map(); for (const l of logs) { const k = l.timesheet + '|' + l.activity; const o = byTsAct.get(k) || { timesheet: l.timesheet, activity: l.activity, billingHours: 0, billingAmount: 0 }; o.billingHours = r2(o.billingHours + l.hours); o.billingAmount = r2(o.billingAmount + l.billingAmount); byTsAct.set(k, o); }
      const rate = cur === 'GBP' ? 1 : Math.round(cx.rate(TODAY) * 1e6) / 1e6;
      const inv = { customer: p.customer, customerName: cust?.name || custName(p.customer), postingDate: TODAY, dueDate: addDays(TODAY, cust?.terms || 30), currency: cur, conversionRate: rate, isOpening: false, originalDate: null, project: p.name, costCenter: cc, items, timesheets: [...byTsAct.values()], payments: [],
        taxes: cur === 'GBP' ? [{ type: 'On Net Total', account: '2101', rate: 20, taxAmount: vat, total, description: 'VAT 20%' }] : [], taxNote: cur === 'GBP' ? null : 'Outside the scope of UK VAT (services to a business outside the UK)',
        totalQty: r2(sum(items, (i) => i.qty)), netTotal: net, totalTaxes: vat, grandTotal: total, baseNetTotal: r2(net * rate), baseTotalTaxes: r2(vat * rate), baseGrandTotal: r2(total * rate), inWords: inWords(total, cur), outstanding: total,
        docstatus: 0, name, createdBy: cx.meId(), createdAt: NOW(), kind: 'timesheets', remarks: `Billed from ${fmt.plural(tsList.length, 'timesheet')} of ${p.projectName}`, requestSent: null, paymentTerms: `Net ${cust?.terms || 30}`, billTo: x.to };
      D.books.salesInvoices.push(inv);
      (p.salesInvoices ||= []).push(name);
      (p.history ||= []).push({ at: NOW(), who: cx.meId(), kind: 'change', text: `billed ${fmt.hours(r2(sum(logs, (l) => l.hours)))} into ${name}` });
      close();
      settle(`pj-bill-${p.name}`, `Sent ${name} to ${custName(p.customer)}: ${money(total, cur)}`);
      // Creating the invoice posts it in one write, through the Books hook; without it the invoice stays a draft.
      const post = cx.native?.postSalesInvoice;
      if (post) {
        Promise.resolve(post(inv)).then(() => {
          cx.toast(`Posted ${name} from ${fmt.plural(tsList.length, 'timesheet')}: ${money(total, cur)}, reference ${inv.rfReference}. The hours read Billed.`, { tone: 'success', cmd, ms: 9000 });
          cx.go('sales-invoice', name);
        }, (e) => { console.error(e); cx.toast(`${name} was made but not posted.`, { tone: 'warning' }); cx.go('sales-invoice', name); });
      } else {
        cx.toast(`${name} made from ${fmt.plural(tsList.length, 'timesheet')}: ${money(total, cur)}. Post it to send it; posting marks the hours billed.`, { tone: 'success', cmd, ms: 9000 });
        cx.go('sales-invoice', name);
      }
    } });
}

/* ---------- the timesheet form ---------- */

function timesheetPage(ts) {
  const info = tsInfo(ts);
  const draft = ts.status === 'Draft';
  const mayKeep = keeper(ts)() === true;
  const cur = ts.currency || 'GBP';
  const emp = cx.person(ts.employee);
  const drafts = draftInvoicesOf(ts.name);
  const logCols = [
    { key: 'activity', label: 'Activity type' }, { key: 'fromTime', label: 'From time', type: 'datetime', render: (l) => fmt.datetime(l.fromTime) },
    { key: 'hours', label: 'Hrs', type: 'float', dp: 2 }, { key: 'project', label: 'Project', opt: true, render: (l) => (l.project ? cx.link(l.project, 'project', l.project) : '—') },
    { key: 'billable', label: 'Is billable', render: (l) => (l.billable ? cx.icon('check') : '') }, { key: 'task', label: 'Task', opt: true, render: (l) => (l.task ? h('span', taskLink(l.task), l.completed ? h('span.muted', ' · completed') : null) : '—') },
    { key: 'billingRate', label: 'Billing rate', type: 'currency', currency: cur, opt: true }, { key: 'billingAmount', label: 'Billing amount', type: 'currency', currency: cur },
    { key: 'costingRate', label: 'Costing rate', type: 'currency', currency: 'GBP', opt: true }, { key: 'costing', label: 'Costing amount', type: 'currency', currency: 'GBP', get: (l) => r2(l.hours * l.costingRate), opt: true },
    { key: 'invoice', label: 'Invoice', opt: true, render: (l) => (l.invoice ? cx.link(l.invoice, 'sales-invoice', l.invoice) : '') },
  ];
  if (info.logs.some((l) => l.fromCalendar)) logCols.splice(2, 0, { key: 'event', label: 'From the calendar', render: (l) => (l.fromCalendar ? h('span.pj-src', { title: l.confirmed ? 'Confirmed' : 'Suggested from the calendar, waiting to be confirmed' }, cx.icon('calendar'), l.event, l.confirmed ? null : h('span', { style: 'color:var(--t-orange);font-weight:600' }, ' · to confirm')) : '') });
  const toConfirm = info.logs.filter((l) => l.fromCalendar && !l.confirmed);
  const rowForm = [{ label: 'Activity type', key: 'activity' }, { label: 'From time', key: 'fromTime', type: 'datetime' }, { label: 'To time', key: 'to', render: (l) => fmt.datetime(toTime(l)) }, { label: 'Hrs', key: 'hours', type: 'float' }, { label: 'Project', key: 'project' }, { label: 'Task', key: 'task', render: (l) => taskLink(l.task) }, { label: 'Is billable', key: 'billable', type: 'check' }, { label: 'Completed', key: 'completed', type: 'check' }, { label: 'Billing hours', key: 'bh', render: (l) => fmt.num(l.billable ? l.hours : 0, 2) }, { label: 'Billing rate', key: 'billingRate', type: 'currency', currency: cur }, { label: 'Billing amount', key: 'billingAmount', type: 'currency', currency: cur }, { label: 'Costing rate', key: 'costingRate', type: 'currency', currency: 'GBP' }, { label: 'Invoice', key: 'invoice' }, { label: 'Description', key: 'note', type: 'textarea' }];
  const grid = cx.grid({ numbered: true, rows: info.logs, rowForm, title: 'Time log', totals: ['hours', 'billingAmount', 'costing'], empty: draft ? 'No time yet. Add a row, or start the timer.' : 'No time logs', columns: logCols });
  const removable = draft && mayKeep ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, cx.btn('Add a row', { sm: true, icon: 'plus', needs: keeper(ts), cmd: `capxul org projects timesheet log ${ts.name} --activity … --start … --hours …`, onClick: () => addLogModal(ts) }), info.logs.length ? cx.menu('Remove a row', info.logs.map((l, i) => ({ label: `${i + 1} · ${l.activity} · ${fmt.date(l.date)} · ${fmt.hours(l.hours)}`, onClick: () => { const k = LOGS.indexOf(l); if (k >= 0) LOGS.splice(k, 1); reindex(); cx.toast('Row removed from the draft', { tone: 'info' }); cx.refresh(); } })), { sm: true, kind: 'ghost' }) : null) : null;
  const form = cx.formView({
    doc: ts, editable: false, tabKey: 'pj-ts',
    tabs: [
      { label: 'Timesheet', sections: [
        { columns: [
          [{ label: 'Series', value: ts.name, readOnly: true, type: 'mono' }, { label: 'Customer', value: ts.customer, readOnly: true, render: () => custLink(ts.customer) }, cur !== 'GBP' ? { label: 'Currency', value: cur, readOnly: true } : null, cur !== 'GBP' ? { label: 'Exchange rate', value: `1 ${cur} = £${cx.rate(ts.startDate)}`, readOnly: true } : null, { label: 'Invoice', value: info.invoices.join(', '), readOnly: true, render: () => (info.invoices.length ? h('span', info.invoices.map((n, i) => [i ? ', ' : '', cx.link(n, 'sales-invoice', n)])) : h('span.faint', '—')) }].filter(Boolean),
          [{ label: 'Status', value: info.status, readOnly: true, render: () => tsPill(info.status) }, { label: 'Project', value: ts.project, readOnly: true, render: () => (ts.project ? projLink(ts.project, `${ts.project} · ${projName(ts.project)}`) : h('span.faint', 'Several')) }, { label: 'User', value: emailOf(ts.employee), readOnly: true }, { label: 'Start date', value: ts.startDate, readOnly: true, type: 'date' }, { label: 'End date', value: ts.endDate, readOnly: true, type: 'date' }]] },
        { label: 'Employee detail', columns: [[{ label: 'Employee', value: emp?.employee, readOnly: true, render: () => (cx.hasRoute('employee') ? cx.link(emp?.employee || ts.employee, 'employee', emp?.employee) : h('span', emp?.employee || '')) }, { label: 'Department', value: cx.deptName(ts.department || emp?.department), readOnly: true }], [{ label: 'Employee name', value: cx.name(ts.employee), readOnly: true }, ts.loggedBy && ts.loggedBy !== ts.employee ? { label: 'Logged by', value: ts.loggedBy, readOnly: true, type: 'person', help: cx.hasSeat(ts.employee) ? null : `${cx.firstName(ts.employee)} has no seat, so whoever wears People keeps their time.` } : null].filter(Boolean)] },
        { label: 'Time sheets', node: h('div', { style: 'min-width:0;display:grid' }, grid, removable) },
        { cols: 2, fields: [{ label: 'Total working hours', value: info.hours, readOnly: true, type: 'float', dp: 2 }] },
      ] },
      { label: 'Billing', sections: [
        { label: 'Billing details', columns: [[{ label: 'Total billable hours', value: info.billableHours, readOnly: true, type: 'float', dp: 2 }, { label: 'Total billable amount', value: info.billableAmount, readOnly: true, type: 'currency', currency: cur }, { label: 'Total costing amount', value: info.costingAmount, readOnly: true, type: 'currency', currency: 'GBP' }], [{ label: 'Total billed hours', value: info.billedHours, readOnly: true, type: 'float', dp: 2 }, { label: 'Total billed amount', value: info.billedAmount, readOnly: true, type: 'currency', currency: cur }, { label: '% amount billed', value: info.perBilled, readOnly: true, type: 'percent' }]] },
        { label: 'Note', cols: 1, fields: [{ label: 'Note', value: ts.note || '', readOnly: true, type: 'textarea' }] },
      ] },
    ],
    connections: [{ group: 'References', items: [{ label: 'Invoice', count: info.invoices.length + drafts.length, route: info.invoices[0] || drafts[0] ? 'sales-invoice' : 'sales-invoices', id: info.invoices[0] || drafts[0]?.name }] }, { group: 'Projects', items: tsProjects(ts).map((pn) => ({ label: projName(pn), count: info.logs.filter((l) => l.project === pn).length, route: 'project', id: pn })) }],
    side: { id: ts.name, title: cx.name(ts.employee), cmd: `capxul org projects timesheet get ${ts.name}`,
      extra: h('div', { style: 'display:grid;gap:10px' }, h('div.side-sec', h('h4', 'Hours'), h('div', h('b', fmt.hours(info.hours)), h('span.muted', ` · ${fmt.hours(info.billableHours)} billable`))), info.billableAmount ? h('div.side-sec', h('h4', 'Billable'), h('div', h('b', money(info.billableAmount, cur)), h('span.muted', ` · ${info.perBilled}% billed`))) : null),
      created: { by: ts.loggedBy || ts.employee, at: ts.createdAt || ts.startDate + 'T09:00:00Z' }, modified: ts.submittedAt ? { by: ts.submittedBy || ts.loggedBy || ts.employee, at: ts.submittedAt } : null },
    timeline: { items: [
      { at: ts.createdAt || ts.startDate + 'T09:00:00Z', who: ts.loggedBy || ts.employee, kind: 'created', text: ts.loggedBy && ts.loggedBy !== ts.employee ? `created this timesheet for ${cx.name(ts.employee)}` : 'created this timesheet' },
      ts.submittedAt ? { at: ts.submittedAt, who: ts.submittedBy || ts.loggedBy || ts.employee, kind: 'submitted', text: 'submitted this timesheet' } : null,
      ...info.invoices.map((n) => { const i = D.books.salesInvoices.find((x) => x.name === n); return { at: i?.submittedAt || (i?.postingDate || ts.endDate) + 'T17:00:00Z', who: i?.submittedBy || i?.createdBy || null, kind: 'link', text: `billed on ${n}`, href: ['sales-invoice', n] }; }),
      ...drafts.map((i) => ({ at: i.createdAt, who: i.createdBy, kind: 'link', text: `put on draft invoice ${i.name}`, href: ['sales-invoice', i.name] })),
      ts.cancelledAt ? { at: ts.cancelledAt, who: cx.meId(), kind: 'cancelled', text: 'cancelled this timesheet' } : null,
      ...calendarTimeline(ts, info),
    ].filter(Boolean), comment: false },
  });
  const actions = [];
  if (draft) {
    if (toConfirm.length) actions.push(cx.btn(`Confirm ${fmt.plural(toConfirm.length, 'calendar row')}`, { icon: 'calendar', needs: keeper(ts), onClick: () => confirmCalendar(ts) }));
    actions.push(TIMERS.has(ts.name) ? null : cx.btn(info.logs.length ? 'Resume timer' : 'Start timer', { icon: 'clock', needs: keeper(ts), onClick: () => startTimerModal(ts) }));
    actions.push(cx.btn('Add a row', { icon: 'plus', needs: keeper(ts), onClick: () => addLogModal(ts) }));
    actions.push(cx.btn('Submit', { kind: 'primary', icon: 'check', needs: keeper(ts), cmd: `capxul org projects timesheet submit ${ts.name}`, onClick: () => submitTimesheet(ts) }));
  } else if (ts.status !== 'Cancelled') {
    if (info.unbilled.length && ts.customer !== null) actions.push(cx.btn('Create invoice', { kind: 'primary', icon: 'file', needs: 'Invoicing', cmd: `capxul org projects timesheet bill ${ts.name} --to ${accountsEmail(PROJ.get(info.unbilled[0].project)?.customer)}`, onClick: () => billModal([ts.name], info.unbilled[0].project) }));
  }
  if (ts.status !== 'Cancelled') actions.push(cx.menu(null, [{ label: 'Cancel the timesheet', icon: 'x', danger: true, needs: keeper(ts), disabled: info.billedAmount > 0, reason: 'Billed time is not cancelled.', cmd: `capxul org projects timesheet cancel ${ts.name}`, onClick: () => cancelTimesheet(ts) }, { label: 'Daily timesheet summary', icon: 'report', onClick: () => cx.go('daily-timesheets', null, { report: { from: ts.startDate, to: ts.endDate } }) }]));
  const noSeat = !cx.hasSeat(ts.employee);
  return cx.page({
    title: cx.name(ts.employee), workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Timesheets', route: 'timesheets' }],
    status: tsPill(info.status, { lg: true }),
    sub: `${ts.name} · ${fmt.date(ts.startDate)} to ${fmt.date(ts.endDate)} · ${fmt.hours(info.hours)}${ts.loggedBy && ts.loggedBy !== ts.employee ? ` · for ${cx.firstName(ts.employee)}, by ${cx.name(ts.loggedBy)}` : ''}`,
    actions: actions.filter(Boolean),
    banner: timerBar(ts) || (drafts.length ? cx.banner(h('span', 'On draft invoice ', cx.link(drafts[0].name, 'sales-invoice', drafts[0].name), '. Posting it marks these hours billed.'), { tone: 'info' }) : null) || (draft && !mayKeep ? cx.banner(keeper(ts)(), { tone: 'info', icon: 'lock' }) : null) || (noSeat && ts.loggedBy ? cx.banner(`${cx.name(ts.employee)} has no seat. ${cx.name(ts.loggedBy)} keeps this time for them.`, { tone: 'info' }) : null),
    cmd: { cli: `capxul org projects timesheet get ${ts.name}`, sdk: `client.org(orgId).projects.timesheets.get("${ts.name}")` },
    fde: `Timesheet ${ts.name} of ${cx.name(ts.employee)}, ${info.status}, ${fmt.hours(info.hours)}`,
    body: form,
  });
}
cx.route('timesheet', (ctx) => {
  const ts = cx.find(P.timesheets, 'name', ctx.id);
  if (!ts) return cx.page({ title: 'Not found', workspace: 'projects', body: cx.empty('No such timesheet.', cx.btn('All timesheets', { href: ['timesheets'] })) });
  return timesheetPage(ts);
}, { workspace: 'projects', title: 'Timesheet' });

/* =====================================================================================================
   Setup: activity types, project types, the projects options
   ===================================================================================================== */

for (const a of P.activityTypes) if (a.disabled == null) a.disabled = a.name === 'Execution' ? 1 : 0;
const lastUsed = (name) => LOGS.reduce((m, l) => (l.activity === name && l.date > m ? l.date : m), '');
const usedCount = (name) => LOGS.filter((l) => l.activity === name).length;
function newActivityTypeModal() {
  const m = { name: '', costing: 50, billing: 100 };
  formModal({ title: 'New activity type', model: m, needs: PM, submit: 'Add', who: 'whoever wears the People hat, or a Director',
    fields: [{ label: 'Activity type', key: 'name', reqd: true, wide: true, placeholder: 'Workshops' }, { label: 'Default costing rate', key: 'costing', type: 'currency' }, { label: 'Default billing rate', key: 'billing', type: 'currency' }],
    cmd: (x) => `capxul org projects activity-type add ${q(x.name || '<name>')} --costing-rate ${x.costing || 0} --billing-rate ${x.billing || 0}`,
    check: (x) => (P.activityTypes.some((a) => a.name.toLowerCase() === x.name.toLowerCase()) ? `${x.name} exists already.` : null),
    onSubmit: (x, close, cmd) => { P.activityTypes.push({ name: x.name, costing: +x.costing || 0, billing: +x.billing || 0, added: TODAY, disabled: 0 }); close(); cx.toast(`Added ${x.name}`, { tone: 'success', cmd }); cx.go('activity-type', x.name); } });
}
cx.route('activity-types', () => cx.page({
  title: 'Activity types', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
  sub: 'The kinds of work time is logged against, with their default hourly rates. A project may bill an activity at its own rate.',
  actions: [cx.btn('Add activity type', { kind: 'primary', icon: 'plus', needs: PM, cmd: 'capxul org projects activity-type add <name> --costing-rate … --billing-rate …', onClick: () => newActivityTypeModal() })],
  fde: 'The activity types',
  body: cx.listView({
    key: 'pj-at', rows: () => P.activityTypes, id: (a) => a.name, showId: false, selectable: false,
    titleCol: { key: 'name', label: 'Activity type' },
    status: (a) => (a.disabled ? cx.pill('Disabled', 'gray') : cx.pill('Enabled', 'blue')),
    columns: [{ key: 'costing', label: 'Default costing rate', type: 'currency', currency: 'GBP', keep: true }, { key: 'billing', label: 'Default billing rate', type: 'currency', currency: 'GBP' }, { key: 'used', label: 'Time logs', get: (a) => usedCount(a.name), type: 'int' }, { key: 'last', label: 'Last used', get: (a) => lastUsed(a.name) || null, type: 'date' }],
    sort: { options: [{ key: 'name', label: 'Activity type' }, { key: 'used', label: 'Time logs', get: (a) => usedCount(a.name) }], default: { key: 'used', dir: 'desc' } },
    href: (a) => ['activity-type', a.name],
    cmd: { cli: 'capxul org projects activity-type list', sdk: 'client.org(orgId).projects.activityTypes.list()', filters: false },
    noun: 'activity type',
  }),
}), { workspace: 'projects', title: 'Activity types' });
cx.route('activity-type', (ctx) => {
  const a = cx.find(P.activityTypes, 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', workspace: 'projects', body: cx.empty('No such activity type.', cx.btn('All activity types', { href: ['activity-types'] })) });
  const draft = { costing: a.costing, billing: a.billing };
  const canPM = cx.allowed(PM).ok;
  const cmdFor = () => `capxul org projects activity-type change ${q(a.name)}${+draft.costing !== a.costing ? ' --costing-rate ' + draft.costing : ''}${+draft.billing !== a.billing ? ' --billing-rate ' + draft.billing : ''}`;
  const save = cx.btn('Save', { kind: 'primary', needs: PM, onClick: () => { const cmd = cmdFor(); a.costing = +draft.costing || 0; a.billing = +draft.billing || 0; cx.toast(`${a.name}: new logs take these rates; logs already made keep theirs`, { tone: 'success', cmd }); cx.refresh(); } });
  save.hidden = true;
  const byProject = new Map();
  for (const l of LOGS) if (l.activity === a.name && l.billable) { const k = `${l.project}|${l.billingRate}`; const o = byProject.get(k) || { project: l.project, rate: l.billingRate, hours: 0, last: '' }; o.hours += l.hours; if (l.date > o.last) o.last = l.date; byProject.set(k, o); }
  const toggle = a.disabled
    ? cx.btn('Enable', { needs: PM, cmd: `capxul org projects activity-type enable ${q(a.name)}`, onClick: () => { a.disabled = 0; cx.toast(`${a.name} takes logs again`, { tone: 'success', cmd: `capxul org projects activity-type enable ${q(a.name)}` }); cx.refresh(); } })
    : cx.btn('Disable', { needs: PM, cmd: `capxul org projects activity-type disable ${q(a.name)}`, onClick: () => { a.disabled = 1; cx.toast(`${a.name} takes no new logs`, { tone: 'success', cmd: `capxul org projects activity-type disable ${q(a.name)}` }); cx.refresh(); } });
  return cx.page({
    title: a.name, workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Activity types', route: 'activity-types' }],
    status: a.disabled ? cx.pill('Disabled', 'gray', { lg: true }) : cx.pill('Enabled', 'blue', { lg: true }),
    sub: `${fmt.int(usedCount(a.name))} time logs${lastUsed(a.name) ? ' · last used ' + fmt.date(lastUsed(a.name)) : ' · never used'}`,
    actions: [save, toggle],
    cmd: { cli: 'capxul org projects activity-type list', note: `Changes run capxul org projects activity-type change ${a.name}.` },
    fde: `The activity type ${a.name}`,
    body: cx.formView({ doc: draft, editable: canPM, onChange: () => { save.hidden = false; cx.showAction(cmdFor(), 'Save', { pin: true }); }, sections: [
      { columns: [[{ label: 'Activity type', value: a.name, readOnly: true, reqd: true }, { label: 'Default costing rate', key: 'costing', type: 'currency', currency: 'GBP' }], [{ label: 'Default billing rate', key: 'billing', type: 'currency', currency: 'GBP' }, { label: 'Disabled', value: a.disabled ? 1 : 0, readOnly: true, type: 'check' }]] },
      { label: 'Billing rates on the logs, by project', desc: 'A project bills at its agreed rate; the default applies where none is set.', table: cx.grid({ numbered: false, rows: [...byProject.values()].sort((x, y) => y.last.localeCompare(x.last)), empty: 'No billable time logged yet', columns: [{ key: 'project', label: 'Project', render: (r) => projLink(r.project, `${r.project} · ${projName(r.project)}`) }, { key: 'rate', label: 'Billing rate', render: (r) => money(r.rate, projCurrency(PROJ.get(r.project))) }, { key: 'hours', label: 'Hours', type: 'float', dp: 1 }, { key: 'last', label: 'Last logged', type: 'date', opt: true }] }) },
    ], side: { id: a.name, title: a.name, cmd: `capxul org projects activity-type change ${q(a.name)} --billing-rate …`, created: { by: 'kwame', at: (a.added || '2025-05-01') + 'T10:00:00Z' } } }),
  });
}, { workspace: 'projects', title: 'Activity type' });

cx.route('project-types', () => {
  const DESC = { Internal: 'Work for Harbourline itself, not billed', External: 'Work for a customer', Other: 'Studio tooling, research and anything else' };
  return cx.page({
    title: 'Project types', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    actions: [cx.btn('Add project type', { kind: 'primary', icon: 'plus', needs: PM, cmd: 'capxul org projects project-type add <name> --description …', onClick: () => {
      const m = { name: '', description: '' };
      formModal({ title: 'New project type', model: m, cols: 1, needs: PM, submit: 'Add', who: 'whoever wears the People hat, or a Director', fields: [{ label: 'Project type', key: 'name', reqd: true, placeholder: 'Retainer' }, { label: 'Description', key: 'description', type: 'textarea', placeholder: 'Monthly support after launch' }],
        cmd: (x) => `capxul org projects project-type add ${q(x.name || '<name>')}${x.description ? ' --description ' + q(x.description) : ''}`,
        check: (x) => (P.projectTypes.some((t) => t.name.toLowerCase() === x.name.toLowerCase()) ? `${x.name} exists already.` : null),
        onSubmit: (x, close, cmd) => { P.projectTypes.push({ name: x.name, description: x.description || null }); close(); cx.toast(`Added ${x.name}`, { tone: 'success', cmd }); cx.refresh(); } });
    } })],
    cmd: { cli: 'capxul org projects project-type list', sdk: 'client.org(orgId).projects.projectTypes.list()' },
    fde: 'The project types',
    body: cx.card({ flush: true, body: cx.grid({ numbered: true, rows: P.projectTypes, columns: [{ key: 'name', label: 'Project type', render: (t) => h('b', t.name) }, { key: 'description', label: 'Description', render: (t) => t.description || DESC[t.name] || '' }, { key: 'n', label: 'Projects', align: 'right', render: (t) => h('a', { href: cx.href('projects'), onclick: (e) => { e.preventDefault(); cx.go('projects', null, { list: { filters: { projectType: t.name } } }); } }, String(P.projects.filter((p) => p.projectType === t.name).length)) }] }) }),
  });
}, { workspace: 'projects', title: 'Project types' });

cx.route('projects-config', () => {
  const S = P.settings;
  const draft = { ...S };
  const canPM = cx.allowed(PM).ok;
  const flags = () => [['allowUserOverlap', '--allow-user-overlap'], ['allowEmployeeOverlap', '--allow-employee-overlap'], ['fetchTimesheets', '--fetch-timesheets']].filter(([k]) => !!draft[k] !== !!S[k]).map(([k, f]) => (draft[k] ? f : f.replace('--', '--no-')));
  const save = cx.btn('Save', { kind: 'primary', needs: PM, onClick: () => { const cmd = `capxul org projects settings set ${flags().join(' ')}`; Object.assign(S, { allowUserOverlap: !!draft.allowUserOverlap, allowEmployeeOverlap: !!draft.allowEmployeeOverlap, fetchTimesheets: !!draft.fetchTimesheets }); cx.toast('Projects options saved', { tone: 'success', cmd }); cx.refresh(); } });
  save.hidden = true;
  return cx.page({
    title: 'Projects options', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }],
    actions: [save],
    cmd: { cli: 'capxul org projects settings show', sdk: 'client.org(orgId).projects.settings.show()' },
    fde: 'The projects options',
    body: cx.formView({ doc: draft, editable: canPM, onChange: () => { const f = flags(); save.hidden = !f.length; if (f.length) cx.showAction(`capxul org projects settings set ${f.join(' ')}`, 'Save', { pin: true }); }, sections: [
      { label: 'Timesheets', cols: 1, fields: [
        { label: 'Allow overlapping time for one user', key: 'allowUserOverlap', type: 'check', checkLabel: 'One user may log time that overlaps', help: 'Off: a log may not overlap another of the same user.' },
        { label: 'Allow overlapping time for one employee', key: 'allowEmployeeOverlap', type: 'check', checkLabel: 'One employee may log time that overlaps', help: 'Off: a log may not overlap another of the same employee.' },
        { label: 'Fetch timesheets in an invoice', key: 'fetchTimesheets', type: 'check', checkLabel: 'A new invoice for a project fetches its unbilled time', help: 'Billing hours from a timesheet does this whatever this says.' },
      ] },
    ], side: { id: 'Projects options', title: 'Projects options', cmd: 'capxul org projects settings set --no-allow-user-overlap' } }),
  });
}, { workspace: 'projects', title: 'Projects options' });

/* =====================================================================================================
   Reports
   ===================================================================================================== */

const projOptions = (blank = 'All projects') => [['', blank], ...P.projects.map((p) => [p.name, `${p.name} · ${p.projectName}`])];
cx.route('project-summary', () => cx.page({
  title: 'Project summary', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Reports' }],
  fde: 'The Project summary report',
  body: cx.reportView({
    key: 'pj-summary',
    filters: [{ key: 'status', label: 'Status', type: 'select', options: [['', 'Any status'], 'Open', 'On hold', 'Completed', 'Cancelled'], value: 'Open' }, { key: 'type', label: 'Project type', type: 'select', options: [['', 'Any type'], ...P.projectTypes.map((t) => t.name)], value: '' }],
    run: (v) => {
      const list = P.projects.filter((p) => (!v.status || p.status === v.status) && (!v.type || p.projectType === v.type));
      const rows = list.map((p) => { const ts = tasksOf(p.name).filter((t) => !t.isGroup); return { id: p.name, project: p.name, projectName: p.projectName, type: p.projectType, status: p.status, total: ts.length, completed: ts.filter((t) => t.status === 'Completed').length, overdue: ts.filter((t) => t.status === 'Overdue').length, completion: p.percentComplete, start: p.expectedStart, end: p.expectedEnd }; });
      return {
        columns: [{ key: 'project', label: 'Project', href: (r) => ['project', r.project] }, { key: 'projectName', label: 'Project name', width: '200px' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'total', label: 'Total tasks', type: 'int' }, { key: 'completed', label: 'Tasks completed', type: 'int' }, { key: 'overdue', label: 'Tasks overdue', type: 'int', render: (r) => (r.overdue ? h('span.pj-delay', String(r.overdue)) : '0') }, { key: 'completion', label: 'Completion', type: 'percent' }, { key: 'start', label: 'Start date', type: 'date' }, { key: 'end', label: 'End date', type: 'date' }],
        rows, totals: false,
        summary: [{ label: 'Average completion', value: rows.length ? fmt.num(sum(rows, (r) => r.completion) / rows.length, 1) + '%' : '—' }, { label: 'Total tasks', value: fmt.int(sum(rows, (r) => r.total)) }, { label: 'Completed tasks', value: fmt.int(sum(rows, (r) => r.completed)) }, { label: 'Overdue tasks', value: fmt.int(sum(rows, (r) => r.overdue)) }],
        chart: rows.length ? cx.chart.bar({ labels: rows.map((r) => r.projectName), height: 220, format: (v) => fmt.int(v), series: [{ name: 'Overdue', values: rows.map((r) => r.overdue), color: 'neg' }, { name: 'Completed', values: rows.map((r) => r.completed), color: '2' }, { name: 'Total tasks', values: rows.map((r) => r.total), color: '1' }] }) : null,
        chartTitle: 'Tasks by project',
      };
    },
    cmd: (v) => ({ cli: [`capxul org projects list${v.status ? ' --status ' + lc(v.status) : ''}${v.type ? ' --type ' + v.type : ''}`, `capxul org report run project-summary${v.status ? ' --filter status=' + q(v.status) : ''}${v.type ? ' --filter project_type=' + v.type : ''}`], note: 'Each project\'s totals and percent come with the list.' }),
  }),
}), { workspace: 'projects', title: 'Project summary' });

const lastMonth = (() => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); const ym = d.toISOString().slice(0, 7); return { from: ym + '-01', to: monthEnd(ym) }; })();
function billingSummary() {
  return cx.reportView({
    key: 'pj-billing',
    filters: [
      { key: 'employee', label: 'Employee', type: 'select', options: [['', 'Everyone'], ...uniq(P.timesheets.map((t) => t.employee)).map((id) => [id, cx.name(id)])], value: '' },
      { key: 'project', label: 'Project', type: 'select', options: projOptions(), value: '' },
      { key: 'from', label: 'From date', type: 'date', value: lastMonth.from }, { key: 'to', label: 'To date', type: 'date', value: lastMonth.to },
      { key: 'groupBy', label: 'Group by', type: 'select', options: [['project', 'Project'], ['employee', 'Employee'], ['date', 'Start date']], value: 'project' },
      { key: 'drafts', label: 'Include timesheets in draft', type: 'check', value: false },
    ],
    run: (v) => {
      const logs = LOGS.filter((l) => { const t = TSM.get(l.timesheet); if (!t || t.status === 'Cancelled' || (!v.drafts && t.status === 'Draft')) return false; return l.date >= (v.from || '0000') && l.date <= (v.to || '9999') && (!v.project || l.project === v.project) && (!v.employee || t.employee === v.employee); });
      const keyOf = (l) => (v.groupBy === 'employee' ? TSM.get(l.timesheet).employee : v.groupBy === 'date' ? TSM.get(l.timesheet).startDate : l.project || '(no project)');
      const groups = new Map();
      for (const l of logs) { const k = keyOf(l); if (!groups.has(k)) groups.set(k, new Map()); const g = groups.get(k); const sk = l.timesheet + '|' + (v.groupBy === 'project' ? '' : l.project); const o = g.get(sk) || { ts: l.timesheet, project: l.project, working: 0, billing: 0, amount: 0, invoices: new Set() }; o.working += l.hours; if (l.billable) { o.billing += l.hours; o.amount += l.billingAmount; } if (l.invoice) o.invoices.add(l.invoice); g.set(sk, o); }
      const rows = [];
      const totals = new Map();
      const keys = [...groups.keys()].sort((a, b) => (v.groupBy === 'date' ? String(b).localeCompare(String(a)) : String(a).localeCompare(String(b))));
      for (const k of keys) {
        const kids = [...groups.get(k).values()].sort((a, b) => a.ts.localeCompare(b.ts));
        const cur = v.groupBy === 'project' ? projCurrency(PROJ.get(k)) : null;
        const label = v.groupBy === 'project' ? `${k} · ${projName(k)}` : v.groupBy === 'employee' ? cx.name(k) : fmt.date(k);
        const gsum = { working: r2(sum(kids, (x) => x.working)), billing: r2(sum(kids, (x) => x.billing)) };
        const curs = uniq(kids.map((x) => projCurrency(PROJ.get(x.project))));
        rows.push({ id: 'g-' + k, indent: 0, group: true, date: label, working: gsum.working, billing: gsum.billing, amount: curs.length === 1 ? r2(sum(kids, (x) => x.amount)) : null, currency: curs[0] || 'GBP', invoiceText: curs.length > 1 ? curs.map((c) => money(sum(kids.filter((x) => projCurrency(PROJ.get(x.project)) === c), (x) => x.amount), c)).join(' + ') : '' });
        for (const x of kids) {
          const t = TSM.get(x.ts); const c = projCurrency(PROJ.get(x.project));
          totals.set(c, (totals.get(c) || 0) + x.amount);
          rows.push({ id: x.ts + x.project, indent: 1, date: fmt.date(t.startDate), project: x.project, empId: cx.person(t.employee)?.employee, empName: cx.name(t.employee), timesheet: x.ts, working: r2(x.working), billing: r2(x.billing), amount: r2(x.amount), currency: c, invoiceText: x.billing ? (x.invoices.size ? [...x.invoices].join(', ') : 'Not billed') : '' });
        }
      }
      const totalWorking = r2(sum(logs, (l) => l.hours)), totalBilling = r2(sum(logs.filter((l) => l.billable), (l) => l.hours));
      const unb = v.project ? unbilledOf(v.project).filter((l) => l.date >= v.from && l.date <= v.to) : [];
      return {
        columns: [{ key: 'date', label: v.groupBy === 'date' ? 'Start date' : 'Date', width: '170px' }, { key: 'project', label: 'Project', href: (r) => (r.project ? ['project', r.project] : null) }, { key: 'empId', label: 'Employee ID' }, { key: 'empName', label: 'Employee name' }, { key: 'timesheet', label: 'Timesheet', href: (r) => (r.timesheet ? ['timesheet', r.timesheet] : null) }, { key: 'working', label: 'Working hours', type: 'float', dp: 1 }, { key: 'billing', label: 'Billing hours', type: 'float', dp: 1 }, { key: 'amount', label: 'Billing amount', type: 'currency' }, { key: 'invoiceText', label: 'Invoice', render: (r) => (r.invoiceText === 'Not billed' ? h('span', { style: 'color:var(--t-orange)' }, 'Not billed') : r.invoiceText && !r.group ? h('span', r.invoiceText.split(', ').map((n, i) => [i ? ', ' : '', D.books.salesInvoices.some((s0) => s0.name === n) ? cx.link(n, 'sales-invoice', n) : n])) : r.invoiceText || '') }],
        rows, totals: false,
        summary: [{ label: 'Total working hours', value: fmt.num(totalWorking, 1) }, { label: 'Total billing hours', value: fmt.num(totalBilling, 1) }, ...[...totals.entries()].map(([c, a]) => ({ label: `Total billing amount (${c})`, value: money(a, c) }))],
        message: unb.length ? `${fmt.num(sum(unb, (l) => l.hours), 1)} billable hours of ${projName(v.project)} in this range are not on an invoice yet.` : null, messageTone: 'warning',
        empty: 'No time logged in this range.',
      };
    },
    related: [cx.btn('Bill the unbilled time', { icon: 'file', needs: 'Invoicing', cmd: 'capxul org projects timesheet bill <timesheet>… --to <mailbox>', onClick: () => {
      const st = cx.current.name; const projVal = document.querySelector('#rv-pj-billing-project')?.value;
      const from = document.querySelector('#rv-pj-billing-from')?.value || lastMonth.from, to = document.querySelector('#rv-pj-billing-to')?.value || lastMonth.to;
      const projName0 = projVal || unbilledByProject()[0]?.p.name;
      if (!projName0) { cx.toast('Nothing waits to be billed.', { tone: 'info' }); return; }
      const names = uniq(unbilledOf(projName0).filter((l) => l.date >= from && l.date <= to).map((l) => l.timesheet));
      if (!names.length) { cx.toast(`No unbilled time on ${projName(projName0)} from ${fmt.date(from)} to ${fmt.date(to)}.`, { tone: 'info' }); return; }
      billModal(names, projName0);
    } })],
    cmd: (v) => ({ cli: [`capxul org projects timesheet list${v.project ? ' --project ' + v.project : ''}${v.employee ? ' --for ' + emailOf(v.employee) : ''} --status ${v.drafts ? 'any' : 'submitted'}`, `capxul org report run timesheet-billing-summary --filter from_date=${v.from} --filter to_date=${v.to} --filter group_by=${v.groupBy}${v.project ? ' --filter project=' + v.project : ''}`], note: 'The rows are the time logs of those timesheets; a dollar project shows its amounts in dollars.' }),
    columnFilters: false,
  });
}
const billingPage = () => cx.page({ title: 'Project billing summary', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Reports' }], sub: 'The timesheet billing summary, grouped by project, employee or start date. Last month by default.', fde: 'The Project billing summary report', body: billingSummary() });
cx.route('timesheet-billing', billingPage, { workspace: 'projects', title: 'Project billing summary' });
cx.route('project-billing', billingPage, { workspace: 'projects', title: 'Project billing summary' });

cx.route('daily-timesheets', () => cx.page({
  title: 'Daily timesheet summary', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Reports' }],
  fde: 'The Daily timesheet summary report',
  body: cx.reportView({
    key: 'pj-daily',
    filters: [{ key: 'from', label: 'From date', type: 'date', value: TODAY }, { key: 'to', label: 'To date', type: 'date', value: TODAY }],
    run: (v) => {
      logIndex();
      const rows = LOGS.filter((l) => l.date >= v.from && l.date <= v.to && TSM.get(l.timesheet) && TSM.get(l.timesheet).status !== 'Cancelled').sort((a, b) => String(a.fromTime).localeCompare(String(b.fromTime))).map((l) => { const t = TSM.get(l.timesheet); return { id: l.timesheet + l.idx, timesheet: l.timesheet, emp: cx.person(t.employee)?.employee, empName: cx.name(t.employee), from: l.fromTime, to: toTime(l), hours: l.hours, activity: l.activity, task: l.task, taskName: TASK.get(l.task)?.subject || '', project: l.project, status: tsInfo(t).status }; });
      return {
        columns: [{ key: 'timesheet', label: 'Timesheet', href: (r) => ['timesheet', r.timesheet] }, { key: 'emp', label: 'Employee' }, { key: 'empName', label: 'Employee name' }, { key: 'from', label: 'From datetime', type: 'datetime' }, { key: 'to', label: 'To datetime', type: 'datetime' }, { key: 'hours', label: 'Hours', type: 'float', dp: 2 }, { key: 'activity', label: 'Activity type' }, { key: 'taskName', label: 'Task', href: (r) => (r.task ? ['task', r.task] : null) }, { key: 'project', label: 'Project', href: (r) => (r.project ? ['project', r.project] : null) }, { key: 'status', label: 'Status', render: (r) => tsPill(r.status) }],
        rows, totals: true,
        summary: [{ label: 'Hours', value: fmt.num(sum(rows, (r) => r.hours), 1) }, { label: 'People', value: fmt.int(uniq(rows.map((r) => r.empName)).length) }, { label: 'Time logs', value: fmt.int(rows.length) }],
        empty: 'No time logged on these days.',
      };
    },
    cmd: (v) => ({ cli: ['capxul org projects timesheet list --status submitted', `capxul org report run daily-timesheet-summary --filter from_date=${v.from} --filter to_date=${v.to}`], note: 'The day\'s logs are read from each timesheet: the list has no date filter.' }),
  }),
}), { workspace: 'projects', title: 'Daily timesheet summary' });

cx.route('delayed-tasks', () => cx.page({
  title: 'Delayed tasks summary', workspace: 'projects', crumbs: [{ label: 'Projects', route: 'projects-home' }, { label: 'Reports' }],
  fde: 'The Delayed tasks summary report',
  body: cx.reportView({
    key: 'pj-delayed',
    filters: [{ key: 'project', label: 'Project', type: 'select', options: projOptions(), value: '' }, { key: 'from', label: 'From date', type: 'date', value: addDays(TODAY, -120) }, { key: 'to', label: 'To date', type: 'date', value: addDays(TODAY, 30) }, { key: 'priority', label: 'Priority', type: 'select', options: [['', 'Any priority'], 'Low', 'Medium', 'High', 'Urgent'], value: '' }, { key: 'status', label: 'Status', type: 'select', options: [['', 'Any status'], 'Open', 'Working', 'Pending Review', 'Overdue', 'Completed'], value: '' }],
    run: (v) => {
      const list = P.tasks.filter((t) => !t.isGroup && t.status !== 'Cancelled' && t.expEnd && t.expEnd >= v.from && t.expEnd <= v.to && (!v.project || t.project === v.project) && (!v.priority || t.priority === v.priority) && (!v.status || t.status === v.status));
      const rows = list.map((t) => { const end = t.status === 'Completed' ? t.completedOn : null; const delay = end ? daysBetween(t.expEnd, end) : t.expEnd < TODAY ? daysBetween(t.expEnd, TODAY) : 0; return { id: t.name, task: t.name, subject: t.subject, project: t.project, status: t.status, priority: t.priority, progress: t.status === 'Completed' ? 100 : t.progress || 0, start: t.expStart, end: t.expEnd, actualEnd: end, delay: Math.max(0, delay) }; }).sort((a, b) => b.delay - a.delay || String(a.end).localeCompare(String(b.end)));
      const late = rows.filter((r) => r.delay > 0).length, ok = rows.length - late;
      const bar = rows.length ? h('div', { style: 'display:grid;gap:6px' }, h('div.pj-ontrack', ok ? h('div', { style: { width: (ok / rows.length * 100) + '%', background: 'var(--t-green)' } }, `On track ${ok}`) : null, late ? h('div', { style: { width: (late / rows.length * 100) + '%', background: 'var(--t-red)' } }, `Delayed ${late}`) : null), h('div.muted', { style: 'font-size:12.5px' }, `${fmt.pct(late / rows.length, 0)} of these tasks ended, or are running, after their expected end.`)) : null;
      return {
        columns: [{ key: 'task', label: 'Task', href: (r) => ['task', r.task] }, { key: 'subject', label: 'Subject', width: '200px' }, { key: 'project', label: 'Project', href: (r) => ['project', r.project] }, { key: 'status', label: 'Status', render: (r) => taskPill(r.status) }, { key: 'priority', label: 'Priority' }, { key: 'progress', label: 'Progress (%)', type: 'int' }, { key: 'start', label: 'Expected start date', type: 'date' }, { key: 'end', label: 'Expected end date', type: 'date' }, { key: 'actualEnd', label: 'Actual end date', type: 'date' }, { key: 'delay', label: 'Delay (in days)', type: 'int', render: (r) => (r.delay ? h('span.pj-delay', String(r.delay)) : '0') }],
        rows, totals: false, chart: bar, chartTitle: 'On track and delayed',
        empty: 'No tasks end in this range.',
      };
    },
    cmd: (v) => ({ cli: [`capxul org projects task list${v.project ? ' --project ' + v.project : ''} --status ${v.status ? lc(v.status) : 'overdue'}`, `capxul org report run delayed-tasks-summary --filter from_date=${v.from} --filter to_date=${v.to}${v.project ? ' --filter project=' + v.project : ''}`] }),
  }),
}), { workspace: 'projects', title: 'Delayed tasks summary' });

/* ---------- hooks the FDE uses ---------- */

/** Add logs to a person's draft timesheet for this week (or start one): what the FDE runs for someone's own time. */
function logWeekFor(employee, project, entries) {
  const p = PROJ.get(project);
  const ws = entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date);
  let ts = P.timesheets.find((t) => t.employee === employee && t.status === 'Draft' && t.startDate >= addDays(ws, -6));
  if (!ts) {
    const name = nextName(`TS-${TODAY.slice(0, 4)}-`, P.timesheets.map((t) => t.name));
    ts = { employee, startDate: ws, currency: p?.currency || 'GBP', name, endDate: ws, project, customer: p?.customer || null, department: cx.person(employee)?.department, loggedBy: cx.meId(), status: 'Draft', submittedAt: null, totalHours: 0, totalBillableHours: 0, totalBillableAmount: 0, totalCostingAmount: 0, totalBilledHours: 0, totalBilledAmount: 0, perBilled: 0, salesInvoices: [], logCount: 0, note: null, createdAt: NOW() };
    P.timesheets.push(ts); TSM.set(name, ts);
  }
  let idx = tsLogs(ts.name).reduce((mx, l) => Math.max(mx, l.idx), 0);
  const billable = p?.billing === 'tm' ? 1 : 0;
  for (const e of entries) {
    const r = ratesFor(employee, e.activity, project);
    const used = tsLogs(ts.name).filter((l) => l.date === e.date).reduce((s, l) => s + l.hours, 0);
    const start = 9 + used + (used >= 4 ? 0.5 : 0);
    const hh = String(Math.floor(start)).padStart(2, '0'), mm = String(Math.round((start % 1) * 60)).padStart(2, '0');
    LOGS.push({ timesheet: ts.name, idx: ++idx, date: e.date, hours: e.hours, activity: e.activity, project, task: e.task || null, billable, billingRate: billable ? r.billing : 0, billingAmount: billable ? r2(r.billing * e.hours) : 0, costingRate: r.costing, invoice: null, completed: 0, fromTime: `${e.date}T${hh}:${mm}:00Z`, note: e.note || null });
    reindex();
    if (e.date < ts.startDate) ts.startDate = e.date; if (e.date > ts.endDate) ts.endDate = e.date;
  }
  ts.logCount = idx;
  return ts;
}
cx.native = Object.assign(cx.native || {}, { billTimesheets: billModal, logWeekFor });

/* =====================================================================================================
   The project agent's work: what it proposes to each person, and what it did. Registered once, at load; each
   item links to its record. Accepting from a page instead of the panel settles the panel's item too.
   ===================================================================================================== */

/** Mark the panel's proposal done when the person did the thing from the record itself. */
function settle(key, title) {
  const it = cx.agentWork?.list?.({ kind: 'proposal' }).find((x) => x.key === key && x.state === 'open');
  if (!it) return;
  it.state = 'approved'; it.approvedBy = cx.meId(); it.approvedAt = NOW();
  cx.agentWork.add({ kind: 'done', key: 'done|' + it.key, who: it.who, agent: it.agent, title: title || it.result || it.title, detail: `Approved by ${cx.name(cx.meId())}`, route: it.route, id: it.id, at: it.approvedAt });
}
const put = (o) => { try { return cx.agentWork?.add?.({ agent: AGENT, module: 'projects', ...o }) || null; } catch (e) { console.warn('agentWork.add', e); return null; } };

/* ---------- timesheet rows from calendars ---------- */

const shortName = (p) => (p ? p.projectName.split(' ')[0] : 'Studio');
function eventOf(l) {
  const p = PROJ.get(l.project), t = TASK.get(l.task);
  if (l.activity === 'Planning') return l.hours <= 0.5 ? `${shortName(p)} stand-up` : `${shortName(p)} planning`;
  if (l.activity === 'Communication') return `Call with ${contactOf(p || {})?.first || 'the client'}`;
  if (l.activity === 'Research') return `${t?.subject || shortName(p)}: research`;
  return `Focus: ${t?.subject || p?.projectName || l.activity}`;
}
/** This week's drafts of people with a seat (their calendar is connected through their account) are suggested rows. */
const calTimesheets = () => P.timesheets.filter((t) => t.status === 'Draft' && t.startDate >= WEEK0 && cx.hasSeat(t.employee) && tsLogs(t.name).length);
function markCalendarRows() { for (const ts of calTimesheets()) for (const l of tsLogs(ts.name)) if (l.fromCalendar == null) { l.fromCalendar = 1; l.confirmed = 0; l.event = eventOf(l); } }
function confirmCalendar(ts) {
  const rows = tsLogs(ts.name).filter((l) => l.fromCalendar && !l.confirmed);
  if (!rows.length) return;
  const ok = keeper(ts)(); if (ok !== true) { cx.toast(ok, { tone: 'warning' }); return false; }
  for (const l of rows) l.confirmed = 1;
  (ts.history ||= []).push({ at: NOW(), who: cx.meId(), kind: 'approval', text: `confirmed ${fmt.plural(rows.length, 'row')} from the calendar (${fmt.hours(r2(sum(rows, (l) => l.hours)))})` });
  settle(`pj-cal-${ts.name}`, `${cx.name(cx.meId())} confirmed ${fmt.hours(r2(sum(rows, (l) => l.hours)))} from the calendar on ${ts.name}`);
  cx.toast(`Confirmed ${fmt.hours(r2(sum(rows, (l) => l.hours)))} on ${ts.name}`, { tone: 'success' });
  cx.refresh();
}
function calendarTimeline(ts, info) {
  const out = [];
  const cal = info.logs.filter((l) => l.fromCalendar);
  if (cal.length) out.push({ at: cal.reduce((m, l) => (l.fromTime < m ? l.fromTime : m), cal[0].fromTime).replace(/T(\d\d):(\d\d)/, (x, hh) => `T${hh}:59`), who: AGENT, kind: 'note', text: `suggested ${fmt.plural(cal.length, 'row')} from ${cx.firstName(ts.employee)}'s calendar`, body: cal.map((l) => `${fmt.time(l.fromTime)} ${l.event}`).join(' · ') });
  else if (ts.startDate >= '2026-10-05' && ts.loggedBy === ts.employee && cx.hasSeat(ts.employee) && ts.status !== 'Draft') out.push({ at: `${addDays(ts.startDate, 4)}T15:30:00Z`, who: AGENT, kind: 'note', text: `suggested the week's rows from ${cx.firstName(ts.employee)}'s calendar`, body: `${cx.firstName(ts.employee)} checked them and submitted.` });
  for (const x of ts.history || []) out.push({ at: x.at, who: x.who, kind: x.kind, text: x.text });
  return out;
}

/* ---------- a plan from a won deal ---------- */

const PLANNED = new Map();
const FV3 = 'CRM-DEAL-2026-00023';
const custShort = (id) => custName(id).split(' ')[0];
/** Draft the plan a deal becomes: phases, tasks, people by availability and skills (leave included), budget in hours and money. */
function draftPlanFromDeal(d, exclude = []) {
  const prev = P.projects.filter((p) => p.customer === d.company).sort((a, b) => String(b.expectedStart).localeCompare(String(a.expectedStart)))[0];
  const retainer = /retainer|care plan|support/i.test(d.subject);
  const dept = prev?.department || (/design|brand|ux|review|audit/i.test(d.subject) ? 'design' : 'delivery');
  let start = d.name === FV3 ? '2026-12-01' : mondayOf(addDays(d.closedDate && d.closedDate > TODAY ? d.closedDate : TODAY, 21));
  while (!isWorkday(start)) start = addDays(start, 1);
  const prevLead = prev ? leadOf(prev) : null;
  const prevOff = prevLead ? LEAVES.find((a) => a.employee === prevLead && a.toDate >= start && a.fromDate <= addDays(start, 60) && a.leaveType !== 'Annual Leave') : null;
  const lead = prevLead && !prevOff && !exclude.includes(prevLead) ? prevLead : retainer ? 'ravi' : 'isla';
  const leadWhy = prevOff ? `${cx.name(prevLead)} led ${prev.projectName}, but ${cx.firstName(prevLead)} is on ${prevOff.leaveType.toLowerCase()} from ${fmt.date(prevOff.fromDate)}${prevOff.status === 'Open' ? ' (requested)' : ''}, so ${cx.name(lead)}, who ${lead === 'ravi' ? 'runs the Aldermoor retainer' : 'manages Harbourline’s projects'}, leads it` : prevLead === lead ? `${cx.name(lead)}, who led ${prev.projectName}` : `${cx.name(lead)}`;
  const client = (D.crm?.contacts || []).find((c) => c.id === (d.contacts?.find((y) => y.primary) || d.contacts?.[0])?.contact)?.name || 'the client';
  const value = +d.dealValue || 0, rate = d.currency === 'USD' ? cx.rate(TODAY) : 1;
  const tasks = [];
  const T = (o) => tasks.push(o);
  let hoursYear, end;
  const monthly = (ym) => `Monthly support: ${MONTHS_LONG[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  if (retainer) {
    const months = [0, 1, 2].map((i) => { const x = new Date(start + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + i, 1); return x.toISOString().slice(0, 7); });
    const sup = suggestAssignee({ subject: 'support', activity: 'Engineering', members: prev?.members, from: start, to: monthEnd(months[0]), hours: 60, exclude: [lead, ...exclude] }).slice(0, 2);
    const [a, b] = sup.length ? sup : [{ id: 'ben', fit: 0, free: 0, off: [] }];
    T({ group: 'Set-up', subject: 'Handover from v2 and access', who: [lead], hours: 30, from: start, to: addDays(start, 3), act: 'Planning' });
    T({ group: 'Set-up', subject: 'Support runbook and response times', who: [a.id], hours: 24, from: addDays(start, 6), to: addDays(start, 10), act: 'Engineering' });
    T({ group: 'Set-up', subject: 'Upgrade to the current app framework', who: [(b || a).id], hours: 60, from: start, to: addDays(start, 17), act: 'Engineering' });
    for (const ym of months) T({ group: 'Support', subject: monthly(ym), who: uniq([a.id, (b || a).id]), hours: 40, from: ym === months[0] ? start : ym + '-01', to: monthEnd(ym), act: 'Engineering' });
    const q = monthEnd(months[2]); let qd = q; while (!isWorkday(qd)) qd = addDays(qd, -1);
    T({ group: 'Support', subject: `Quarterly review with ${client}`, who: [lead], hours: 4, from: addDays(qd, -4), to: qd, act: 'Communication', milestone: true });
    hoursYear = 30 + 24 + 60 + 12 * 40 + 4 * 4; end = addDays(start, 364);
    const people = sup.length ? sup : [a];
    return finish({ people, why: people.map((x) => `${cx.name(x.id)}: ${whyText(x, start, monthEnd(months[0]))}`) });
  }
  const hours = Math.max(80, Math.round((value * rate) / 2.8 / 48 / 10) * 10);
  const phases = dept === 'design' ? [['Discovery', 0.2, 'Research'], ['Design', 0.5, 'Design'], ['Launch', 0.3, 'Design']] : [['Discovery', 0.15, 'Research'], ['Design', 0.3, 'Design'], ['Build', 0.4, 'Engineering'], ['Launch', 0.15, 'Engineering']];
  let cur = start; const why = [], people = [];
  for (const [ph, share, act] of phases) {
    const hh = Math.round((hours * share) / 2.5) * 2.5, days = Math.max(5, Math.ceil(hh / 2 / DAY_H));
    let to = cur; for (let i = 1; i < days; i++) to = nextWorkday(to);
    const best = suggestAssignee({ subject: ph, activity: act === 'Research' ? 'Design' : act, members: prev?.members, from: cur, to, hours: hh, exclude: [...exclude, ...people.map((x) => x.id)] })[0];
    const who = best ? [best.id] : [lead];
    if (best) { people.push(best); why.push(`${cx.name(best.id)} (${ph}): ${whyText(best, cur, to)}`); }
    T({ group: ph, subject: ph === 'Launch' ? `Launch ${d.subject.toLowerCase()}` : `${ph}: ${d.subject.toLowerCase()}`, who, hours: hh, from: cur, to, act, milestone: ph === 'Launch' });
    cur = nextWorkday(to);
  }
  hoursYear = hours; end = tasks.at(-1).to;
  return finish({ people, why });
  function finish(x) {
    const cost = Math.round((hoursYear * 48) / 500) * 500;
    const plan = { deal: d, lead, leadWhy, retainer, dept, start, end, tasks, hours: hoursYear, cost, contract: value, currency: d.currency || 'GBP', margin: value * rate ? (value * rate - cost) / (value * rate) : 0, people: x.people, why: x.why, draftedAt: `${TODAY}T07:20:00Z`, prev };
    PLANNED.set(d.name, plan);
    return plan;
  }
}
/** Open the project the accepted plan describes: its tasks, people and budget; link the deal to it. */
function openProjectFromPlan(pl) {
  const d = pl.deal;
  if (d.project) return PROJ.get(d.project);
  const name = nextName('PROJ-', P.projects.map((p) => p.name), 4);
  const proj = { name, projectName: `${custShort(d.company)} ${d.subject.charAt(0).toLowerCase()}${d.subject.slice(1)}`, status: 'Open', projectType: 'External', customer: d.company, department: pl.dept, priority: 'Medium', percentCompleteMethod: 'Task Completion', expectedStart: pl.start, expectedEnd: pl.end, estimatedCost: pl.cost, costCenter: cx.deptName(pl.dept), billing: pl.retainer ? 'retainer' : 'tm', members: uniq([pl.lead, ...pl.tasks.flatMap((t) => t.who)]), notes: null, holdSince: null, percentComplete: 0, actualStart: null, actualEnd: null, actualTime: 0, totalCostingAmount: 0, totalBillableAmount: 0, currency: pl.currency === 'USD' ? 'USD' : 'GBP', totalBilledAmount: 0, totalSalesAmount: pl.contract, totalPurchaseCost: 0, grossMargin: 0, grossMarginPercent: 0, salesInvoices: [], timesheetCount: 0, taskCount: 0, createdAt: NOW(), createdBy: pl.acceptedBy, lead: pl.lead, history: [] };
  P.projects.push(proj); PROJ.set(name, proj); BASE.set(name, { cost: 0, billable: 0, billed: 0, hours: 0 });
  const groups = new Map();
  for (const g of uniq(pl.tasks.map((t) => t.group))) {
    const kids = pl.tasks.filter((t) => t.group === g);
    groups.set(g, createTask({ subject: g, project: name, isGroup: 1, expStart: kids.reduce((m, t) => (t.from < m ? t.from : m), kids[0].from), expEnd: kids.reduce((m, t) => (t.to > m ? t.to : m), kids[0].to) }));
  }
  for (const x of pl.tasks) {
    const t = createTask({ subject: x.subject, project: name, parent: groups.get(x.group)?.name, expStart: x.from, expEnd: x.to, expectedTime: x.hours, isMilestone: x.milestone ? 1 : 0 });
    t.assignees = x.who.slice(); t.assignNote = { why: x.who.map((id) => `${cx.firstName(id)}: ${skillText(id)}`).join('; '), withPlan: true, acceptedBy: pl.acceptedBy, at: pl.acceptedAt };
  }
  proj.plan = { byAgent: true, deal: d, draftedAt: pl.draftedAt, acceptedAt: pl.acceptedAt, acceptedBy: pl.acceptedBy, contract: pl.contract, currency: pl.currency, lead: pl.lead, taskCount: pl.tasks.length, phases: groups.size, hours: r2(sum(pl.tasks, (t) => t.hours)) };
  d.project = name; DEAL_OF.set(name, d);
  put({ key: `pj-opened-${name}`, kind: 'done', who: pl.lead, at: NOW(), title: `Opened ${name}, ${proj.projectName}, from the accepted plan`, detail: `${d.subject} is won. ${fmt.plural(pl.tasks.length, 'task')} with their people, ${fmt.int(pl.hours)} h and ${money(pl.cost, 'GBP', 0)} budgeted.`, route: ['project', name] });
  return proj;
}
function acceptPlan(pl) {
  pl.accepted = true; pl.acceptedBy = cx.meId(); pl.acceptedAt = NOW();
  if (pl.deal.status === 'Won') { const proj = openProjectFromPlan(pl); cx.toast(`Plan accepted: ${proj.name}, ${proj.projectName}, is open`, { tone: 'success' }); cx.refresh(); return; }
  cx.toast(`Plan accepted. The project opens when ${cx.firstName(pl.deal.owner)} marks the deal Won (mock-up: move the deal to Won in the CRM).`, { tone: 'success', ms: 9000 });
}
function proposePlan(d, exclude = []) {
  const pl = draftPlanFromDeal(d, exclude);
  const won = d.status === 'Won';
  const cust = custName(d.company);
  const c = (D.crm?.contacts || []).find((x) => x.id === (d.contacts?.find((y) => y.primary) || d.contacts?.[0])?.contact);
  const lastEmail = (D.crm?.timeline || []).filter((i) => i.recordName === d.name && i.kind === 'email' && i.direction !== 'in').at(-1);
  const steps = [
    ...uniq(pl.tasks.map((t) => t.group)).map((g) => { const ks = pl.tasks.filter((t) => t.group === g); return `${g}, ${spanText(ks[0].from, ks.reduce((m, t) => (t.to > m ? t.to : m), ks[0].to))}: ${ks.slice(0, 3).map((t) => `${t.subject} (${t.who.map(cx.firstName).join(' and ')}, ${fmt.int(t.hours)} h)`).join('; ')}${ks.length > 3 ? `; and ${ks.length - 3} more` : ''}`; }),
    `Lead: ${pl.leadWhy}.`,
    ...pl.why.map((w) => `${w}.`),
    `Budget: ${fmt.int(pl.hours)} h${pl.retainer ? ' over the year' : ''}, ${money(pl.cost, 'GBP', 0)} of cost against ${money(pl.contract, pl.currency, 0)}, a ${fmt.pct(pl.margin, 0)} margin.`,
  ];
  return put({ key: `pj-plan-${d.name}`, kind: 'proposal', who: pl.lead, at: pl.draftedAt,
    title: `Plan for ${cust}: ${d.subject}`,
    detail: won ? `${d.subject} is won. Drafted from the signed proposal${lastEmail ? ` sent ${fmt.date(lastEmail.at)}` : ''}; accept it and the project opens with these tasks and people.`
      : `Drafted from the proposal ${c ? c.name : cust} agreed (the deal is ${d.status}${d.nextStep ? '; ' + d.nextStep.charAt(0).toLowerCase() + d.nextStep.slice(1) : ''}), so the team is held from ${fmt.date(pl.start)}. Accept it and the project opens the day the deal is won.`,
    steps, approveLabel: 'Accept the plan', result: `Plan for ${cust} accepted`, route: cx.hasRoute('deal') ? ['deal', d.name] : null,
    onApprove: () => acceptPlan(pl) });
}
/** Deals won in this session become plans; an accepted plan opens its project once its deal is won. */
function checkWonDeals() {
  let opened = null;
  for (const d of D.crm?.deals || []) {
    if (d.status !== 'Won' || d.project) continue;
    const pl = PLANNED.get(d.name);
    if (pl?.accepted) { opened = openProjectFromPlan(pl); continue; }
    if (pl) continue;
    if (d.closedDate && d.closedDate < addDays(TODAY, -14)) continue;
    proposePlan(d);
  }
  if (opened) { cx.toast(`${opened.projectName} is open: ${opened.name}, from the plan ${cx.firstName(opened.plan.acceptedBy)} accepted`, { tone: 'success' }); cx.refresh(); }
}

/* ---------- everything the agent proposes and did, at load ---------- */

function registerProjectAgent() {
  if (typeof cx.agentWork?.add !== 'function') return;
  markCalendarRows();
  const FC = forecastAll();
  const open = P.projects.filter((p) => p.status === 'Open');
  const taken = [];
  // 1. tasks that will run late at their person's availability: a better-placed person, for the lead to accept
  for (const t of P.tasks) {
    if (t.isGroup || !isOpenTask(t) || t.status !== 'Open' || !(t.assignees || []).length || t.expStart > addDays(TODAY, 30)) continue;
    const f = FC.get(t.name); if (!f || f.slip <= 5 || !f.short || f.after) continue;
    const p = PROJ.get(t.project); const lead = leadOf(p); if (!lead || p.status !== 'Open') continue;
    const from = t.expStart > TODAY ? t.expStart : TODAY;
    const best = suggestAssignee({ subject: t.subject, activity: activityOfTask(t), project: t.project, from, to: t.expEnd, hours: remainingOf(t), exclude: [...t.assignees, ...taken] })[0];
    if (!best || best.free < remainingOf(t) * 0.75) continue;
    const was = t.assignees.slice();
    const dependents = P.tasks.filter((x) => (x.dependsOn || []).includes(t.name) && x.isMilestone);
    t.assignees = []; const B0 = bookings();
    t.assignees = [best.id]; const FC2 = forecastAll(); t.assignees = was;
    if (wdBetween(FC2.get(t.name)?.end, f.end) < 5) continue;
    const why = whyText(best, from, t.expEnd);
    const cur = was.map((id) => `${cx.name(id)}: ${cx.person(id)?.designation || ''}${focusOf(id) < 1 ? ', half the day goes on running things' : ''}; ${fmt.int(freeHours(id, from, t.expEnd, B0))} h free for it${offText(id, from, t.expEnd) ? ' (' + offText(id, from, t.expEnd) + ')' : ''}`);
    taken.push(best.id);
    put({ key: `pj-assign-${t.name}`, kind: 'proposal', who: lead, needs: MEMBER, at: CHECKED_AT.replace('07:00', '07:05'),
      title: `Give ${t.subject} to ${cx.name(best.id)}`,
      detail: `${p.projectName}: at ${namesList(was)}'s pace it ends ${fmt.date(f.end)}, ${fmt.plural(f.slip, 'working day')} after ${fmt.date(t.expEnd)}${dependents.length ? ` and holds up ${dependents.map((x) => x.subject).join(', ')}` : ''}. With ${cx.firstName(best.id)}, who can start on ${fmt.date(from)}, it ends ${fmt.date(FC2.get(t.name)?.end)}.`,
      steps: [...cur, `${cx.name(best.id)}: ${why}`, ...dependents.filter((x) => FC.get(x.name)?.end !== FC2.get(x.name)?.end).map((x) => `${x.subject}: forecast moves from ${fmt.date(FC.get(x.name)?.end)} to ${fmt.date(FC2.get(x.name)?.end)}`)],
      approveLabel: `Give it to ${cx.firstName(best.id)}`, result: `Assigned ${t.subject} to ${cx.name(best.id)}`, route: ['task', t.name],
      onApprove: () => { reassign(t, best.id, { note: { why } }); } });
  }
  // 2. the won deal's plan (and its follow-ups when deals are won during the session)
  const fv3 = (D.crm?.deals || []).find((d) => d.name === FV3 && !d.project && ['Ready to Close', 'Won'].includes(d.status));
  if (fv3) proposePlan(fv3, taken);
  cx.on?.('route', () => { try { checkWonDeals(); } catch (e) { console.error(e); } });
  // the Saltmarsh plan: drafted from the signed proposal and accepted
  for (const p of P.projects) {
    const pl = planOf(p);
    if (!pl.byAgent || pl.draftedAt < addDays(TODAY, -45)) continue;
    put({ key: `pj-plan-done-${p.name}`, kind: 'done', who: pl.acceptedBy, at: pl.draftedAt, title: `Drafted the ${p.projectName} plan from the signed proposal`, detail: `${fmt.plural(pl.taskCount, 'task')} in ${fmt.plural(pl.phases, 'phase')}, ${fmt.int(pl.hours)} h, ${p.billing === 'fixed' ? 'a fixed ' : ''}${money(pl.contract, pl.currency, 0)}. Accepted by ${cx.name(pl.acceptedBy)} on ${fmt.date(pl.acceptedAt)}.`, route: ['project', p.name] });
  }
  // 3. timesheet rows suggested from calendars, for each person to confirm
  for (const ts of calTimesheets()) {
    const rows = tsLogs(ts.name).filter((l) => l.fromCalendar && !l.confirmed); if (!rows.length) continue;
    put({ key: `pj-cal-${ts.name}`, kind: 'proposal', who: ts.employee, at: `${TODAY}T10:30:00Z`,
      title: `Confirm this morning's time: ${fmt.hours(r2(sum(rows, (l) => l.hours)))} from your calendar`,
      detail: `${ts.name}. Matched from your calendar to your projects' tasks; confirm them and they stay on your timesheet. Nothing is submitted until you submit the week.`,
      steps: rows.map((l) => `${fmt.time(l.fromTime)} to ${fmt.time(toTime(l))} · ${l.event} · ${projName(l.project)}${l.billable ? ' · billable' : ''}`),
      approveLabel: 'Confirm', result: `Confirmed the calendar rows on ${ts.name}`, route: ['timesheet', ts.name], onApprove: () => confirmCalendar(ts) });
  }
  const lastFri = addDays(WEEK0, -3);
  const selfKept = uniq(P.timesheets.filter((t) => t.startDate === addDays(WEEK0, -7) && t.loggedBy === t.employee && cx.hasSeat(t.employee)).map((t) => t.employee));
  if (selfKept.length) put({ key: 'pj-cal-lastweek', kind: 'done', who: null, at: `${lastFri}T15:30:00Z`, title: `Suggested last week's timesheets from ${fmt.plural(selfKept.length, 'calendar')}`, detail: `${namesList(selfKept)} checked their rows and submitted. Isla keeps the time of people without a seat.`, route: ['timesheets'] });
  // 4. the weekly client update, drafted from the week's progress for the lead to send
  for (const p of open) for (const u of updatesOf(p)) {
    if (u.week !== addDays(WEEK0, -7)) continue;
    const lines = updateLines(p, u, FC);
    if (u.status === 'Draft') put({ key: `pj-update-${p.name}-${u.week}`, kind: 'proposal', who: leadOf(p), at: u.draftedAt,
      title: `Send ${u.toName} the weekly update on ${p.projectName}`, detail: `To ${u.to}. Drafted from the week of ${spanText(u.week, addDays(u.week, 4))}: the hours, what closed, what is next and what to watch.`,
      steps: lines, approveLabel: 'Send it', result: `Sent the weekly update to ${u.toName}`, route: ['project', p.name], onApprove: () => sendUpdate(p, u) });
    else put({ key: `pj-update-done-${p.name}-${u.week}`, kind: 'done', who: leadOf(p), at: u.draftedAt, title: `Drafted the weekly update on ${p.projectName} for ${u.toName}`, detail: `${cx.name(u.sentBy)} sent it on ${fmt.datetime(u.sentAt)}.`, route: ['project', p.name] });
  }
  // 5. health: overruns and slipping milestones, flagged to each lead this morning
  for (const p of open) {
    const hl = healthOf(p, FC); if (hl.level < 1) continue;
    put({ key: `pj-health-${p.name}`, kind: 'done', who: leadOf(p), at: CHECKED_AT, title: `Flagged ${p.projectName} ${hl.label.toLowerCase()}`, detail: hl.reasons.filter((r) => r.lvl >= 1).sort((a, b) => b.lvl - a.lvl).slice(0, 2).map((r) => r.text).join('. ') + '.', route: ['project', p.name] });
  }
  // tasks long past their end at 95% or more: a new end date, or closing them, for the lead
  for (const p of open) {
    const st = metricsOf(p, FC).stale; if (!st.length) continue;
    const recent = st.filter((t) => (logIndex().byTask.get(t.name) || []).some((l) => l.date >= addDays(WEEK0, -14)));
    const end = addDays(WEEK0, 11);
    const reopen = recent.length === st.length && !st.some((t) => /^Monthly support/.test(t.subject));
    put({ key: `pj-stale-${p.name}`, kind: 'proposal', who: leadOf(p), needs: MEMBER, at: CHECKED_AT.replace('07:00', '07:10'),
      title: reopen ? `Give ${fmt.plural(st.length, 'task')} on ${p.projectName} a real end date` : st.length === 1 ? `Close ${st[0].subject}, left at ${st[0].progress}%` : `Close ${fmt.plural(st.length, 'task')} on ${p.projectName} left at 95%`,
      detail: reopen ? `${st.length === 1 ? 'It has' : 'They have'} sat at 95% or more since ${fmt.date(st.reduce((m, t) => (t.expEnd < m ? t.expEnd : m), st[0].expEnd))} and still take time each week, so the plan shows them months late. Moving their end to ${fmt.date(end)} makes the forecast honest.` : `${st.length === 1 ? 'It has' : 'They have'} sat at 95% or more since ${fmt.date(st[0].expEnd)}. Closing ${st.length === 1 ? 'it' : 'them'} makes the plan and its health honest${recent.length ? '; time logged to them recently stays where it is' : ''}.`,
      steps: st.map((t) => `${t.subject}: ${t.progress}% since ${fmt.date(t.expEnd)}, ${fmt.int(taskTotals(t).hours)} h logged`),
      approveLabel: reopen ? `Move them to ${fmt.day(end)}` : st.length === 1 ? 'Close it' : 'Close them', result: reopen ? `Moved ${fmt.plural(st.length, 'task')} on ${p.projectName} to end ${fmt.date(end)}` : `Closed ${fmt.plural(st.length, 'task')} on ${p.projectName}`, route: ['project', p.name],
      onApprove: async () => { for (const t of st) { if (reopen) applyTaskChange(t, { subject: t.subject, priority: t.priority, expStart: t.expStart, expEnd: end, expectedTime: t.expectedTime }); else await taskMove(t, 'Completed', { confirmed: true, quiet: true }); } cx.toast(reopen ? `${fmt.plural(st.length, 'task')} now end ${fmt.date(end)}` : `${fmt.plural(st.length, 'task')} closed`, { tone: 'success' }); cx.refresh(); } });
  }
  // 6. billable hours gathered into a draft invoice, for whoever sends that customer's invoices
  const inv = wearers('Invoicing');
  for (const x of unbilledByProject()) {
    const p = x.p, cur = projCurrency(p);
    const last = D.books.salesInvoices.filter((i) => i.project === p.name && i.kind === 'timesheets').sort((a, b) => a.postingDate.localeCompare(b.postingDate)).at(-1);
    const who = last && inv.includes(last.createdBy) ? last.createdBy : inv[0];
    const logs = unbilledOf(p.name), names = uniq(logs.map((l) => l.timesheet));
    const acts = new Map(); for (const l of logs) acts.set(l.activity, (acts.get(l.activity) || 0) + l.hours);
    const from = logs.reduce((m, l) => (l.date < m ? l.date : m), logs[0].date), to = logs.reduce((m, l) => (l.date > m ? l.date : m), logs[0].date);
    put({ key: `pj-bill-${p.name}`, kind: 'proposal', who, needs: 'Invoicing', at: `${TODAY}T07:15:00Z`,
      title: `Invoice ${custName(p.customer)}: ${fmt.hours(r2(x.hours))} from ${spanText(from, to)}`,
      detail: `${p.projectName}. Billable hours from ${fmt.plural(names.length, 'submitted timesheet')}, gathered into a draft: ${money(x.amount, cur)} before ${cur === 'GBP' ? 'VAT' : 'any tax'}. ${custName(p.customer)} is billed monthly in arrears; send it now, or it keeps gathering until ${fmt.date(monthEnd(TODAY.slice(0, 7)))}.`,
      steps: [...[...acts.entries()].sort((a, b) => b[1] - a[1]).map(([a, hh]) => `${a}: ${fmt.hours(r2(hh))}`), last ? `Last invoice: ${last.name}, ${fmt.date(last.postingDate)}` : null].filter(Boolean),
      approveLabel: 'Review the draft', result: `Sent the invoice to ${custName(p.customer)}`, route: ['project', p.name],
      onApprove: () => { billModal(names, p.name); return false; } });
  }
  for (const i of D.books.salesInvoices.filter((y) => y.kind === 'timesheets' && y.postingDate >= addDays(TODAY, -45))) {
    const hrs = sum(i.items || [], (it) => it.qty || 0);
    put({ key: `pj-billed-${i.name}`, kind: 'done', who: i.createdBy, at: `${i.postingDate}T08:00:00Z`, title: `Gathered ${MONTHS_LONG[+i.postingDate.slice(5, 7) - 1]}'s billable hours for ${i.customerName} into a draft`, detail: `${fmt.hours(r2(hrs))}, ${money(i.grandTotal, i.currency)}. ${cx.name(i.createdBy)} checked it and sent it as ${i.name}.`, route: ['sales-invoice', i.name] });
  }
}
registerProjectAgent();
