/** The Markdown twins of the Plan page, of one task and of one milestone. The sections are the plan's own files, as written. */
import type {
  PlanExit, PlanMilestone, PlanMilestonePage, PlanPage, PlanSection, PlanTask, PlanTaskPage, Ref,
} from "#src/modules/site/types.ts";

import { link, plain, section, table } from "./md.ts";

const exitLines = (at: string, held: readonly PlanExit[]): readonly string[] =>
  held.map((e) => `- ${e.met ? "[met]" : "[open]"} \`${e.id}\`: ${plain(e.claim)}${e.evidence === "" ? "" : ` Evidence: ${plain(e.evidence)}`}${e.evals.length ? ` Evals: ${e.evals.map((r) => link(at, r)).join(", ")}` : ""}`);

const state = (t: PlanTask): string => `${t.state}${t.thread === "" ? "" : `, thread ${t.thread}`}`;
// a `](` in the plan's own text is escaped, so the only links in a twin are the ones the site makes
const sections = (held: readonly PlanSection[], level = "##"): readonly string[] => held.flatMap((s) => [`${level} ${s.heading}`, "", s.body.replaceAll("](", "]\\("), ""]);
const named = (held: readonly PlanSection[], ...headings: string[]): readonly PlanSection[] => held.filter((s) => headings.some((h) => h.toLowerCase() === s.heading.toLowerCase()));
const taskRows = (at: string, held: readonly PlanTask[]): readonly string[] =>
  table(["Task", "State", "Thread", "What"], held.map((t) => [link(at, t.ref), t.state, t.thread, plain(t.what)]));
const history = (held: PlanTaskPage["history"]): readonly string[] =>
  held.length === 0 ? [] : section("History", table(["When", "By", "Change", "About", "Commit"], held.map((l) => [l.at, l.by, l.action, plain(l.summary), l.commit])));

const milestone = (at: string, p: PlanPage, m: PlanMilestone): readonly string[] => [
  `### ${link(at, m.ref)} (${m.state}; ${m.tasksDone} of ${m.tasksTotal} tasks done)`, "",
  ...sections(named(m.sections, "What it delivers", "How we know it is done"), "####"),
  ...(m.repeatsGoal && p.goal ? [`The goal's exit lines: ${m.exit.filter((e) => e.met).length} of ${p.goal.exit.length} met.`, "", ...exitLines(at, p.goal.exit), ""] : []),
  ...taskRows(at, m.tasks), "",
];

/** Top to bottom as a person reads it: where we are going, where we are, what is next, what is needed, the whole plan, how it runs, what changed. */
export const plan = (p: PlanPage): readonly string[] => {
  if (!p.present) return ["There is no plan yet: `plan/plan.json` is absent."];
  const at = p.id;
  const steps = p.path?.steps ?? [];
  return [
    plain(p.goal?.title ?? ""), "",
    ...sections(named(p.outline, "Where we are going", "What this goal is")),
    "## Where we are", "", ...(p.note ? [`**Latest note, ${p.note.date} (${p.note.by}).** ${plain(p.note.text)}`, ""] : []),
    ...p.milestones.map((m) => `- ${link(at, m.ref)} (${m.state}; ${m.tasksDone} of ${m.tasksTotal} tasks done): ${plain(m.delivers)}`), "",
    ...(p.path ? section(`What happens next: the critical path through ${p.path.milestone}`, [
      ...steps.flatMap((s) => [`${s.n}. **${link(at, s.task.ref)}** (${state(s.task)}). ${plain(s.what)}`, ...s.doneWhen.map((d) => `   - ${plain(d)}`)]), "",
      `Why this order, written ${p.path.written} by the coordinator: ${plain(p.path.why)}`,
    ]) : []),
    ...(p.problems.length === 0 ? [] : section("What the plan check says", p.problems.map((x) => `- ${x.at}: ${plain(x.why)}`))),
    ...section("What I need from you", [p.inbox === 0 ? "Nothing waits on you." : `${p.inbox} things wait on you: [answer them on the Questions page](review.md).`]),
    ...section("The whole plan", p.milestones.flatMap((m) => milestone(at, p, m))),
    ...sections(named(p.outline, "How the work runs", "What is not in this goal")),
    ...section("Recent changes", table(["When", "By", "Change", "About", "Commit"], p.log.map((l) => [l.at, l.by, l.action, plain(l.summary), l.commit]))),
  ];
};

const ref = (at: string, r: Ref): string => link(at, r);

export const planTask = (p: PlanTaskPage): readonly string[] => [
  `${p.task.id}, ${state(p.task)}, in ${link(p.id, p.milestone.ref)}.${p.pathPosition === null ? "" : ` Step ${p.pathPosition} of ${p.pathLength} on the critical path.`}`, "",
  ...sections(p.sections),
  ...(p.blocker ? section("What it is waiting for", [`${p.blocker.who === "" ? "" : `${p.blocker.who}: `}${plain(p.blocker.need)}${p.blocker.inbox ? ` ${link(p.id, { ...p.blocker.inbox, label: "Answer it on the Questions page" })}` : ""}`]) : []),
  ...(p.task.droppedWhy === "" ? [] : section("Why it was dropped", [plain(p.task.droppedWhy)])),
  ...(p.needs.length ? section("It needs", p.needs.map((t) => `- ${link(p.id, t.ref)} (${state(t)})`)) : []),
  ...(p.neededBy.length ? section("Waiting on it", p.neededBy.map((t) => `- ${link(p.id, t.ref)} (${state(t)})`)) : []),
  ...(p.records.length ? section("Records it concerns", p.records.map((r) => `- ${ref(p.id, r.ref)}: ${r.evals} evals derived on it`)) : []),
  ...(p.task.evidence.length ? section("Evidence", p.task.evidence.map((e) => `- \`${e}\``)) : []),
  ...history(p.history),
];

export const planMilestone = (p: PlanMilestonePage): readonly string[] => [
  `${p.milestone.id}, ${p.milestone.state}; ${p.milestone.tasksDone} of ${p.milestone.tasksTotal} tasks done.`, "",
  ...sections(p.milestone.sections),
  ...section("Exit lines", exitLines(p.id, p.milestone.exit)),
  ...(p.milestone.evals ? section("Concepts", [`${p.milestone.evals.passing} of ${p.milestone.evals.total} evals pass in ${p.milestone.concepts.map((c) => link(p.id, c)).join(", ")}.`]) : []),
  ...section("Its tasks", taskRows(p.id, p.milestone.tasks)),
  ...history(p.history),
];
