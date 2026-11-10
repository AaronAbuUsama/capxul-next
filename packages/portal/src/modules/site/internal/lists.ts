/** Build: every operation with its evals and its stand, first by where it stands, then by concept. */
import type { BuildPage, OperationRow, Stand } from "../types.ts";
import { head, membersOf, ofKind, operationRow, titleOf, type Ctx } from "./context.ts";
import { EVALS } from "./evalCatalogue.ts";
import { refOf } from "./locate.ts";
import { count } from "./values.ts";

const STANDS: readonly (readonly [Stand, string, string])[] = [
  ["specify", "Still to specify", "still to specify"], ["decide", "Waiting on a decision", "wait on a decision"],
  ["build", "Ready to build", "ready to build"],
];

export const build = (ctx: Ctx): BuildPage => {
  const rows = ofKind(ctx, "operation").map((op) => operationRow(ctx, op));
  const at = (stand: Stand): readonly OperationRow[] => rows.filter((r) => r.stand.stand === stand);
  const here = (anchor: string): { label: string; page: string; anchor: string } => ({ label: anchor, page: "build", anchor });
  const byStand = STANDS.map(([stand, title]) => ({ stand, title, anchor: `stand-${stand}`, rows: at(stand) }));
  const concepts = ctx.input.concepts.flatMap((id) => {
    const c = ctx.input.book.records.get(`concept:${id}`);
    const own = membersOf(ctx, id, "operation").map((op) => operationRow(ctx, op));
    return c && own.length > 0 ? [{ ref: refOf(c), title: titleOf(c), rows: own }] : [];
  });
  return {
    ...head("build", "Build", "books/target", null), type: "build", operations: rows.length, evals: ctx.input.book.evals.length,
    stands: { specify: at("specify").length, decide: at("decide").length, build: at("build").length },
    tiles: [
      { big: count(rows.length), name: "operations", to: concepts.length > 0 ? here("by-concept") : null },
      ...STANDS.map(([stand, , name]) => ({ big: count(at(stand).length), name, to: at(stand).length > 0 ? here(`stand-${stand}`) : null })),
      { big: `0 of ${count(ctx.input.book.evals.length)}`, name: "evals passing", to: EVALS },
    ],
    byStand, concepts,
  };
};
