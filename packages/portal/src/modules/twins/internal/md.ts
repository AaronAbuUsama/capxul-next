/** The pieces every Markdown twin is made of: one-line text, links between twins, tables, lists. */
import { htmlFile, jsonFile, mdFile, relative } from "#src/modules/site/service.ts";
import type { Brief, Cell, EvalRow, FindingRow, ImpactBlock, LinkGroup, Ref, TableSection, Tile, Trace, Value, Variant } from "#src/modules/site/types.ts";

/** Text on one line. A `](` the book wrote is escaped, so the only links in a twin are the ones the site makes. */
export const plain = (s: string): string => s.replace(/\s+/g, " ").trim().replaceAll("](", "]\\(");

/** The link from the twin of page `at` to the twin of another page. A twin has no anchors, so the page is the target. */
export const link = (at: string, ref: Ref): string =>
  `[${plain(ref.label).replaceAll("[", "\\[").replaceAll("]", "\\]")}](${relative(mdFile(at), mdFile(ref.page))})`;

export const bullets = (items: readonly string[]): readonly string[] => items.map((i) => `- ${i}`);
export const briefs = (at: string, items: readonly Brief[]): readonly string[] =>
  items.map((b) => `- ${link(at, b.ref)}${b.text === "" ? "" : `: ${plain(b.text)}`}`);
export const refs = (at: string, items: readonly Ref[]): string => items.map((r) => link(at, r)).join(", ");
export const groups = (at: string, held: readonly LinkGroup[]): readonly string[] =>
  held.map((g) => `- **${plain(g.field)}**: ${refs(at, g.refs)}`);
export const findings = (rows: readonly FindingRow[]): readonly string[] =>
  rows.map((f) => `- \`${f.record}\` ${f.rule}: ${plain(f.detail)}`);

/** A table, or nothing when it has no rows. A `|` inside a cell is escaped. */
export const table = (heads: readonly string[], rows: readonly (readonly string[])[]): readonly string[] =>
  rows.length === 0 ? [] : [
    `| ${heads.join(" | ")} |`, `|${heads.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map((c) => c.replaceAll("|", "\\|")).join(" | ")} |`), "",
  ];

/** A heading and what is under it, or nothing when there is nothing under it. */
export const section = (title: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [] : [`## ${title}`, "", ...lines, ""];

export const evals = (rows: readonly EvalRow[]): readonly string[] =>
  table(["Eval", "Level", "Claim", "Decided by"], rows.map((e) => [`\`${e.id}\``, e.level, plain(e.claim), e.decider]));

/** "If this changes": the counts, then every record that depends on this one, nearest first. */
export const impact = (at: string, b: ImpactBlock): readonly string[] =>
  b.total === 0 ? ["Nothing depends on this record.", ""] : [
    `${b.total} records depend on it: ${b.byKind.map((k) => `${k.kind} ${k.count}`).join(", ")}. ` +
      `${b.decisions} decisions name it; ${b.decisionsOnDependents} name something that depends on it. ${b.evals} evals belong to it or to them.`, "",
    ...(b.complete ? [] : ["This list is cut to the nearest 500, or for a decision to the records it names; `packages/book/scripts/impact.ts` lists everything that depends on them.", ""]),
    ...table(["Record", "Kind", "Field", "Names", "Distance"], b.all.map((d) => [link(at, d.ref), d.kind, `\`${d.field}\``, link(at, d.via), String(d.distance)])),
  ];

/** A fenced block of code, with its language. */
export const fence = (language: string, code: string): readonly string[] => ["```" + language, ...code.split("\n"), "```", ""];

/** A schema's shapes as field tables; with `skeleton`, each is followed by the same shape as a JSON skeleton. */
export const variants = (held: readonly Variant[], skeleton = false): readonly string[] =>
  held.flatMap((v) => [
    ...(v.label === "" ? [] : [`**${plain(v.label)}**`, ""]),
    ...table(["Field", "Type", "Required", "Note"], v.rows.map((r) => [`\`${r.path}\``, plain(r.type), r.required ? "yes" : "no", plain(r.note)])),
    ...(skeleton ? ["Generated from the schema, not a recorded response:", "", ...fence("json", v.skeleton)] : []),
  ]);

const cell = (at: string, c: Cell): string => {
  switch (c.t) {
    case "text": return plain(c.text);
    case "code": return c.text === "" ? "" : `\`${c.text}\``;
    case "ref": return link(at, c.ref) + (c.sub === "" ? "" : ` ${plain(c.sub)}`);
    case "refs": return refs(at, c.refs);
    case "stand": return c.stand.stand;
  }
};

/** A titled table as a page model holds it. A group's name is a row of its own; an empty table says its words. */
export const tableSection = (at: string, s: TableSection): readonly string[] => [
  `## ${plain(s.title)}`, "", ...(s.caption === "" ? [] : [plain(s.caption), ""]),
  ...(s.rows.length === 0 ? [plain(s.empty), ""] : table(s.heads, s.rows.flatMap((r, i) => [
    ...(r.group !== "" && r.group !== s.rows[i - 1]?.group ? [[`**${plain(r.group)}**`, ...s.heads.slice(1).map(() => "")]] : []),
    r.cells.map((c) => cell(at, c)),
  ]))),
];

export const tiles = (at: string, held: readonly Tile[]): readonly string[] =>
  held.map((t) => `- ${t.big} ${t.to ? `[${plain(t.name)}](${relative(mdFile(at), mdFile(t.to.page))})` : plain(t.name)}`);

const or = (at: string, held: readonly Ref[]): string => (held.length === 0 ? "the book names none" : refs(at, held));

/** The events a run sends and the spans it names, from the whole implementation. */
const telemetry = (at: string, t: Trace): readonly string[] => [
  `Events it sends: ${t.sends.length === 0 ? "the book names none" : t.sends.map((e) =>
    `${link(at, e.event)} through ${e.transition ? link(at, e.transition) : "the record itself"} (driven by ${link(at, e.by)})`).join("; ")}.`, "",
  `Spans it names: ${t.named.length === 0 ? "the book names none" : t.named.map((s) => `\`${s.span}\` (${link(at, s.by)})`).join(", ")}.`, "",
];

/** What happens when an operation runs: each step, and under an rpc step what the book lists for it. */
export const trace = (at: string, t: Trace): readonly string[] =>
  !t.by ? ["The book names nothing that implements this operation, so there is no run to trace.", ""] : [
    `Implemented by the ${t.kind} ${link(at, t.by)}.` + (t.kind === "flow"
      ? ` Outside calls the client makes itself: ${or(at, t.calls)}. Spans the flow names: ${t.spans.length === 0 ? "the book names none" : t.spans.join(", ")}.` : ""), "",
    ...telemetry(at, t),
    ...t.steps.flatMap((s, i) => [
      `${i + 1}. **${plain(s.name)}** (${s.rpc ? `rpc ${link(at, s.rpc)}` : `the SDK: ${s.does}`})${s.about === "" ? "" : `: ${plain(s.about)}`}`,
      ...(s.rpc ? [
        `   - Contract calls: ${or(at, s.chain)}`, `   - Outside calls: ${or(at, s.calls)}`, `   - Procedures: ${or(at, s.invokes)}`,
        `   - Transitions: ${or(at, s.drives)}`, `   - Events it sends: ${or(at, s.events)}`, `   - Tables it writes: ${or(at, s.writes)}`,
        `   - Spans: ${s.spans.length === 0 ? "the book names none" : s.spans.join(", ")}`,
      ] : ["   - The SDK does this itself. The book lists nothing under it."]),
    ]), "",
  ];

const nest = (lead: string, lines: readonly string[]): readonly string[] =>
  lines.length <= 1 ? [`- ${lead}${lines[0] ?? ""}`] : [`- ${lead}`, ...lines.map((l) => `  ${l}`)];

/** Any value a record holds, as Markdown lines: text, a link, a nested list, or a schema's field table. */
export const value = (at: string, v: Value): readonly string[] => {
  switch (v.t) {
    case "text": return [plain(v.text)];
    case "ref": return [link(at, v.ref)];
    case "list": return v.items.flatMap((item) => nest("", value(at, item)));
    case "map": return v.entries.flatMap(([key, item]) => nest(`**${plain(key)}**: `, value(at, item)));
    case "schema": return variants(v.variants);
  }
};

/** One whole twin: the title, where it was generated from, its two siblings, then the body. */
export const doc = (at: string, title: string, source: string, body: readonly string[]): string => {
  const siblings = `This page as [HTML](${relative(mdFile(at), htmlFile(at))}) or [JSON](${relative(mdFile(at), jsonFile(at))}).`;
  const text = [`# ${plain(title)}`, "", `Generated from \`${source}\`. ${siblings}`, "", ...body]
    .map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return `${text}\n`;
};
