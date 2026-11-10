/** The Markdown twins of the five fixed pages: Overview, Questions, Architecture, Build and Docs. */
import type { ArchitecturePage, BuildPage, CataloguePage, OperationRow, OverviewPage, PlanPage, QuestionsPage, Step } from "#src/modules/site/types.ts";

import { briefs, bullets, findings, link, plain, refs, section, table, tableSection, tiles, trace } from "./md.ts";

const steps = (held: readonly Step[]): readonly string[] => held.map((s, i) => `${i + 1}. **${plain(s.title)}** ${plain(s.text)}`);

/** Operations as a table: the command, what it is for, and where it stands. */
export const operations = (at: string, rows: readonly OperationRow[]): readonly string[] =>
  table(["Command", "What it does", "Priority", "Evals", "Stands at"],
    rows.map((r) => [link(at, r.ref), plain(r.title) + (r.isNew ? " (new)" : ""), r.priority, `${r.own.passing} / ${r.evals}`, r.stand.stand]));

export const overview = (p: OverviewPage): readonly string[] => [
  `**${plain(p.hero.eyebrow)}.** ${plain(p.hero.title)}`, "", plain(p.hero.lead), "", plain(p.hero.sub), "",
  `Built from commit \`${p.commit}\`: ${p.problems.length} problems, ${p.gaps.length} gaps, ${p.evals} evals.`, "",
  ...section(plain(p.banner.title), [plain(p.banner.text)]),
  ...(p.planNote === null ? [] : section("Where the plan is", [`${plain(p.planNote.text)} (the coordinator, ${p.planNote.date})`, "", `The whole plan: [Plan](plan.md).`])),
  ...section("The climb", p.climb.map((c) => `- **${c.step}** (${plain(c.status)}): ${c.big}, ${c.sub}`)),
  ...section(`Waiting for you (${p.waiting.length})`, [
    plain(p.needsYou), "", ...p.waiting.map((q) => `- ${link(p.id, q.ref)}: ${plain(q.title)}`),
  ]),
  ...section("What the book holds", tiles(p.id, p.holds)),
  ...section("Concepts", [
    `${p.verdicts.given} of ${p.verdicts.of} concepts have a verdict.`, "",
    ...p.concepts.map((c) => `- ${link(p.id, c.ref)}: ${c.operations} operations, ${c.decisions} decisions${c.verdict === "none" ? "" : `, verdict ${c.verdict}`}`),
  ]),
  ...section("What the book still lacks", [...findings(p.problems), ...findings(p.gaps)]),
  ...section("Sections", bullets(p.nav.map((n) => link(p.id, n)))),
];

export const questions = (p: QuestionsPage): readonly string[] => [
  plain(p.lead), "", `${p.questions.length} decisions wait for ${p.reviewer}. An answer is filed as an issue on ${p.repo} with the label \`${p.issueLabel}\`.`, "",
  ...p.questions.flatMap((q) => [
    `## ${q.id}`, "", `**${plain(q.title)}** (${q.concept})`, "", plain(q.question), "",
    ...q.options.map((o) => `- **${plain(o.label)}**${o.recommended ? " (recommended)" : ""}: ${plain(o.text)}`), "",
    `Why: ${plain(q.why)}`, "", ...(q.source === "" ? [] : [`Source: ${plain(q.source)}`, ""]),
    ...(q.affects.length === 0 ? [] : [`Holds ${q.holds}: ${refs(p.id, q.affects)}`, ""]),
  ]),
  ...section("What your answer does", steps(p.steps)),
];

export const architecture = (p: ArchitecturePage): readonly string[] => [
  plain(p.lead), "",
  ...section("Direction, hand-written", [
    "This one picture is drawn by hand in `content/direction.ts`. It is where the design is heading, not what the book records; everything after it is generated from the book.", "",
    ...p.diagram.nodes.map((n) =>
      `- **${plain(n.title)}**${n.note === "" ? "" : ` (${plain(n.note)})`}: ${plain(n.text)}${n.chips.length === 0 ? "" : ` [${n.chips.map(plain).join(", ")}]`}`),
  ]),
  ...tableSection(p.id, p.runs),
  ...section("What must be up before what", p.layers.map((layer, i) => `${i + 1}. ${i === 0 ? "Depends on nothing" : `Layer ${i + 1}`}: ${refs(p.id, layer)}`)),
  ...tableSection(p.id, p.depends),
  ...(p.traced ? section("One request, end to end", [`The operation ${link(p.id, p.traced.operation)}: ${plain(p.traced.title)}.`, "", ...trace(p.id, p.traced.trace)]) : []),
  ...p.boundary.flatMap((s) => tableSection(p.id, s)),
  ...section("What the book is silent on", bullets(p.silent.map(plain))),
  ...section("How this portal is deployed", briefs(p.id, p.portal)),
  ...section("How a change reaches this page", steps(p.steps)),
];

export const build = (p: BuildPage): readonly string[] => [
  p.recorded ? `${p.operations} operations, ${p.evals} evals, ${p.passing.passing} passing in the status document.` : `${p.operations} operations, ${p.evals} evals, none run against real code yet.`,
  "", ...tiles(p.id, p.tiles), "",
  ...section("What the book still lacks", [
    `${p.gapCounts.total} gaps in all.`, "",
    ...p.gapCounts.telemetry.map((t) => `- ${t.rule}: ${t.count}`), `- no-example: ${p.gapCounts.examples}`, `- every other rule together: ${p.gapCounts.other}`,
  ]),
  ...p.byStand.flatMap((s) => section(`${plain(s.title)} (${s.rows.length})`, [
    ...table(["Command", "What it does", "Why it stands there", "Evals passing", "Under it"], s.rows.map((r) =>
      [link(p.id, r.ref), plain(r.title), plain(r.stand.why), `${r.own.passing} / ${r.evals}`, `${r.under.passing} / ${r.under.total}`])),
  ])),
  ...p.concepts.flatMap((c) => section(`${plain(c.title)} (${c.rows.length})`, [`Concept: ${link(p.id, c.ref)}. Evals passing: ${c.passing.passing} of ${c.passing.total}.`, "", ...operations(p.id, c.rows)])),
];

/** Docs, a catalogue under it, or the eval catalogue: its counts, then its tables. */
export const catalogue = (p: CataloguePage): readonly string[] => [
  ...(p.crumbs.length === 0 ? [] : [`In: ${p.crumbs.map((r) => link(p.id, r)).join(" / ")}`, ""]),
  plain(p.lead), "", ...tiles(p.id, p.tiles), "",
  ...p.sections.flatMap((s) => tableSection(p.id, s)),
];

const exitLines = (held: PlanPage["milestones"][number]["exit"]): readonly string[] =>
  held.map((e) => `- ${e.met ? "[met]" : "[open]"} \`${e.id}\`: ${plain(e.claim)}${e.evidence === "" ? "" : ` Evidence: ${plain(e.evidence)}`}`);

/** The Plan page: the note first, then the goal, milestones, critical path, what is blocked, tasks by state and the log. */
export const plan = (p: PlanPage): readonly string[] => {
  if (!p.present) return ["There is no plan yet: `plan/plan.json` is absent."];
  const blocked = p.blocked.flatMap((b) => [
    `### ${b.task.id}: ${plain(b.task.title)}`, "", `Milestone ${b.task.milestone}. ${plain(b.task.why)}${b.waitsOnOwner ? ` Waits on ${p.owner}.` : ""}`, "",
    ...(b.decision !== null && b.decisionRef !== null
      ? [
        `Blocked on decision ${link(p.id, b.decisionRef)}${b.decisionWaits ? " (on the Questions page)" : " (already decided)"}: ${plain(b.decision.title)}`, "",
        plain(b.decision.question), "",
        ...b.decision.options.map((o) => `- **${plain(o.label)}**${o.recommended ? " (recommended)" : ""}: ${plain(o.text)}`), "",
        `The book recommends \`${b.decision.chosen}\`. ${plain(b.decision.why)}`, "",
      ]
      : [`Blocked on a need${b.who === "" ? "" : ` of ${b.who}`}: ${plain(b.need)}`, ""]),
  ]);
  return [
    ...(p.note ? [`**Latest note, ${p.note.date} (${p.note.by}).** ${plain(p.note.text)}`, ""] : []),
    ...(p.waitsOnOwner > 0 ? [`${p.waitsOnOwner} tasks wait on ${p.owner}.`, ""] : []),
    ...(p.goal ? section(`Goal: ${plain(p.goal.title)}`, [plain(p.goal.why), "", ...exitLines(p.goal.exit)]) : []),
    ...section("Milestones, in order", p.milestones.flatMap((m) => [
      `### ${m.id}: ${plain(m.title)} (${m.state})`, "", plain(m.goal), "",
      `${m.tasks.done} done, ${m.tasks.doing} doing, ${m.tasks.blocked} blocked, ${m.tasks.todo} to do.${m.evals === null ? "" : ` ${m.evals.passing} of ${m.evals.total} evals pass in ${m.concepts.map((c) => c.label).join(", ")}.`}`, "",
      ...exitLines(m.exit), "",
    ])),
    ...(p.path ? section(`Critical path through ${p.path.milestone}`, [
      ...p.path.steps.map((t, i) => `${i + 1}. \`${t.id}\` ${plain(t.title)} (${t.state}${t.thread === "" ? "" : `, thread ${t.thread}`})`), "",
      `Why, written ${p.path.written} by the coordinator: ${plain(p.path.why)}`,
    ]) : []),
    ...section(`Blocked (${p.blocked.length})`, blocked.length === 0 ? ["Nothing is blocked."] : blocked),
    ...(p.problems.length === 0 ? [] : section("What the plan check says", p.problems.map((x) => `- ${x.at}: ${plain(x.why)}`))),
    ...p.groups.filter((g) => g.tasks.length > 0).flatMap((g) => section(`${g.title} (${g.tasks.length})`,
      table(["Task", "Id", "Milestone", "Thread"], g.tasks.map((t) => [plain(t.title), `\`${t.id}\``, t.milestone, t.thread])))),
    ...section("The last changes", table(["When", "By", "Change", "About", "Commit"], p.log.map((l) => [l.at, l.by, l.action, plain(l.summary), l.commit]))),
  ];
};
