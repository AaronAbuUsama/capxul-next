import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import { birthAnnotation } from "./annotations.ts";
import { recordSide, withFeeds, type MoneySide } from "./facts.ts";

export { reverseMoneyFact, type MoneySide } from "./facts.ts";

/** Provisioning composition calls this on its existing admin transaction, never at runtime. */
export async function migrate(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** No connection checkout, transaction boundary, external I/O or accounting replica. */
export async function recordMoneyFact(sql: Sql, input: { sides: readonly MoneySide[] }, context: { at: number; traceId: string }) {
  const result = { recorded: [] as string[], unchanged: [] as string[], superseded: [] as string[] };
  await withFeeds(sql, input.sides.map((s) => s.org_id), context.at, async () => {
    for (const side of [...input.sides].sort((a, b) => a.org_id.localeCompare(b.org_id))) {
      const fact = await recordSide(sql, side, context.at);
      if (fact.unchanged) result.unchanged.push(fact.unchanged);
      if (fact.recorded) {
        result.recorded.push(fact.recorded);
        await birthAnnotation(sql, side, context);
      }
      if (fact.superseded) result.superseded.push(fact.superseded);
    }
  });
  return result;
}
