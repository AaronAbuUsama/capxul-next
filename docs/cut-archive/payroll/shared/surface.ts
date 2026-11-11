// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/surface.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as x from "./external.ts";
import * as payroll from "../payroll/operations.ts";

export const decision_surface_hr_group = defineDecision({
  id: "surface.hr-group",
  title: "HR is its own group: your side is `hr`, the Organization's `org hr`",
  question:
    "HR's 53 commands sit under twelve nouns: four at the top beside money (`leave`, `attendance`, `expense-claim`, " +
    "`advance`) and eight under `org` beside payroll's (`org employee`, `org holiday`, `org leave-type`, `org leave`, " +
    "`org shift-type`, `org attendance`, `org expense-type`, `org expense-claim`, `org advance`). Where do they go, " +
    "apart from payroll, and how are a person's side and the Organization's placed?",
  options: [
    {
      label: "own-group",
      text:
        "One group mirroring Frappe HR's HR module, its nouns its DocTypes: employee, holiday (Holiday List), leave-type, " +
        "leave (Leave Application, with its allocations and balances), shift-type (with its assignments), attendance " +
        "(with check-ins), expense-type, expense-claim and advance. A record's two sides share its noun. The person's " +
        "side is `hr <noun> <verb>`: the record's birth (`hr leave apply`, `hr expense-claim create`, `hr advance " +
        "request`, `hr attendance checkin`), withdrawing their own (`cancel`) and reading their own (`list`, `get`, " +
        "`balance`), across every employer, `--employer` choosing or filtering, never `--org`, since an Employee needs no " +
        "Seat (payroll.hr-self). The Organization's side is `org hr <noun> <verb>`: its lists of rules (`add`, `change`, " +
        "`remove`), deciding (`approve`, `reject`), paying and settling (`pay`, `settle`), marking and allocating " +
        "(`mark`, `allocate`, `unallocate`), an Employee's lifecycle, and reading everyone's (`list`, `get`, `balance " +
        "<employee>`). Every verb stays as booked.",
    },
    { label: "under-payroll", text: "One group for HR and payroll, as hrms is one app: `org payroll leave approve`, `payroll leave apply`." },
    { label: "as-booked", text: "Keep the twelve nouns as booked." },
  ],
  chosen: "own-group",
  why:
    "HR is its own group, apart from payroll, because the grouping was the issue (question 48). Frappe HR ships HR and Payroll as " +
    "two modules and two workspaces of one app, and its HR workspace holds exactly these DocTypes, the Employee first " +
    "(Employee is ERPNext Setup's, but every HR record hangs off it). Under payroll they would read as pay, which leave, " +
    "shifts and check-ins are not. The same noun on both sides, with `org` the only difference, is the 215's own " +
    "pattern (`agreement accept` and `org agreement offer`, `vote cast` and `org vote create`, `invite accept` and " +
    "`org invite list`), so whoever knows one side finds the other. All 53 are new, so no frozen command moves, and " +
    "each id becomes its new words (rules.new-operations): `leave.apply` is `hr.leave.apply`, `org.leave.approve` " +
    "`org.hr.leave.approve`.",
  source: by("frappe/hrms@8816102 (modules HR and Payroll); payroll.hr-commands; payroll.hr-self"),
  affects: [f.concept_payroll, f.component_cli],
});

export const decision_surface_hr_concept = defineDecision({
  id: "surface.hr-concept",
  title: "HR keeps its own group but stays in the payroll concept",
  question:
    "With HR its own command group, does it also become its own concept in the book, owning the Employee, holidays, " +
    "leave, shifts and attendance, expense claims and advances, with payroll depending on it; or does it stay in " +
    "payroll's concept (payroll.hr-in-payroll) with only its own command group?",
  options: [
    {
      label: "group-only",
      text:
        "HR is a command group and a part of the payroll concept, in its own files (hr-data.ts, leave.ts, attendance.ts, " +
        "expenses.ts, hr-decisions.ts), as it is now; in code, src/payroll/ keeps the same files apart. Nothing in " +
        "foundation.ts changes.",
    },
    {
      label: "hr-concept",
      text:
        "A concept `hr` owning the Employee and the thirteen native HR DocTypes, payroll depending on it. It needs the " +
        "Employee and its machine moved out of payroll; three doors from payroll into hr (an accepted agreement making " +
        "its payee an Employee, a submitted slip marking the advances it recovers and the days it counted, and a " +
        "cancelled slip undoing that), of which the first is no money fact (rules.procedures, P4); payroll's head sync " +
        "waiting on hr's for each Employee; and hr placed between payments and payroll in the build's layers.",
    },
  ],
  chosen: "group-only",
  why:
    "What Aaron named was the grouping of the surface, and the group gives it. The book's concepts are transaction " +
    "boundaries, and HR and pay share theirs: a run reads the period's attendance and leave in its own transaction " +
    "(payroll.attendance-based), an advance is recovered by a slip's deduction and returned when that slip is " +
    "submitted (payroll.advance-recovery), an accepted agreement makes an Employee in its own transaction " +
    "(payroll.agreements-in-frappe-shape), and one head sync pushes every HR and payroll DocType in one order. Split, " +
    "each crosses a concept through a door, and an agreement's Employee is no money fact, so P4 would need a third " +
    "exception. The build gains nothing: its tasks are planned one operation at a time (payroll's 93), and hr would pay " +
    "claims and advances through payments, so it would sit after payments and before payroll, lengthening the path. " +
    "Frappe ships both in one app, hrms, on one Employee. Split when HR gains native records off the path to a slip " +
    "(recruitment, appraisal, onboarding), which would then be its own. For Aaron: the alternative is the concept `hr`; " +
    "the recommendation stands until he answers.",
  source: by("payroll.hr-in-payroll; docs/mission/tasks.json (its layers, and the payroll lane's 93 tasks); frappe/hrms@8816102"),
  affects: [f.concept_payroll],
});
