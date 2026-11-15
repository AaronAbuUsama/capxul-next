// Renders a thing's work no door serves (the format is ../language/work.ts) into its page: what each piece does, its
// payload, its spans in order with their kinds, its logs with their fields, and its budget, a target. Pure: render.ts
// places it.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { logsOf, spansOf, type Work } from "../language/work.ts";

const code = (text: string) => `\`${text}\``;
const codes = (items: ReadonlyArray<string>) => (items.length === 0 ? "none" : Arr.join(Arr.map(items, code), ", "));

const budget = (each: Work): string =>
  `${each.budget.ms.toLocaleString("en-GB")} ms, a target, ${each.budget.provisional ? "provisional" : "measured"}` +
  (each.budget.excludes.length > 0 ? `, excluding ${Arr.join(each.budget.excludes, " and ")}` : "") +
  `. Basis: ${each.budget.basis}.`;

const one = (each: Work): ReadonlyArray<string> => [
  `### ${code(each.name)}`,
  "",
  each.does,
  "",
  `- Payload: ${codes(Rec.keys(each.payload.fields))}.`,
  `- Spans: ${Arr.join(
    Arr.map(spansOf(each), (span) => `${code(span.name)} (${span.kind})`),
    " → ",
  )}.`,
  `- Logs: ${Arr.join(
    Arr.map(logsOf(each), (log) => `${code(log.name)} (${Arr.join(Rec.keys(log.schema.fields), ", ")})`),
    "; ",
  )}.`,
  `- Budget: ${budget(each)}`,
  ...(each.breakdown.length > 0
    ? [
        `- Its budget, broken down: ${Arr.join(
          Arr.map(each.breakdown, (share) => `${share.part} ${share.ms.toLocaleString("en-GB")} ms`),
          "; ",
        )}.`,
      ]
    : []),
  "",
];

/** The section of a thing's page that lists its work no door serves; nothing when it has none. */
export const workSection = (works: ReadonlyArray<Work>): ReadonlyArray<string> =>
  works.length === 0
    ? []
    : [
        "## Work no door serves",
        "",
        "The pipeline's own work (docs/design/blueprint.md, part 8): no Rpc group holds it, so nothing serves it at run",
        "time. Its spans and logs judge it once it is instrumented (roadmap item 4.7). Its budget is a target, never a gate.",
        "",
        ...Arr.flatMap(works, one),
      ];
