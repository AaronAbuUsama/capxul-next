/** The Markdown twins of the pages that are one record's: a concept, an operation, and every other record. */
import type { ArgRow, ConceptPage, OperationPage, RecordPage } from "#src/modules/site/types.ts";

import { briefs, bullets, evals, fence, findings, groups, impact, link, plain, refs, section, table, tiles, trace, value, variants } from "./md.ts";
import { operations } from "./pages.ts";

export const concept = (p: ConceptPage): readonly string[] => [
  plain(p.about), "", `Verdict: ${p.verdict === "none" ? `none yet. ${plain(p.verdictNote)}` : p.verdict}`, "",
  ...tiles(p.id, p.counts), "",
  ...(p.dependsOn.length === 0 ? [] : [`Depends on: ${refs(p.id, p.dependsOn)}`, ""]),
  ...section("Operations", operations(p.id, p.operations)),
  ...section("State machines", p.machines.map((m) =>
    `- ${link(p.id, m.ref)}: ${m.states.map((s) => `${s.id}${s.initial ? " (initial)" : s.terminal ? " (terminal)" : ""}`).join(", ")}; ${m.transitions} transitions`)),
  ...section("Tables", briefs(p.id, p.tables)),
  ...section("Events", briefs(p.id, p.events)),
  ...section("Errors", p.errors.length === 0 ? [] : [refs(p.id, p.errors)]),
  ...p.more.flatMap((m) => section(plain(m.title), briefs(p.id, m.items))),
  ...section("If this changes", impact(p.id, p.impact)),
  ...section("Evals", evals(p.evals)),
];

const args = (rows: readonly ArgRow[]): readonly (readonly string[])[] => rows.map((r) => [`\`${r.name}\``, r.kind, plain(r.text)]);

const oldCli = (p: OperationPage): readonly string[] =>
  p.oldCli === null
    ? [`${p.isNew ? "This operation is new: the old CLI never had it." : "The old system designed this command and never shipped it."} Its arguments and flags are the target book's to design.`]
    : ["Reference, old CLI. The behaviour is kept; the spelling is the target book's to design.", "",
      ...(p.oldCli.arguments.length + p.oldCli.flags.length === 0 ? ["The old CLI took no arguments and no flags here."] : []),
      ...table(["Name", "Kind", "What it does"], [...args(p.oldCli.arguments), ...args(p.oldCli.flags)])];

export const operation = (p: OperationPage): readonly string[] => [
  plain(p.about), "", "```bash", p.synopsis, "```", "",
  ...(p.sdkCall === "" ? [] : ["The same call through the SDK:", "", ...fence("ts", p.sdkCall)]),
  ...(p.concept ? [`Concept: ${link(p.id, p.concept)}`] : []),
  ...(p.priority === "" ? [] : [`Priority: ${p.priority}${p.isNew ? " (new)" : ""}`]),
  `Stands at: **${p.stand.stand}** (${plain(p.stand.why)})`,
  `Evals passing: ${p.passing.own.passing} of ${p.evals.length} on it, ${p.passing.under.passing} of ${p.passing.under.total} under it.`,
  ...(p.implementedBy ? [`Implemented by: ${link(p.id, p.implementedBy.ref)}${p.implementedKind === "" ? "" : ` (${p.implementedKind})`}`] : []),
  ...(p.sdk === "" ? [] : [`SDK: \`${p.sdk}\``]), ...(p.budget === "" ? [] : [`Time budget: ${p.budget}`]), "",
  ...section("Examples", p.examples.flatMap((e) => [
    `**${plain(e.title)}**${e.refusal ? ` (a refusal: ${link(p.id, e.refusal)})` : ""}`, "",
    ...fence("bash", `$ ${e.input}\n${e.output}\n# exit ${e.exit}`),
  ])),
  ...section("What it returns", p.returns.length > 0 ? variants(p.returns, true) : ["Not designed yet: the book does not hold what the command prints or its `--json` shape."]),
  ...section("Who can do it", p.who === "" ? [] : [plain(p.who)]),
  ...section("What it changes", p.changes === "" ? [] : [plain(p.changes)]),
  ...section("Arguments and flags", oldCli(p)),
  ...section("What happens when you run it", trace(p.id, p.trace)),
  ...section("Acceptance claims", p.acceptance.map((a) => `${a.n}. ${plain(a.claim)}${a.observes === "" ? "" : ` Observes: ${plain(a.observes)}`}`)),
  ...section("Evals", p.evalKinds.flatMap((k) => [
    `### ${plain(k.name)} (\`${k.kind}\`)`, "", ...(k.claims === "" ? [] : [plain(k.claims), ""]),
    ...table(["Eval", "Claim", "Decided by", "Verdict"], p.evals.filter((e) => e.kind === k.kind).map((e) => [`\`${e.id}\``, plain(e.claim), e.decider, e.verdict === "not_run" ? "not run" : e.verdict])),
  ])),
  ...section("Refusals", table(["Code", "When", "What the caller reads", "Exit"],
    p.refusals.map((r) => [link(p.id, r.error), plain([r.given, r.when].filter((s) => s !== "").join(" ")), plain(r.message), r.exit]))),
  ...section("Notes", bullets(p.notes.map(plain))),
  ...section("Common mistakes", p.mistakes.map((m) => `- ${plain(m.what)}: ${plain(m.fix)}`)),
  ...section("Waiting for an answer", briefs(p.id, p.waiting)),
  ...section("What the book still lacks here", findings(p.gaps)),
  ...section("Used by", groups(p.id, p.usedBy)),
  ...section("Decisions that name it", briefs(p.id, p.decisions)),
  ...section("If this changes", impact(p.id, p.impact)),
];

export const record = (p: RecordPage): readonly string[] => [
  `Kind: ${p.kind}${p.concept ? `. Concept: ${link(p.id, p.concept)}` : ""}`, "",
  ...(p.about === "" ? [] : [plain(p.about), ""]),
  ...(p.waits ? [`This decision waits for an answer: ${link(p.id, p.waits)}`, ""] : []),
  ...section("Fields", value(p.id, { t: "map", entries: p.fields })),
  ...p.children.flatMap((c) => [
    `## ${c.kind} ${plain(c.name)}`, "", ...value(p.id, c.value), "",
    ...(c.linkedBy.length === 0 ? [] : ["Linked by:", "", ...groups(p.id, c.linkedBy), ""]), ...evals(c.evals), ...findings(c.gaps), "",
  ]),
  ...section("Links out", groups(p.id, p.linksOut)),
  ...section("Linked by", groups(p.id, p.linkedBy)),
  ...section("Evals", evals(p.evals)),
  ...section("What the book still lacks here", findings(p.gaps)),
  ...section("Decisions that name it", briefs(p.id, p.decisions)),
  ...section("If this changes", impact(p.id, p.impact)),
];
