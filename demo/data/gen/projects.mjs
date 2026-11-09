// Projects: activity types, project types, projects, tasks with dependencies, weekly timesheets and their time logs.
import { rng, addDays, eachDay, dow, maxDate, minDate, daysBetween, TODAY, START, at, r2 } from "./util.mjs";
import { isWorking } from "./hr.mjs";

export const ACTIVITY_TYPES = [
  { name: "Planning", costing: 55, billing: 105, added: "2025-05-01" },
  { name: "Research", costing: 50, billing: 105, added: "2025-05-01" },
  { name: "Proposal Writing", costing: 50, billing: 0, added: "2025-05-01" },
  { name: "Execution", costing: 50, billing: 110, added: "2025-05-01" },
  { name: "Communication", costing: 50, billing: 90, added: "2025-05-01" },
  { name: "Design", costing: 48, billing: 110, added: "2025-05-02" },
  { name: "Engineering", costing: 52, billing: 120, added: "2025-05-02" },
];
const GBP_RATES = {
  2025: { Engineering: 105, Design: 95, Research: 95, Planning: 95, Communication: 85, Execution: 95 },
  2026: { Engineering: 115, Design: 105, Research: 100, Planning: 100, Communication: 90, Execution: 100 },
};
const USD_RATES = { Engineering: 150, Design: 135, Research: 130, Planning: 130, Communication: 115, Execution: 130 };
export function billingRate(activity, date, currency) {
  if (currency === "USD") return USD_RATES[activity] || 0;
  return (date < "2026-01-01" ? GBP_RATES[2025] : GBP_RATES[2026])[activity] || 0;
}

const TASKS = {
  "PROJ-0001": [["Discovery", ["Field visits with meter engineers", "Offline sync spike"]], ["Build", ["Job list and route view", "Meter photo capture", "Offline sync", "Smart meter pairing flow", "Depot admin screens"]], ["Launch", ["Pilot with 40 engineers", "Rollout to all depots"]]],
  "PROJ-0002": [["Discovery", ["Tenant interviews (12)", "Audit of the current portal"]], ["Design", ["Repairs reporting journey", "Rent account and payments", "Content design: repairs guidance", "Accessibility audit (WCAG 2.2 AA)"]], ["Build", ["Single sign-on with the housing system", "Repairs API integration", "Rent statements", "Notifications by email and SMS"]], ["Launch", ["Usability testing with tenants", "Launch to 11,000 tenants"]]],
  "PROJ-0003": [["Discovery", ["Brand workshop in Copenhagen", "Competitor and category review"]], ["Design", ["Naming territories", "Logo and wordmark", "Typography and colour", "Motion principles"]], ["Launch", ["Brand guidelines", "Asset library handover"]]],
  "PROJ-0004": [["Discovery", ["Content audit", "Sitemap and page templates"]], ["Design", ["Project case study template", "Consultation booking flow", "Visual design: key pages"]], ["Build", ["CMS build", "Booking integration"]], ["Launch", ["Launch"]]],
  "PROJ-0005": [["Discovery", ["v1 analytics review", "Engineer interviews in Leeds"]], ["Design", ["Job scheduling redesign", "Parts ordering flow"]], ["Build", ["Push notifications", "Android tablet support", "Parts ordering", "Depot dashboard"]], ["Launch", ["Beta with two depots", "Release 2.0"]]],
  "PROJ-0006": [["Discovery", ["Platform selection", "Catalogue data audit"]], ["Design", ["Product listing pages", "Basket and checkout design", "Store finder design"]], ["Build", ["Catalogue migration (18,000 SKUs)", "Basket and checkout", "Click and collect", "Store finder", "Performance budget"]], ["Launch", ["Load testing", "Cutover weekend"]]],
  "PROJ-0007": [["Discovery", ["Practice workflows research", "Booking journey prototype"]], ["Build", ["NHS login integration", "Appointment slots API", "Reminders by SMS", "Practice admin screens"]], ["Launch", ["Clinical safety case (DCB0129)", "Go-live in 6 practices"]]],
  "PROJ-0008": [["Design", ["New case studies", "Homepage rewrite"]], ["Build", ["Site build", "Migration of old posts"]]],
  "PROJ-0009": "retainer",
  "PROJ-0010": [["Discovery", ["Kick-off and brand review", "Shop architecture"]], ["Design", ["Product photography brief", "Shop visual design"]], ["Build", ["Age verification at checkout", "Shop build"]], ["Launch", ["Launch before Christmas"]]],
  "PROJ-0011": [["Discovery", ["Discovery in 5 shops", "Ordering flow design"]], ["Design", ["Visual design: ordering", "Accessibility review"]], ["Build", ["iOS app shell", "Android app shell", "API integration with Square POS", "Checkout and Apple Pay", "Loyalty stamps", "Order history screen"]], ["Launch", ["Beta launch in 3 shops", "Public launch"]]],
  "PROJ-0012": [["Discovery", ["Component audit", "Adoption workshops (Boston)"]], ["Design", ["Design tokens", "Core components: forms", "Core components: data tables", "Design library"]], ["Build", ["Documentation site", "Code components in React"]], ["Launch", ["Version 1.0 release"]]],
  "PROJ-0013": [["Build", ["Project starter template", "Design token pipeline", "Timesheet nudges bot", "Component playground"]]],
};
const PHASE_SHARE = { Discovery: 0.18, Design: 0.3, Build: 0.4, Launch: 0.12 };
const PHASE_DEPT = { Discovery: ["design", "delivery"], Design: ["design"], Build: ["engineering"], Launch: ["delivery", "engineering"] };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function buildProjects(ctx) {
  const { people, series } = ctx;
  // a project's team shares, scaled to the size of the client
  for (const def of ctx.projectsDef) if (def.scale && !def._scaled) { for (const k of Object.keys(def.team)) def.team[k] = Math.round(def.team[k] * def.scale * 100) / 100; def._scaled = true; }
  const r = rng("projects");
  const byId = (id) => people.find((p) => p.id === id);
  const projects = [];
  const tasks = [];

  for (const def of ctx.projectsDef) {
    const status = def.hold ? "On hold" : def.end < TODAY ? "Completed" : "Open";
    const proj = {
      name: def.id, projectName: def.name, status, projectType: def.type, customer: def.customer, department: def.dept, priority: def.priority,
      percentCompleteMethod: "Task Completion", expectedStart: def.start, expectedEnd: def.end, estimatedCost: def.estimatedCost, costCenter: ctx.deptName(def.dept),
      billing: def.billing, members: Object.keys(def.team), notes: def.notes || null, holdSince: def.hold || null, _def: def,
    };
    projects.push(proj);
    const tpl = TASKS[def.id];
    const span = daysBetween(def.start, def.end);
    if (tpl === "retainer") {
      for (let m = def.start; m <= minDate(def.end, "2026-12-31"); m = addDays(m.slice(0, 8) + "28", 5).slice(0, 8) + "01") {
        const mm = m.slice(0, 7);
        const end = addDays(addDays(mm + "-28", 5).slice(0, 8) + "01", -1);
        tasks.push({ project: def.id, subject: `Monthly support: ${MONTHS[Number(mm.slice(5)) - 1]} ${mm.slice(0, 4)}`, phase: null, expStart: mm + "-01", expEnd: end, weight: 1, assignees: ["ben", "ravi"], isGroup: false, expectedTime: 40 });
      }
      continue;
    }
    let cursor = def.start;
    const phases = tpl.map(([ph]) => ph);
    const totalShare = phases.reduce((s, ph) => s + PHASE_SHARE[ph], 0);
    let prevGroupLast = null;
    for (const [ph, subjects] of tpl) {
      const phDays = Math.max(7, Math.round((span * PHASE_SHARE[ph]) / totalShare));
      const phStart = cursor;
      const phEnd = minDate(addDays(phStart, phDays), def.end);
      const group = { project: def.id, subject: ph, phase: ph, expStart: phStart, expEnd: phEnd, isGroup: true, weight: 0, assignees: [], expectedTime: 0 };
      tasks.push(group);
      const team = Object.keys(def.team).filter((id) => byId(id) && PHASE_DEPT[ph].includes(byId(id).dept));
      const fallback = Object.keys(def.team);
      const n = subjects.length;
      subjects.forEach((s, i) => {
        const ts = addDays(phStart, Math.floor((i * phDays) / (n + 0.6)));
        const te = minDate(addDays(ts, Math.max(4, Math.round(phDays / (n * 0.7)))), def.end);
        const pool = team.length ? team : fallback;
        const who = pool.filter((id) => { const p = byId(id); return p.joined <= te && (!p.relieved || p.relieved >= ts); });
        const assignees = who.length ? [who[i % who.length]] : [];
        const t = { project: def.id, subject: s, phase: ph, parent: group, expStart: ts, expEnd: te, isGroup: false, weight: r.int(1, 5), assignees, expectedTime: Math.round(daysBetween(ts, te) * 0.7 * 7.5 / 2.5) * 2.5, isMilestone: /launch|go-live|release|cutover|rollout|handover/i.test(s), dependsOn: [] };
        if (i === 0 && prevGroupLast) t.dependsOn.push(prevGroupLast);
        if (i > 0 && /launch|release|go-live|cutover|rollout/i.test(s)) t.dependsOn.push(...tasks.filter((x) => x.project === def.id && x.phase !== ph && !x.isGroup).slice(-2));
        tasks.push(t);
      });
      prevGroupLast = tasks[tasks.length - 1];
      cursor = phEnd;
    }
  }
  // statuses
  for (const t of tasks) {
    const proj = projects.find((p) => p.name === t.project);
    if (t.isGroup) continue;
    if (proj.status === "Completed") {
      t.status = r.chance(0.04) ? "Cancelled" : "Completed";
    } else if (proj.status === "On hold") {
      t.status = t.expEnd < proj.holdSince ? "Completed" : "Open";
    } else if (t.expEnd < TODAY) {
      t.status = r.chance(0.86) ? "Completed" : "Overdue";
    } else if (t.expStart <= TODAY) {
      t.status = r.chance(0.2) ? "Pending Review" : "Working";
    } else t.status = "Open";
    t.progress = t.status === "Completed" ? 100 : t.status === "Open" ? 0 : t.status === "Cancelled" ? 0 : t.status === "Pending Review" ? 90 : Math.min(95, Math.max(10, Math.round((daysBetween(t.expStart, TODAY) / Math.max(1, daysBetween(t.expStart, t.expEnd))) * 100 / 5) * 5));
    if (t.status === "Completed") {
      t.completedOn = minDate(addDays(t.expEnd, r.int(-3, 4)), addDays(TODAY, -1));
      t.completedBy = t.assignees[0] || null;
    }
    if (t.status === "Pending Review") t.reviewDate = addDays(TODAY, r.int(1, 6));
  }
  // fixed stories on the Larkspur app
  const lark = tasks.filter((t) => t.project === "PROJ-0011");
  const sq = lark.find((t) => t.subject === "API integration with Square POS");
  if (sq) { sq.status = "Overdue"; sq.expStart = "2026-10-19"; sq.expEnd = "2026-11-06"; sq.progress = 80; sq.assignees = ["ellis"]; sq.priority = "High"; sq.expectedTime = 60; sq.description = "Sync menu, prices and stock from Square; push orders back. Webhooks for sold-out items."; delete sq.completedOn; }
  const loyal = lark.find((t) => t.subject === "Loyalty stamps");
  const pay = lark.find((t) => t.subject === "Checkout and Apple Pay");
  if (loyal && pay) { loyal.dependsOn = [pay]; loyal.status = "Open"; loyal.progress = 0; delete loyal.completedOn; loyal.assignees = ["lena"]; pay.status = "Working"; pay.expEnd = "2026-11-20"; delete pay.completedOn; pay.progress = 55; }
  // group status
  for (const g of tasks.filter((t) => t.isGroup)) {
    const kids = tasks.filter((t) => t.parent === g);
    g.status = kids.every((k) => k.status === "Completed" || k.status === "Cancelled") ? "Completed" : kids.some((k) => k.status !== "Open") ? "Working" : "Open";
    g.progress = Math.round(kids.reduce((s, k) => s + (k.progress || 0), 0) / Math.max(1, kids.length));
    if (g.status === "Completed") g.completedOn = kids.map((k) => k.completedOn || k.expEnd).sort().slice(-1)[0];
  }
  // names
  tasks.sort((a, b) => (a.expStart < b.expStart ? -1 : a.expStart > b.expStart ? 1 : a.isGroup ? -1 : 1));
  for (const t of tasks) {
    t.name = series.next(`TASK-${maxDate(t.expStart, "2025-01-01").slice(0, 4)}-`);
    t.priority = t.priority || (t.isMilestone ? "High" : r.weighted([["Low", 0.2], ["Medium", 0.55], ["High", 0.25]]));
    t.department = projects.find((p) => p.name === t.project)._def.dept;
  }

  // ---------- timesheets ----------
  const logs = [];
  const sheets = new Map(); // key person|week|currency
  const weekStart = (d) => addDays(d, -((dow(d) + 6) % 7));
  const activityFor = (p, phase, d) => {
    if (p.dept === "engineering") return phase === "Discovery" ? "Research" : "Engineering";
    if (p.dept === "design") return p.id === "chloe" ? (phase === "Build" ? "Design" : "Research") : phase === "Discovery" ? "Research" : "Design";
    if (p.dept === "delivery") return dow(d) === 2 ? "Communication" : "Planning";
    return "Planning";
  };
  const costRate = (p, d = TODAY) => {
    const base = p.raise && d >= "2026-04-01" ? p.raise : p.base || p.agreement * 0.76;
    return r2(((base * 12) * 1.135) / 1560);
  };
  const workers = people.filter((p) => ctx.projectsDef.some((d) => d.team[p.id]));
  for (const p of workers) {
    const from = maxDate(p.joined, START);
    const to = minDate(p.relieved || TODAY, TODAY);
    const pres = ctx.presence.get(p.id);
    const lr = rng("ts-" + p.id);
    for (const d of eachDay(from, to)) {
      if (!isWorking(d)) continue;
      let cap;
      if (p.type === "Contract") {
        if (d >= "2026-07-13" && d <= "2026-07-24") continue; // Sofia's summer
        cap = 7.5;
      } else {
        const st = pres && pres.get(d);
        if (!st || st === "On Leave" || st === "Absent") continue;
        cap = st === "Half Day" ? 3.5 : 7.5;
      }
      if (d === TODAY && !(p.type === "Contract")) { if (!ctx.checkedInToday?.has(p.id)) continue; cap = 2; }
      const active = ctx.projectsDef.filter((def) => def.team[p.id] && d >= def.start && d <= def.end && (!def.hold || d < def.hold));
      // Friday afternoon: the studio crit, logged as internal time
      if (dow(d) === 5 && cap >= 7 && d < TODAY) {
        const tool = ctx.projectsDef.find((x) => x.id === "PROJ-0013");
        const onTool = d >= tool.start && d <= tool.end;
        const ws = weekStart(d);
        const key = `${p.id}|${ws}|GBP`;
        if (!sheets.has(key)) sheets.set(key, { employee: p.id, startDate: ws, currency: "GBP", logs: [] });
        const crit = { date: d, from: `${d}T16:00:00Z`, hours: 1.5, activity: "Communication", project: onTool ? "PROJ-0013" : null, task: null, billable: false, billingHours: 0, billingRate: 0, billingAmount: 0, costingRate: costRate(p, d), costingAmount: r2(1.5 * costRate(p, d)), currency: "GBP", invoice: null, completed: false, sheetKey: key, note: "Studio crit and planning" };
        sheets.get(key).logs.push(crit);
        logs.push(crit);
      }
      const W = active.reduce((s, def) => s + def.team[p.id], 0) || 1;
      const bill = p.billable || 0.6;
      const u = Math.min(1, W * 1.4);
      let dayHours = 0;
      for (const def of active) {
        let h = (cap * bill * u * def.team[p.id]) / W;
        h = Math.round(h * 2) / 2;
        if (lr.chance(0.15)) h = Math.max(0, h + lr.pick([-0.5, 0.5]));
        if (h < 0.5) continue;
        const projTasks = tasks.filter((t) => t.project === def.id && !t.isGroup && t.expStart <= d && (t.expEnd >= d || (t.status !== "Completed" && t.status !== "Cancelled")) && t.status !== "Cancelled");
        const mine = projTasks.filter((t) => t.assignees.includes(p.id));
        const task = mine.length ? mine[lr.int(0, mine.length - 1)] : projTasks.length ? projTasks[lr.int(0, projTasks.length - 1)] : null;
        const activity = activityFor(p, task?.phase, d);
        const currency = def.customer === "meridian" ? "USD" : "GBP";
        const billable = def.billing === "tm" || def.billing === "retainer" || def.billing === "fixed";
        const brate = def.billing === "tm" ? billingRate(activity, d, currency) : 0;
        const crate = costRate(p, d);
        const ws = weekStart(d);
        const key = `${p.id}|${ws}|${currency}`;
        if (!sheets.has(key)) sheets.set(key, { employee: p.id, startDate: ws, currency, logs: [] });
        const startMin = 9 * 60 + (sheets.get(key).logs.filter((l) => l.date === d).reduce((s, l) => s + l.hours * 60, 0));
        const log = {
          date: d, from: `${d}T${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}:00Z`, hours: h, activity, project: def.id, task: task || null,
          billable: def.billing !== "none", billingHours: def.billing === "tm" ? h : 0, billingRate: brate, billingAmount: def.billing === "tm" ? r2(h * brate) : 0,
          costingRate: crate, costingAmount: r2(h * crate), currency, invoice: null, completed: false, sheetKey: key,
        };
        if (!billable) log.billable = false;
        sheets.get(key).logs.push(log);
        logs.push(log);
        dayHours += h;
      }
      // the rest of the day is internal time: the studio's own tooling once it starts, else internal work
      const rest = Math.round((cap * 0.82 - dayHours - (dow(d) === 5 && cap >= 7 ? 1.5 : 0)) * 2) / 2;
      if (rest >= 1.5 && d < TODAY && (p.billable || p.type === "Contract")) {
        const tool = ctx.projectsDef.find((x) => x.id === "PROJ-0013");
        const onTool = d >= tool.start && d <= tool.end;
        const ws = weekStart(d);
        const key = `${p.id}|${ws}|GBP`;
        if (!sheets.has(key)) sheets.set(key, { employee: p.id, startDate: ws, currency: "GBP", logs: [] });
        const startMin = 9 * 60 + Math.round(dayHours * 60);
        const crate = costRate(p, d);
        const act = p.dept === "design" ? (p.id === "chloe" ? "Research" : "Design") : p.dept === "engineering" ? "Engineering" : "Planning";
        const tTasks = onTool ? tasks.filter((t) => t.project === "PROJ-0013" && !t.isGroup && t.expStart <= d) : [];
        const internal = { date: d, from: `${d}T${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}:00Z`, hours: rest, activity: act, project: onTool ? "PROJ-0013" : null, task: tTasks.length ? tTasks[lr.int(0, tTasks.length - 1)] : null,
          billable: false, billingHours: 0, billingRate: 0, billingAmount: 0, costingRate: crate, costingAmount: r2(rest * crate), currency: "GBP", invoice: null, completed: false, sheetKey: key, note: onTool ? null : r.pick(["Internal: pitch work", "Internal: design system upkeep", "Internal: learning and research", "Internal: case study write-up", "Internal: tooling"]) };
        sheets.get(key).logs.push(internal);
        logs.push(internal);
      }
    }
  }
  const timesheets = [...sheets.values()].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.employee < b.employee ? -1 : 1));
  for (const ts of timesheets) {
    ts.name = series.next(`TS-${ts.startDate.slice(0, 4)}-`);
    ts.endDate = ts.logs.reduce((m, l) => (l.date > m ? l.date : m), ts.startDate);
    ts.realStart = ts.logs.reduce((m, l) => (l.date < m ? l.date : m), "9999");
    const projs = [...new Set(ts.logs.map((l) => l.project).filter(Boolean))];
    ts.project = projs.length === 1 ? projs[0] : null;
    const custs = [...new Set(ts.logs.map((l) => ctx.projectsDef.find((d) => d.id === l.project)?.customer).filter(Boolean))];
    ts.customer = custs.length === 1 ? custs[0] : null;
    const p = byId(ts.employee);
    ts.department = p.dept;
    const seated = p.seat && p.seat <= ts.startDate;
    ts.loggedBy = seated ? p.id : ctx.officerHolders("people", ts.startDate).filter((x) => x !== p.id && x !== "samw").slice(-1)[0] || "kwame";
    ts.status = ts.startDate >= "2026-11-09" ? "Draft" : "Submitted";
    ts.submittedAt = ts.status === "Submitted" ? at(minDate(addDays(ts.startDate, 4), TODAY), 17, 30) : null;
    ts.logs.forEach((l, i) => { l.timesheet = ts; l.idx = i + 1; });
  }
  // what each project will bill in all, from its billable hours so far: the deal's value follows it
  for (const def of ctx.projectsDef) {
    const pl = logs.filter((l) => l.project === def.id);
    const billed = pl.reduce((s, l) => s + l.billingAmount, 0);
    const cost = pl.reduce((s, l) => s + l.costingAmount, 0);
    const from = maxDate(def.start, START);
    const total = eachDay(def.start, def.end).filter(isWorking).length;
    const done = eachDay(from, minDate(def.end, TODAY)).filter(isWorking).length + (def.start < START ? eachDay(def.start, addDays(START, -1)).filter(isWorking).length : 0);
    const k = def.end <= TODAY || def.hold ? total / Math.max(1, done) : total / Math.max(1, done);
    def.projectedValue = def.billing === "tm" ? Math.round((billed * Math.min(4, k)) / 1000) * 1000 : def.billing === "fixed" ? def.fee : def.billing === "retainer" ? def.retainer * 12 : 0;
    def.projectedCost = Math.round((cost * Math.min(4, k)) / 1000) * 1000;
  }
  // the last log of a completed task is marked completed
  for (const t of tasks) {
    if (t.isGroup) continue;
    const tl = logs.filter((l) => l.task === t);
    t.actualTime = r2(tl.reduce((s, l) => s + l.hours, 0));
    t.actualStart = tl.length ? tl[0].date : null;
    t.actualEnd = tl.length && (t.status === "Completed") ? tl[tl.length - 1].date : null;
    t.totalCosting = r2(tl.reduce((s, l) => s + l.costingAmount, 0));
    t.totalBillable = r2(tl.reduce((s, l) => s + l.billingAmount, 0));
    if (t.status === "Completed" && tl.length) tl[tl.length - 1].completed = true;
  }
  return { activityTypes: ACTIVITY_TYPES, projects, tasks, timesheets, logs };
}

export function finishProjects(pj, ctx) {
  const { tasks, timesheets, logs, projects } = pj;
  for (const ts of timesheets) {
    const bl = ts.logs.filter((l) => l.billingHours > 0);
    ts.totalHours = r2(ts.logs.reduce((s, l) => s + l.hours, 0));
    ts.totalBillableHours = r2(bl.reduce((s, l) => s + l.hours, 0));
    ts.totalBillableAmount = r2(bl.reduce((s, l) => s + l.billingAmount, 0));
    ts.totalCostingAmount = r2(ts.logs.reduce((s, l) => s + l.costingAmount, 0));
    const billed = bl.filter((l) => l.invoice);
    ts.totalBilledHours = r2(billed.reduce((s, l) => s + l.hours, 0));
    ts.totalBilledAmount = r2(billed.reduce((s, l) => s + l.billingAmount, 0));
    ts.perBilled = ts.totalBillableAmount ? Math.round((ts.totalBilledAmount / ts.totalBillableAmount) * 100) : 0;
    if (ts.status === "Submitted" && bl.length) {
      if (billed.length === bl.length) ts.status = "Billed";
      else if (billed.length) ts.status = "Partially Billed";
    }
    ts.salesInvoices = [...new Set(billed.map((l) => l.invoice.name))];
  }
  for (const proj of projects) {
    const pl = logs.filter((l) => l.project === proj.name);
    const ptasks = tasks.filter((t) => t.project === proj.name && !t.isGroup);
    const done = ptasks.filter((t) => t.status === "Completed").length;
    const live = ptasks.filter((t) => t.status !== "Cancelled").length;
    proj.percentComplete = proj.status === "Completed" ? 100 : live ? Math.round((done / live) * 100) : 0;
    proj.actualStart = pl.length ? pl[0].date : null;
    proj.actualEnd = pl.length ? pl[pl.length - 1].date : null;
    proj.actualTime = r2(pl.reduce((s, l) => s + l.hours, 0));
    proj.totalCostingAmount = r2(pl.reduce((s, l) => s + l.costingAmount * (l.currency === "USD" ? 1 : 1), 0));
    proj.totalBillableAmount = r2(pl.reduce((s, l) => s + l.billingAmount, 0));
    proj.currency = proj.customer === "meridian" ? "USD" : "GBP";
    const invs = ctx.salesInvoices.filter((i) => i.project === proj.name && !i.isOpening);
    proj.totalBilledAmount = r2(invs.reduce((s, i) => s + i.netTotal, 0));
    proj.totalSalesAmount = proj._def.billing === "fixed" ? proj._def.fee : proj._def.billing === "retainer" ? proj._def.retainer * 12 : proj._def.projectedValue || null;
    if (proj._def.projectedCost) proj.estimatedCost = Math.round(proj._def.projectedCost * 1.06 / 1000) * 1000;
    proj.totalPurchaseCost = r2(ctx.purchaseInvoices.filter((i) => i.project === proj.name).reduce((s, i) => s + i.netTotalGbp, 0));
    proj.grossMargin = r2(proj.totalBilledAmount - proj.totalCostingAmount - proj.totalPurchaseCost);
    proj.grossMarginPercent = proj.totalBilledAmount ? Math.round((proj.grossMargin / proj.totalBilledAmount) * 10000) / 100 : 0;
    proj.salesInvoices = invs.map((i) => i.name);
    proj.timesheetCount = new Set(pl.map((l) => l.timesheet.name)).size;
    proj.taskCount = ptasks.length;
    delete proj._def;
  }
  for (const t of tasks) {
    t.parent = t.parent ? t.parent.name : null;
    t.dependsOn = (t.dependsOn || []).map((x) => x.name);
  }
}
