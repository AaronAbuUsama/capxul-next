import assert from "node:assert/strict";
import { assertSchema, assertWriters, runChecks, selected, tenancy } from "../books/door.ts";

const checks = ["BUDGETS.selected-stack", "BUDGETS.schema", "BUDGETS.tenancy", "BUDGETS.writers"];
if (process.argv.includes("--list")) {
  for (const check of checks) console.log(`${check}\tcheck`);
} else await runChecks(checks, async (emit) => {
  const stack = await selected(process.argv[2] ?? "", "budgets");
  try {
    await emit("BUDGETS.selected-stack", async () => {});
    await emit("BUDGETS.schema", async () => stack.save("schema", await stack.db.transaction(stack.fixture.slug, (sql) => assertSchema(sql, "budgets"))));
    await emit("BUDGETS.tenancy", async () => stack.save("tenancy", await tenancy(stack.db, "budgets", stack.fixture.slug)));
    await emit("BUDGETS.writers", async () => {
      const source = assertWriters("budgets", "budgets");
      assert(source.writers.length, "metadata needs a real declared budget writer, not an empty schema");
      const rows = await stack.db.transaction(stack.fixture.slug, async (sql) => (await sql.query("select * from app.budgets where org_id=$1", [stack.fixture.slug])).rows);
      assert(rows.length, "real public budget preparation must persist its metadata");
      stack.save("writers", { source, rows });
    });
  } finally { await stack.db.close(); }
});
