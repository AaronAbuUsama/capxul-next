/**
 * The eval catalogue: `eval` lists the four levels and the kinds at each with their counts, and `eval/<kind>` lists
 * every eval of one kind beside the record it is about. Every count is the length of a list the blueprint derives.
 */
import { verdictOf, type EvalDef } from "@capxul/blueprint-engine";

import type { CataloguePage, Ref, TableRow, TableSection } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { LEVELS, evalKind, inOrder, kindOf } from "./evalKinds.ts";
import { refOf } from "./locate.ts";
import { code, row, tableOf, to, toOr, words } from "./table.ts";
import { count, group, plural, text } from "./values.ts";

export const EVALS: Ref = { label: "Evals", page: "eval", anchor: "" };
const SOURCE = "blueprint and docs/spec/30-capxul-evals.md";
const VERDICT_WORDS = { pass: "pass", fail: "fail", not_run: "not run" } as const;
const kindRef = (kind: string): Ref => ({ label: kind, page: `eval/${kind}`, anchor: "" });

/** One level: its kinds in the spec's order, each with what it claims and how many evals the blueprint derives. */
const level = (held: ReadonlyMap<string, readonly EvalDef[]>, l: (typeof LEVELS)[number]): TableSection => {
  const kinds = inOrder([...held].filter(([, evals]) => evals[0]?.level === l.level).map(([kind]) => kind));
  const total = kinds.reduce((n, kind) => n + (held.get(kind) ?? []).length, 0);
  return tableOf(l.level.toLowerCase(), l.title, ["Kind", "What it is called", "What it claims", "Evals"],
    kinds.map((kind) => {
      const info = evalKind(kind);
      return row([to(kindRef(kind)), words(info.name), words(info.claims), to({ ...kindRef(kind), label: count((held.get(kind) ?? []).length) })]);
    }),
    { caption: `${l.about} ${plural(total, "eval")}.`, empty: "The blueprint derives none yet." });
};

const evalRow = (ctx: Ctx, e: EvalDef): TableRow => {
  const subject = ctx.input.blueprint.records.get(e.subject);
  return row([code(e.id), toOr(subject ? refOf(subject) : null, e.subject), words(text(e.claim)), words(e.decider), words(VERDICT_WORDS[verdictOf(ctx.input.status, e.id)])]);
};

/** The catalogue's index, then one page per kind of eval the blueprint derives. */
export const evalCatalogue = (ctx: Ctx): readonly CataloguePage[] => {
  const all = ctx.input.blueprint.evals;
  const held = group(all, (e) => kindOf(e.id));
  const kinds = inOrder([...held.keys()]);
  return [
    {
      ...head("eval", "Evals", SOURCE, null), type: "catalogue", nav: "Build", eyebrow: "Evals",
      lead: "An eval is one claim about Capxul that a run can check. The blueprint derives every one from its records, so a complete record is also its definition of done. " +
        (ctx.input.status === null ? "None has run yet: no code exists." : "Each eval's verdict comes from the status document; one with no entry has not run."),
      crumbs: [{ label: "Build", page: "build", anchor: "" }],
      tiles: [
        { big: count(all.length), name: "evals", to: null },
        ...LEVELS.map((l) => ({
          big: count(all.filter((e) => e.level === l.level).length), name: l.title.toLowerCase(),
          to: { label: l.title, page: "eval", anchor: l.level.toLowerCase() },
        })),
        { big: count(all.filter((e) => verdictOf(ctx.input.status, e.id) !== "not_run").length), name: "run so far", to: null },
      ],
      sections: LEVELS.map((l) => level(held, l)),
    },
    ...kinds.map((kind): CataloguePage => {
      const info = evalKind(kind);
      const evals = held.get(kind) ?? [];
      return {
        ...head(`eval/${kind}`, `${info.name} evals`, SOURCE, null), type: "catalogue", nav: "Build", eyebrow: `Evals · ${evals[0]?.level ?? ""}`,
        lead: info.claims === "" ? `Every eval whose id starts with \`${kind}:\`.` : info.claims,
        crumbs: [{ label: "Build", page: "build", anchor: "" }, EVALS], tiles: [],
        sections: [tableOf("evals", `${plural(evals.length, "eval")} of kind ${kind}`, ["Eval", "About", "Claim", "Decided by", "Verdict"],
          evals.map((e) => evalRow(ctx, e)), { caption: `Each eval is beside the record it is about.${ctx.input.status === null ? " None has run." : " Its verdict is the status document's."}` })],
      };
    }),
  ];
};
