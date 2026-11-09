// HR: holiday lists, leave types, allocations and applications, attendance, check-ins, shifts, expense claims, advances.
import {
  rng, addDays, eachDay, isWeekend, dow, maxDate, minDate, at, TODAY, START, P, gbp, sum, months, monthEnd, daysBetween,
} from "./util.mjs";

export const BANK_HOLIDAYS = {
  2025: [["2025-01-01", "New Year's Day"], ["2025-04-18", "Good Friday"], ["2025-04-21", "Easter Monday"], ["2025-05-05", "Early May bank holiday"], ["2025-05-26", "Spring bank holiday"], ["2025-08-25", "Summer bank holiday"], ["2025-12-25", "Christmas Day"], ["2025-12-26", "Boxing Day"]],
  2026: [["2026-01-01", "New Year's Day"], ["2026-04-03", "Good Friday"], ["2026-04-06", "Easter Monday"], ["2026-05-04", "Early May bank holiday"], ["2026-05-25", "Spring bank holiday"], ["2026-08-31", "Summer bank holiday"], ["2026-12-25", "Christmas Day"], ["2026-12-28", "Boxing Day (substitute day)"]],
  2027: [["2027-01-01", "New Year's Day"], ["2027-03-26", "Good Friday"], ["2027-03-29", "Easter Monday"], ["2027-05-03", "Early May bank holiday"], ["2027-05-31", "Spring bank holiday"], ["2027-08-30", "Summer bank holiday"], ["2027-12-27", "Christmas Day (substitute day)"], ["2027-12-28", "Boxing Day (substitute day)"]],
};
const HOLIDAY_SET = new Set(Object.values(BANK_HOLIDAYS).flat().map((h) => h[0]));
export const isHoliday = (d) => HOLIDAY_SET.has(d);
export const isWorking = (d) => !isWeekend(d) && !isHoliday(d);
export function workingDays(a, b) {
  return eachDay(a, b).filter(isWorking);
}

export const LEAVE_TYPES = [
  { name: "Annual Leave", maxPerYear: 25, maxConsecutive: 15, carryForward: true, maxCarry: 5, lwp: false, description: "Paid holiday: 25 days a year plus bank holidays; up to 5 unused days carry into the next year." },
  { name: "Sick Leave", maxPerYear: 10, maxConsecutive: 10, carryForward: false, lwp: false, description: "Paid sick leave, ten days a year; statutory sick pay after that." },
  { name: "Compassionate Leave", maxPerYear: 5, maxConsecutive: 5, carryForward: false, lwp: false, description: "Paid leave for a bereavement or a family emergency." },
  { name: "Parental Leave", maxPerYear: 130, maxConsecutive: 130, carryForward: false, lwp: false, description: "Enhanced parental leave: the first 26 weeks at full pay." },
  { name: "Unpaid Leave", maxPerYear: 20, maxConsecutive: 10, carryForward: false, lwp: true, description: "Leave without pay; each day comes off the next payslip." },
];

const roundHalf = (x) => Math.round(x * 2) / 2;

export function buildHR(ctx) {
  const { people, series } = ctx;
  const r = rng("hr");
  const staff = people.filter((p) => p.type !== "Contract");
  const hr = {};

  // ---------- holiday lists ----------
  hr.holidayLists = Object.entries(BANK_HOLIDAYS).map(([y, hs]) => {
    const days = eachDay(`${y}-01-01`, `${y}-12-31`);
    const weekly = days.filter(isWeekend).map((d) => ({ date: d, description: dow(d) === 6 ? "Saturday" : "Sunday", weeklyOff: true }));
    const holidays = [...weekly, ...hs.map(([d, n]) => ({ date: d, description: n, weeklyOff: false }))].sort((a, b) => (a.date < b.date ? -1 : 1));
    return { name: `Holidays ${y}`, year: Number(y), fromDate: `${y}-01-01`, toDate: `${y}-12-31`, totalHolidays: holidays.length, weeklyOff: ["Saturday", "Sunday"], country: "United Kingdom", subdivision: "England", holidays };
  });
  hr.leaveTypes = LEAVE_TYPES;

  // ---------- leave allocations and applications ----------
  const allocations = [];
  const applications = [];
  const leaveDays = new Map(); // personId -> Map(date -> {type, half, app})
  for (const p of staff) leaveDays.set(p.id, new Map());

  const deciderFor = (p, date) => {
    // whoever wears the employee's department's hat now, else the hat above, else People; never themselves
    const holders = ctx.holdersOf(p.dept, date).filter((h) => h !== p.id && !h.startsWith("@"));
    if (holders.length) return { who: holders[0], hat: ctx.deptName(p.dept) };
    const top = ctx.holdersOf("harbourline", date).filter((h) => h !== p.id);
    if (top.length) return { who: top[0], hat: "Harbourline" };
    const people = ctx.officerHolders("people", date).filter((h) => h !== p.id);
    return { who: people[0], hat: "People" };
  };

  function allocate(p, type, from, to, days, note, carried = 0, created = from) {
    const a = { _date: created, employee: p.id, leaveType: type, fromDate: from, toDate: to, newLeavesAllocated: days, carryForward: carried > 0, carriedForward: carried, totalLeavesAllocated: days + carried, description: note, status: "Submitted", expired: false, postingDate: created };
    allocations.push(a);
    return a;
  }

  function addLeave(p, type, from, to, opts = {}) {
    const days = workingDays(from, to);
    if (!days.length) return null;
    const map = leaveDays.get(p.id);
    if (days.some((d) => map.has(d))) return null;
    if (days.some((d) => d < maxDate(p.joined, START) || (p.relieved && d > p.relieved))) return null;
    const half = !!opts.half;
    const total = half ? 0.5 : days.length;
    const posting = opts.posting || (type === "Sick Leave" ? from : addDays(from, -r.int(7, 35)));
    const app = {
      _date: maxDate(posting, maxDate(p.joined, START)),
      employee: p.id, leaveType: type, fromDate: from, toDate: to, halfDay: half, halfDayDate: half ? from : null,
      totalLeaveDays: total, reason: opts.reason || "", postingDate: maxDate(posting, maxDate(p.joined, START)),
      status: opts.status || "Approved", decidedBy: null, decidedAt: null, rejectionReason: opts.rejectionReason || null,
    };
    const dec = deciderFor(p, app.postingDate);
    if (app.status === "Approved" || app.status === "Rejected") {
      app.decidedBy = dec.who;
      app.decidedHat = dec.hat;
      app.decidedAt = minDate(addDays(app.postingDate, r.int(0, 2)), TODAY);
    } else {
      app.waitingFor = dec;
    }
    applications.push(app);
    if (app.status === "Approved" || (app.status === "Open" && opts.reserve)) {
      for (const d of days) map.set(d, { type, half, app });
    }
    return app;
  }

  const usedOf = (p, type, from, to) =>
    sum(applications.filter((a) => a.employee === p.id && a.leaveType === type && a.status === "Approved" && a.fromDate >= from && a.fromDate <= to), (a) => a.totalLeaveDays);
  const pendingOf = (p, type, from, to) =>
    sum(applications.filter((a) => a.employee === p.id && a.leaveType === type && a.status === "Open" && a.fromDate >= from && a.fromDate <= to), (a) => a.totalLeaveDays);

  const SUMMER_REASONS = ["Family holiday in Portugal", "Two weeks in Greece", "Visiting family in Lagos", "Camping in the Lake District", "Wedding in Ireland", "Interrailing with my partner", "Summer break", "Family trip to Kerala", "Cycling in the Alps", "Holiday in Croatia", "Visiting parents in Accra", "Summer in Sweden"];
  const SINGLE_REASONS = ["Moving flat", "Dentist and a long weekend", "Friend's wedding", "Personal day", "Boiler being fitted", "Long weekend away", "School sports day", "Graduation ceremony", "Hospital appointment", "Volunteering day"];
  const XMAS_REASONS = ["Christmas with family", "Christmas in Leeds", "Christmas in Glasgow", "Family in Leeds before Christmas", "Christmas abroad"];
  const SICK_REASONS = ["Flu", "Migraine", "Stomach bug", "Cold and fever", "Back pain", "COVID", "Food poisoning", "Chest infection"];

  for (const p of staff) {
    const begin = maxDate(p.joined, START);
    const end = p.relieved || "2026-12-31";
    // 2025
    if (begin <= "2025-12-31") {
      const monthsLeft = 12 - Number(begin.slice(5, 7)) + 1 - (Number(begin.slice(8, 10)) > 15 ? 1 : 0);
      const annual = roundHalf((25 * monthsLeft) / 12);
      const note = begin === START ? `Opening allocation at the move to Capxul: 1 May to 31 Dec 2025 (${annual} of 25 days)` : `2025 entitlement from joining on ${begin} (${annual} of 25 days)`;
      allocate(p, "Annual Leave", begin, "2025-12-31", annual, note, 0, begin);
      allocate(p, "Sick Leave", begin, "2025-12-31", roundHalf((10 * monthsLeft) / 12), "2025 sick leave", 0, begin);
      allocate(p, "Compassionate Leave", begin, "2025-12-31", 5, "2025 compassionate leave", 0, begin);
    }
    if (end >= "2026-01-01") {
      const b26 = maxDate(begin, "2026-01-01");
      allocations.push({ _later: true, p, b26 });
    }
  }

  // Applications for 2025, then 2026 allocations with carry-forward, then 2026 applications.
  const yearPlan = (p, year) => {
    const begin = maxDate(maxDate(p.joined, START), `${year}-01-01`);
    const end = minDate(p.relieved || `${year}-12-31`, `${year}-12-31`);
    if (begin > end) return;
    const alloc = allocations.find((a) => !a._later && a.employee === p.id && a.leaveType === "Annual Leave" && a.fromDate.startsWith(String(year)));
    if (!alloc) return;
    const cap = alloc.totalLeavesAllocated;
    let budget = cap * r.float(0.62, 0.92);
    // summer block
    const summerStart = year === 2025 ? "2025-07-07" : "2026-06-29";
    for (let tries = 0; tries < 6 && budget >= 5; tries++) {
      const s = addDays(summerStart, r.int(0, 9) * 7);
      const n = r.pick([5, 5, 7, 8, 10]);
      let e = s;
      let c = 0;
      while (c < n) {
        if (isWorking(e)) c++;
        if (c < n) e = addDays(e, 1);
      }
      if (s < begin || e > end) continue;
      if (workingDays(s, e).length > budget) continue;
      const app = addLeave(p, "Annual Leave", s, e, { reason: r.pick(SUMMER_REASONS), status: e < TODAY ? "Approved" : "Approved" });
      if (app) { budget -= app.totalLeaveDays; break; }
    }
    // Christmas
    const xs = year === 2025 ? "2025-12-22" : "2026-12-21";
    const xe = year === 2025 ? "2025-12-24" : "2026-12-24";
    if (xs >= begin && xe <= end && budget >= 3 && r.chance(0.7)) {
      const status = year === 2026 ? r.weighted([["Approved", 0.6], ["Open", 0.4]]) : "Approved";
      const app = addLeave(p, "Annual Leave", xs, xe, { reason: r.pick(XMAS_REASONS), status, reserve: true, posting: year === 2026 ? addDays(TODAY, -r.int(1, 25)) : undefined });
      if (app) budget -= app.totalLeaveDays;
    }
    // spring block in 2026
    if (year === 2026 && budget >= 4 && r.chance(0.6)) {
      const s = addDays("2026-04-07", r.int(0, 3) * 7);
      const e = addDays(s, 3);
      if (s >= begin && e <= end) {
        const app = addLeave(p, "Annual Leave", s, e, { reason: r.pick(["Easter break", "Spring break", "Family visit", "Long weekend in Spain"]) });
        if (app) budget -= app.totalLeaveDays;
      }
    }
    // October half-term in 2026 (some)
    if (year === 2026 && budget >= 3 && r.chance(0.35)) {
      const s = "2026-10-26";
      const e = r.pick(["2026-10-28", "2026-10-30"]);
      if (s >= begin && e <= end) {
        const app = addLeave(p, "Annual Leave", s, e, { reason: "Half-term with the kids" });
        if (app) budget -= app.totalLeaveDays;
      }
    }
    // single days and half days
    for (let k = 0; k < 8 && budget >= 1; k++) {
      const span = workingDays(begin, end);
      const d = r.pick(span);
      const half = r.chance(0.3);
      const app = addLeave(p, "Annual Leave", d, d, { half, reason: r.pick(SINGLE_REASONS), status: d > TODAY && r.chance(0.3) ? "Open" : "Approved", reserve: true, posting: d > TODAY ? addDays(TODAY, -r.int(0, 12)) : undefined });
      if (app) budget -= app.totalLeaveDays;
    }
    // sickness, only in the past
    const spells = r.weighted([[0, 0.25], [1, 0.35], [2, 0.25], [3, 0.15]]);
    const sickAlloc = allocations.find((a) => !a._later && a.employee === p.id && a.leaveType === "Sick Leave" && a.fromDate.startsWith(String(year)));
    let sickLeft = sickAlloc ? sickAlloc.totalLeavesAllocated : 0;
    for (let k = 0; k < spells; k++) {
      const span = workingDays(begin, minDate(end, addDays(TODAY, -3)));
      if (!span.length) break;
      const d = r.pick(span);
      const n = r.pick([1, 1, 2, 2, 3]);
      let e = d;
      let c = 1;
      while (c < n) { e = addDays(e, 1); if (isWorking(e)) c++; }
      if (workingDays(d, e).length > sickLeft) continue;
      const app = addLeave(p, "Sick Leave", d, e, { reason: r.pick(SICK_REASONS), posting: d });
      if (app) sickLeft -= app.totalLeaveDays;
    }
  };

  for (const p of staff) yearPlan(p, 2025);

  // 2026 allocations with carry-forward of up to 5 unused 2025 days; the 2025 allocation then expires.
  const later = allocations.filter((a) => a._later);
  for (const l of later) allocations.splice(allocations.indexOf(l), 1);
  for (const { p, b26 } of later) {
    const a25 = allocations.find((a) => a.employee === p.id && a.leaveType === "Annual Leave" && a.fromDate.startsWith("2025"));
    const unused = a25 ? a25.totalLeavesAllocated - usedOf(p, "Annual Leave", "2025-01-01", "2025-12-31") : 0;
    const carry = Math.min(5, Math.max(0, unused));
    if (a25) a25.expired = true;
    const monthsLeft = 12 - Number(b26.slice(5, 7)) + 1 - (Number(b26.slice(8, 10)) > 15 ? 1 : 0);
    const annual = b26 === "2026-01-01" ? 25 : roundHalf((25 * monthsLeft) / 12);
    allocate(p, "Annual Leave", b26, "2026-12-31", annual, carry ? `2026 entitlement, ${carry} carried from 2025` : "2026 entitlement", carry, b26 === "2026-01-01" ? "2025-12-29" : b26);
    allocate(p, "Sick Leave", b26, "2026-12-31", b26 === "2026-01-01" ? 10 : roundHalf((10 * monthsLeft) / 12), "2026 sick leave", 0, b26 === "2026-01-01" ? "2025-12-29" : b26);
    allocate(p, "Compassionate Leave", b26, "2026-12-31", 5, "2026 compassionate leave", 0, b26 === "2026-01-01" ? "2025-12-29" : b26);
  }
  // fixed stories before the random 2026 plans
  const byId = (id) => people.find((p) => p.id === id);
  addLeave(byId("priya"), "Annual Leave", "2026-11-09", "2026-11-13", { reason: "Half-term week with the kids in Lisbon", posting: "2026-10-12" });
  addLeave(byId("ellis"), "Annual Leave", "2026-12-21", "2026-12-24", { reason: "Family in Leeds before Christmas", status: "Open", posting: "2026-11-06", reserve: true });
  addLeave(byId("lena"), "Compassionate Leave", "2026-02-16", "2026-02-18", { reason: "Grandmother's funeral in Hamburg", posting: "2026-02-13" });
  addLeave(byId("freya"), "Unpaid Leave", "2025-08-26", "2025-08-29", { reason: "Extra days for the Edinburgh Fringe (no annual leave left before the summer)", posting: "2025-07-30" });
  addLeave(byId("jamal"), "Unpaid Leave", "2026-06-11", "2026-06-12", { reason: "Hajj travel days", posting: "2026-05-20" });
  addLeave(byId("kwame"), "Sick Leave", "2026-10-27", "2026-10-28", { reason: "Flu", posting: "2026-10-27" });
  // A rejection and a cancellation, as real lists have
  addLeave(byId("ben"), "Annual Leave", "2026-04-20", "2026-04-24", { reason: "Week in Morocco", status: "Rejected", rejectionReason: "Northstar launch week: can we move it a fortnight?", posting: "2026-03-30" });
  addLeave(byId("ben"), "Annual Leave", "2026-05-11", "2026-05-15", { reason: "Week in Morocco (moved)", posting: "2026-04-01" });
  addLeave(byId("josh"), "Annual Leave", "2025-11-17", "2025-11-21", { reason: "Trip to Japan", status: "Cancelled", posting: "2025-10-01" });
  addLeave(byId("chloe"), "Annual Leave", "2026-07-27", "2026-07-31", { reason: "Osprey go-live week (sorry!)", status: "Rejected", rejectionReason: "Osprey goes live on the 29th: please take the week after", posting: "2026-06-30" });
  // Grace's parental leave, waiting for a decision
  allocate(byId("grace"), "Parental Leave", "2026-11-06", "2027-03-31", 64, "Enhanced parental leave, 1 December 2026 to 28 February 2027", 0, "2026-11-06");
  const graceApp = addLeave(byId("grace"), "Parental Leave", "2026-12-01", "2027-02-26", { reason: "Parental leave: baby due late November", status: "Open", posting: "2026-11-06" });
  if (graceApp) graceApp.totalLeaveDays = workingDays("2026-12-01", "2027-02-26").length;

  for (const p of staff) yearPlan(p, 2026);

  // leave balance checks for the generator itself (validate.mjs repeats them)
  for (const a of allocations) {
    if (a.leaveType === "Unpaid Leave") continue;
    const used = usedOf(people.find((p) => p.id === a.employee), a.leaveType, a.fromDate, a.toDate);
    if (used > a.totalLeavesAllocated) throw new Error(`Leave overdrawn: ${a.employee} ${a.leaveType} ${a.fromDate}: ${used} > ${a.totalLeavesAllocated}`);
  }

  // name allocations and applications in date order
  allocations.sort((a, b) => (a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.employee < b.employee ? -1 : 1));
  for (const a of allocations) a.name = series.next(`HR-LAL-${a.postingDate.slice(0, 4)}-`);
  applications.sort((a, b) => (a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.fromDate < b.fromDate ? -1 : 1));
  for (const a of applications) a.name = series.next(`HR-LAP-${a.postingDate.slice(0, 4)}-`);
  hr.leaveAllocations = allocations.map(({ _date, ...a }) => a);
  hr.leaveApplications = applications.map(({ _date, ...a }) => a);
  ctx.leaveDays = leaveDays;

  // ---------- shift ----------
  hr.shiftTypes = [{ name: "Studio Day", startTime: "09:30", endTime: "18:00", holidayList: "Holidays 2026", enableAutoAttendance: true, determineCheckInOut: "Alternating entries as IN and OUT during the same shift", workingHoursCalculation: "First Check-in and Last Check-out", beginCheckInBefore: 60, allowCheckOutAfter: 60, workingHoursThresholdHalfDay: 4, workingHoursThresholdAbsent: 2, processAttendanceAfter: "2026-07-01", lastSyncOfCheckin: "2026-11-09T09:00:00Z", lateEntryGrace: 15, earlyExitGrace: 15, absentBuffer: 0, created: "2025-05-01" }];
  const assignments = [];
  for (const p of staff) {
    assignments.push({ employee: p.id, shiftType: "Studio Day", startDate: maxDate(p.joined, START), endDate: p.relieved || null, status: p.relieved ? "Inactive" : "Active" });
  }
  assignments.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  for (const a of assignments) a.name = series.next(`HR-SHA-${a.startDate.slice(2, 4)}-${a.startDate.slice(5, 7)}-`);
  hr.shiftAssignments = assignments;

  // ---------- attendance and check-ins ----------
  const att = [];
  const ck = [];
  const wfhP = [0, 0.25, 0.12, 0.12, 0.12, 0.45, 0];
  const lastMarked = "2026-11-06";
  const presence = new Map(); // personId -> Map(date -> status) for timesheets
  for (const p of staff) {
    const pm = new Map();
    presence.set(p.id, pm);
    const from = maxDate(p.joined, START);
    const to = minDate(p.relieved || TODAY, TODAY);
    const lr = rng("att-" + p.id);
    for (const d of eachDay(from, to)) {
      if (!isWorking(d)) continue;
      const lv = leaveDays.get(p.id).get(d);
      let status;
      if (lv && (lv.app.status === "Approved")) status = lv.half ? "Half Day" : "On Leave";
      else status = lr.chance(wfhP[dow(d)]) ? "Work From Home" : "Present";
      if (!lv && lr.chance(0.0015)) status = "Absent";
      pm.set(d, status);
      const auto = d >= "2026-07-01";
      // times
      const inMin = 9 * 60 + 30 + Math.round(lr.normal(-12, 14));
      const outMin = 18 * 60 + Math.round(lr.normal(6, 22));
      const halfOut = 13 * 60 + lr.int(0, 40);
      const inT = status === "Half Day" && lv && lr.chance(0.5) ? 13 * 60 + 45 + lr.int(0, 20) : inMin;
      const outT = status === "Half Day" && inT < 12 * 60 ? halfOut : outMin;
      const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      if (d <= lastMarked) {
        const worked = status === "On Leave" || status === "Absent" ? 0 : Math.round(((outT - inT) / 60) * 100) / 100;
        att.push({
          date: d, employee: p.id, status, leaveType: lv ? lv.type : null, leaveApplication: lv ? lv.app : null,
          workingHours: worked, inTime: worked ? fmt(inT) : null, outTime: worked ? fmt(outT) : null,
          lateEntry: worked > 0 && inT > 9 * 60 + 45, earlyExit: worked > 0 && status !== "Half Day" && outT < 17 * 60 + 45,
          shift: "Studio Day", source: auto ? "Check-ins" : "Marked",
        });
      }
      if (auto && (status === "Present" || status === "Work From Home" || status === "Half Day")) {
        const dev = status === "Work From Home" ? "Mobile app (home)" : lr.chance(0.8) ? "Studio entrance" : "Mobile app";
        const inIso = `${d}T${fmt(inT)}:${String(lr.int(0, 59)).padStart(2, "0")}Z`;
        if (d < TODAY || inT <= 10 * 60 + 45) ck.push({ employee: p.id, logType: "IN", time: inIso, device: dev, date: d });
        if (d < TODAY) ck.push({ employee: p.id, logType: "OUT", time: `${d}T${fmt(outT)}:${String(lr.int(0, 59)).padStart(2, "0")}Z`, device: dev, date: d });
      }
    }
  }
  att.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.employee < b.employee ? -1 : 1));
  for (const a of att) a.name = series.next(`HR-ATT-${a.date.slice(0, 4)}-`);
  ck.sort((a, b) => (a.time < b.time ? -1 : 1));
  for (const c of ck) c.name = series.next(`EMP-CKIN-${c.time.slice(5, 7)}-${c.time.slice(0, 4)}-`, 6);
  hr.attendance = att;
  hr.checkins = ck;
  ctx.presence = presence;
  return hr;
}

// Expense claims and advances need the cash book and the ledger, so they run after the money module exists.
export const EXPENSE_TYPES = [
  { name: "Travel", account: "6300", description: "Trains, flights and taxis for client work" },
  { name: "Accommodation", account: "6300", description: "Hotels on client trips" },
  { name: "Food", account: "6300", description: "Meals while travelling for work" },
  { name: "Software", account: "6200", description: "Small tools bought on a personal card" },
  { name: "Equipment", account: "6900", description: "Small equipment under £500: cables, stands, adapters" },
  { name: "Events", account: "6400", description: "Conference and meetup tickets" },
  { name: "Calls", account: "6900", description: "Phone and data abroad" },
  { name: "Others", account: "6900", description: "Anything else, with a receipt" },
];

const TRIPS = {
  fernhill: { city: "Leeds", train: [118, 162], from: "King's Cross", to: "Leeds" },
  aldermoor: { city: "Reading", train: [26, 38], from: "Paddington", to: "Reading" },
  calder: { city: "Manchester", train: [96, 148], from: "Euston", to: "Manchester Piccadilly" },
  northstar: { city: "Birmingham", train: [48, 92], from: "Euston", to: "Birmingham New Street" },
  osprey: { city: "Bristol", train: [74, 142], from: "Paddington", to: "Bristol Temple Meads" },
  larkspur: { city: "Bristol", train: [74, 142], from: "Paddington", to: "Bristol Temple Meads" },
  copperleaf: { city: "Copenhagen", flight: [148, 236], to: "Copenhagen" },
  meridian: { city: "Boston", flight: [520, 780], to: "Boston" },
};

export function buildClaims(ctx) {
  const { people, series, ledger } = ctx;
  const r = rng("claims");
  const claims = [];
  const advances = [];
  const byId = (id) => people.find((p) => p.id === id);
  const staff = people.filter((p) => p.type !== "Contract");

  // Advances first (some claims settle against them)
  const ADV = [
    { who: "priya", date: "2025-09-24", amount: 600, purpose: "Copenhagen: Copperleaf brand workshops, 29 Sep to 2 Oct", project: "PROJ-0003", claimed: 518.4, settle: "salary" },
    { who: "grace", date: "2026-02-09", amount: 400, purpose: "Leeds: Fernhill v2 kick-off week", project: "PROJ-0005", claimed: 400, settle: null },
    { who: "amira", date: "2026-06-08", amount: 1500, purpose: "Boston: Meridian design system workshops, 15 to 19 June", project: "PROJ-0012", claimed: 1342.75, settle: "salary" },
    { who: "ravi", date: "2026-09-21", amount: 350, purpose: "Bristol: Larkspur shop visits", project: "PROJ-0011", claimed: 0, settle: "returned" },
    { who: "lena", date: "2026-10-26", amount: 450, purpose: "Bristol: Larkspur beta research in three shops, 4 to 6 November", project: "PROJ-0011", claimed: 0, settle: null },
    { who: "chloe", date: "2026-11-06", amount: 300, purpose: "Boston follow-up research calls (US hours): late-night travel and food", project: "PROJ-0012", claimed: 0, settle: null, requested: true },
  ];
  for (const a of ADV) {
    const p = byId(a.who);
    const adv = { employee: a.who, postingDate: a.date, purpose: a.purpose, currency: "GBP", advanceAmount: a.amount, paidAmount: 0, claimedAmount: 0, returnedAmount: 0, pendingAmount: a.amount, project: a.project, department: p.dept, repayFromSalary: a.settle === "salary", status: "Requested", _plan: a };
    advances.push(adv);
  }
  advances.sort((a, b) => (a.postingDate < b.postingDate ? -1 : 1));
  for (const a of advances) a.name = series.next(`HR-EAD-${a.postingDate.slice(0, 4)}-`);

  // Claims from client trips, conferences and small purchases
  const plan = [];
  for (const proj of ctx.projectsDef) {
    if (!proj.customer || !TRIPS[proj.customer]) continue;
    const trip = TRIPS[proj.customer];
    const from = maxDate(proj.start, START);
    const to = minDate(proj.end, addDays(TODAY, -2));
    if (from > to) continue;
    const nTrips = trip.flight ? 2 : Math.max(1, Math.round(daysBetween(from, to) / 50));
    for (let k = 0; k < nTrips; k++) {
      const d = addDays(from, Math.floor(((k + 0.5) * daysBetween(from, to)) / nTrips) + r.int(-5, 5));
      if (!isWorking(d) || d > to) continue;
      const travellers = Object.keys(proj.team).filter((id) => byId(id) && byId(id).joined <= d && (!byId(id).relieved || byId(id).relieved >= d) && byId(id).type !== "Contract");
      const who = r.sample(travellers, Math.min(travellers.length, trip.flight ? 1 : r.int(1, 2)));
      for (const id of who) plan.push({ who: id, date: d, proj, trip });
    }
  }
  for (const m of months("2025-06-01", "2026-10-31")) {
    if (r.chance(0.55)) {
      const p = r.pick(staff.filter((x) => x.joined <= m && (!x.relieved || x.relieved > m)));
      plan.push({ who: p.id, date: addDays(m, r.int(3, 24)), small: r.pick(["Software", "Equipment", "Events", "Calls"]) });
    }
  }
  // fixed recent ones for the approvals screen
  plan.push({ who: "amira", date: "2026-11-03", fixed: [["Travel", "Return train London Paddington to Reading, Aldermoor retainer review", 31.2, 0], ["Food", "Lunch at the review", 14.85, 0]], status: "Open" });
  plan.push({ who: "freya", date: "2026-11-04", fixed: [["Software", "Font licence: Söhne desktop, one seat (Saltmarsh shop)", 248.0, 41.33]], status: "Open" });
  plan.push({ who: "hannah", date: "2026-11-05", fixed: [["Equipment", "USB-C hub and monitor cable", 54.16, 10.83]], status: "Draft" });
  plan.push({ who: "tomas", date: "2026-10-29", fixed: [["Events", "Ticket: State of the Browser 2026", 120.0, 20.0], ["Travel", "Tube and DLR to the venue", 8.4, 0]], status: "Approved" });

  plan.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const pl of plan) {
    const p = byId(pl.who);
    if (!p || p.joined > pl.date || (p.relieved && p.relieved < pl.date)) continue;
    const lines = [];
    const proj = pl.proj;
    if (pl.fixed) {
      for (const [type, desc, amount, vat] of pl.fixed) lines.push({ expenseDate: pl.date, type, description: desc, amount, vat, sanctioned: amount });
    } else if (pl.trip) {
      const t = pl.trip;
      if (t.train) {
        const fare = r.float(...t.train);
        lines.push({ expenseDate: pl.date, type: "Travel", description: `Return train London ${t.from} to ${t.to}, ${proj.name}`, amount: Math.round(fare * 100) / 100, vat: 0 });
        lines.push({ expenseDate: pl.date, type: "Food", description: `Lunch on the ${proj.name} workshop day`, amount: Math.round(r.float(9, 24) * 100) / 100, vat: 0 });
        if (r.chance(0.5)) {
          const net = Math.round(r.float(12, 28) * 100) / 100;
          lines.push({ expenseDate: pl.date, type: "Travel", description: `Taxi in ${t.city} to the client's office`, amount: net, vat: Math.round(net * 20) / 100 });
        }
        if (r.chance(0.3)) {
          const net = Math.round(r.float(95, 140) * 100) / 100;
          lines.push({ expenseDate: pl.date, type: "Accommodation", description: `Hotel in ${t.city}, one night`, amount: net, vat: Math.round(net * 20) / 100 });
        }
      } else {
        lines.push({ expenseDate: pl.date, type: "Travel", description: `Return flight London to ${t.to}, ${proj.name}`, amount: Math.round(r.float(...t.flight) * 100) / 100, vat: 0 });
        lines.push({ expenseDate: addDays(pl.date, 1), type: "Accommodation", description: `Hotel in ${t.city}, ${t.flight[0] > 300 ? 4 : 2} nights`, amount: Math.round(r.float(t.flight[0] > 300 ? 640 : 280, t.flight[0] > 300 ? 820 : 360) * 100) / 100, vat: 0 });
        lines.push({ expenseDate: addDays(pl.date, 1), type: "Food", description: `Meals in ${t.city}`, amount: Math.round(r.float(60, 140) * 100) / 100, vat: 0 });
      }
    } else {
      const s = pl.small;
      const items = {
        Software: [["Icon set licence for client decks", 39], ["Screen-recording app, one year", 72], ["Stock photo pack for a pitch", 49]],
        Equipment: [["Laptop stand", 45], ["USB-C hub", 39.99], ["Noise-cancelling headphones (approved)", 249], ["Spare monitor cable", 18.5]],
        Events: [["Ticket: London design meetup", 25], ["Ticket: UX research conference", 180], ["Ticket: frontend conference", 150]],
        Calls: [["Roaming data on a client trip", 18], ["International calls to a supplier", 12.4]],
      }[s];
      const [desc, amt] = r.pick(items);
      const vat = s === "Calls" ? 0 : Math.round(amt * 20 / 1.2) / 100;
      lines.push({ expenseDate: pl.date, type: s, description: desc, amount: Math.round((amt - vat) * 100) / 100, vat: Math.round(vat * 100) / 100 });
    }
    for (const l of lines) l.sanctioned = l.amount;
    const totalClaimed = Math.round(sum(lines, (l) => l.amount) * 100) / 100;
    const totalTax = Math.round(sum(lines, (l) => l.vat) * 100) / 100;
    const claim = {
      employee: p.id, department: p.dept, postingDate: pl.date, project: proj ? proj.id : null,
      expenses: lines.map((l, i) => ({ idx: i + 1, expenseDate: l.expenseDate, expenseClaimType: l.type, description: l.description, amount: l.amount, sanctionedAmount: l.sanctioned })),
      taxes: totalTax ? [{ account: "2102", rate: null, amount: totalTax, description: "VAT on receipts" }] : [],
      totalClaimedAmount: totalClaimed, totalSanctionedAmount: totalClaimed, totalTaxesAndCharges: totalTax,
      grandTotal: Math.round((totalClaimed + totalTax) * 100) / 100, totalAdvanceAmount: 0, totalAmountReimbursed: 0,
      receipts: lines.map((l, i) => ({ name: receiptName(l, i), hash: null })),
      status: pl.status || "Paid", approvalStatus: pl.status === "Open" || pl.status === "Draft" ? "Draft" : "Approved",
      currency: "GBP",
    };
    claims.push(claim);
  }

  // Claims that settle advances
  for (const a of advances) {
    const pl = a._plan;
    if (!pl.claimed) continue;
    const p = byId(a.employee);
    const d = addDays(pl.date, pl.amount > 1000 ? 16 : 12);
    const amt = pl.claimed;
    const lines = pl.amount > 1000
      ? [
        { type: "Travel", description: "Return flight London to Boston", amount: 612.4 },
        { type: "Accommodation", description: "Hotel in Boston's Seaport, 4 nights", amount: 588.0 },
        { type: "Food", description: "Meals in Boston", amount: Math.round((amt - 612.4 - 588.0) * 100) / 100 },
      ]
      : pl.amount === 600
        ? [
          { type: "Travel", description: "Return flight London to Copenhagen", amount: 186.2 },
          { type: "Accommodation", description: "Hotel in Vesterbro, 3 nights", amount: 254.6 },
          { type: "Food", description: "Meals in Copenhagen", amount: Math.round((amt - 186.2 - 254.6) * 100) / 100 },
        ]
        : [
          { type: "Travel", description: "Return train London King's Cross to Leeds", amount: 156.3 },
          { type: "Accommodation", description: "Hotel in Leeds, 2 nights", amount: 198.0 },
          { type: "Food", description: "Meals in Leeds", amount: Math.round((amt - 156.3 - 198.0) * 100) / 100 },
        ];
    const claim = {
      employee: p.id, department: p.dept, postingDate: d, project: pl.project,
      expenses: lines.map((l, i) => ({ idx: i + 1, expenseDate: addDays(pl.date, 5 + i), expenseClaimType: l.type, description: l.description, amount: l.amount, sanctionedAmount: l.amount })),
      taxes: [], totalClaimedAmount: amt, totalSanctionedAmount: amt, totalTaxesAndCharges: 0, grandTotal: amt,
      totalAdvanceAmount: amt, advances: [{ employeeAdvance: a, postingDate: a.postingDate, advancePaid: a.advanceAmount, unclaimedAmount: a.advanceAmount, allocatedAmount: amt }],
      totalAmountReimbursed: 0, receipts: lines.map((l, i) => ({ name: receiptName(l, i), hash: null })),
      status: "Paid", approvalStatus: "Approved", currency: "GBP", againstAdvance: true,
    };
    claims.push(claim);
  }

  claims.sort((a, b) => (a.postingDate < b.postingDate ? -1 : 1));
  for (const c of claims) c.name = series.next(`HR-EXP-${c.postingDate.slice(0, 4)}-`);

  // Books and money for claims
  for (const c of claims) {
    const p = byId(c.employee);
    for (const rc of c.receipts) rc.hash = ctx.hashOf({ claim: c.name, receipt: rc.name });
    if (c.approvalStatus !== "Approved") {
      const dec = ctx.budgetDecider(p.dept, c.postingDate, p.id);
      c.waitingFor = dec;
      continue;
    }
    const dec = ctx.budgetDecider(p.dept, c.postingDate, p.id);
    c.decidedBy = dec.who;
    c.decidedHat = dec.hat;
    c.approvedAt = minDate(addDays(c.postingDate, r.int(0, 3)), TODAY);
    const lines = [];
    for (const e of c.expenses) {
      const type = EXPENSE_TYPES.find((t) => t.name === e.expenseClaimType);
      lines.push({ account: type.account, dr: P(e.sanctionedAmount), cc: ctx.deptName(p.dept), project: c.project });
    }
    if (c.totalTaxesAndCharges) lines.push({ account: "2102", dr: P(c.totalTaxesAndCharges) });
    if (c.againstAdvance) {
      lines.push({ account: "1400", cr: P(c.totalAdvanceAmount), party: p.id, partyType: "Employee", against: { type: "Employee Advance", ref: c.advances[0].employeeAdvance } });
      if (c.grandTotal - c.totalAdvanceAmount > 0) lines.push({ account: "2600", cr: P(c.grandTotal - c.totalAdvanceAmount), party: p.id, partyType: "Employee", against: { type: "Expense Claim", ref: c } });
    } else {
      lines.push({ account: "2600", cr: P(c.grandTotal), party: p.id, partyType: "Employee", against: { type: "Expense Claim", ref: c } });
    }
    c.glVoucher = ledger.post({ date: c.approvedAt, type: "Expense Claim", ref: c, title: `Expense claim ${c.name}`, lines });
    if (c.againstAdvance) {
      const adv = c.advances[0].employeeAdvance;
      adv.claimedAmount = Math.round((adv.claimedAmount + c.totalAdvanceAmount) * 100) / 100;
      c.status = "Paid";
      c.totalAmountReimbursed = 0;
      continue;
    }
    if (c.status === "Approved") {
      c.status = "Unpaid";
      continue;
    }
    const payDay = addDays(c.approvedAt, r.int(1, 4));
    if (payDay > TODAY) { c.status = "Unpaid"; continue; }
    ctx.cash.payEmployee({ person: p, date: payDay, hour: r.int(10, 16), gbpPence: P(c.grandTotal), budget: p.dept, purpose: "claim", account: "2600", against: { type: "Expense Claim", ref: c },
      pays: [{ doctype: "Expense Claim", ref: c, date: c.postingDate, allocated: P(c.grandTotal), lines: c.expenses.map((e) => ({ idx: e.idx, description: e.description, amount: P(e.sanctionedAmount), vatRate: 0, vat: 0 })).concat(c.totalTaxesAndCharges ? [{ idx: c.expenses.length + 1, description: "VAT on receipts", amount: 0, vatRate: 2000, vat: P(c.totalTaxesAndCharges) }] : []) }],
      onSettled: (pay) => { c.status = "Paid"; c.totalAmountReimbursed = c.grandTotal; c.payment = pay; } });
  }

  // Advances: pay, then settle
  for (const a of advances) {
    const p = byId(a.employee);
    const pl = a._plan;
    delete a._plan;
    if (pl.requested) {
      a.status = "Requested";
      a.waitingFor = ctx.budgetDecider(p.dept, a.postingDate, p.id);
      continue;
    }
    const dec = ctx.budgetDecider(p.dept, a.postingDate, p.id);
    a.decidedBy = dec.who;
    a.decidedHat = dec.hat;
    const payDay = addDays(a.postingDate, 1);
    ctx.cash.payEmployee({ person: p, date: payDay, hour: 11, gbpPence: P(a.advanceAmount), budget: p.dept, purpose: "advance", account: "1400", against: { type: "Employee Advance", ref: a },
      pays: [{ doctype: "Employee Advance", ref: a, date: a.postingDate, allocated: P(a.advanceAmount), lines: [{ idx: 1, description: a.purpose, amount: P(a.advanceAmount), vatRate: 0, vat: 0 }] }],
      onSettled: (pay) => { a.paidAmount = a.advanceAmount; a.payment = pay; a.status = "Paid"; } });
    a.paidAmount = a.advanceAmount;
    const unclaimed = Math.round((a.advanceAmount - (pl.claimed || 0)) * 100) / 100;
    if (pl.settle === "salary" && unclaimed > 0) {
      a.settleBySalary = { amount: unclaimed, month: payDay.slice(0, 7) };
      ctx.advanceRecoveries.push({ employee: p.id, month: monthEnd(addDays(payDay, 25)).slice(0, 7), amount: unclaimed, advance: a });
    } else if (pl.settle === "returned") {
      ctx.cash.employeeReturns({ person: p, date: addDays(payDay, 23), gbpPence: P(unclaimed), advance: a });
      a.returnedAmount = unclaimed;
      a.status = "Returned";
    }
  }
  return { claims, advances };
}

function receiptName(l, i) {
  const base = l.type.toLowerCase();
  return `${base}-receipt-${i + 1}.${i % 3 === 0 ? "pdf" : "jpg"}`;
}

export function finishAdvances(advances) {
  for (const a of advances) {
    if (a.status === "Requested") continue;
    const settled = Math.round((a.claimedAmount + a.returnedAmount) * 100) / 100;
    a.pendingAmount = Math.round((a.paidAmount - settled) * 100) / 100;
    if (a.returnedAmount && a.claimedAmount) a.status = "Partly Claimed and Returned";
    else if (a.returnedAmount && !a.claimedAmount) a.status = "Returned";
    else if (a.claimedAmount && a.claimedAmount >= a.paidAmount) a.status = "Claimed";
    else if (a.paidAmount) a.status = "Paid";
  }
}
