import assert from "node:assert/strict";
import { selected, runChecks } from "./door.ts";
import { readFileSync } from "node:fs";
import { appendOnly, committedProperty, committedWorld, rolledBack } from "./invariants.ts";
import { atomic, sideOf } from "./procedures.ts";
import { errorChecks, publicChecks, vendorChecks } from "./public.ts";
import { assertSchema } from "./schema.ts";
import { assertWriters } from "./source.ts";
import { tenancy } from "./tenancy.ts";

const tables = ["book_annotations", "book_facts", "book_feeds"] as const;
const transitions = ["assign", "queue", "recategorize", "requeue"] as const;
const checks = ["BOOKS.selected-stack", "BOOKS.record-atomic", "BOOKS.reverse-atomic",
  ...tables.flatMap((table) => ["schema", "tenancy", "writers"].map((kind) => `BOOKS.${table}-${kind}`)),
  ...transitions.map((transition) => `BOOKS.${transition}`), "BOOKS.rpc-budget", "BOOKS.rpc-errors", "BOOKS.rpc-spans",
  "BOOKS.facts-append-only", "BOOKS.committed-world", "BOOKS.rollback-interleavings",
  "BOOKS.committed-feed-gap-free", "BOOKS.committed-one-live-money-fact"];

if (process.argv.includes("--list")) {
  for (const check of checks) console.log(`${check}\tcheck`);
} else await runChecks(checks, async (emit) => {
  const stack = await selected(process.argv[2] ?? "", "books");
  try {
    await emit("BOOKS.selected-stack", async () => {});
    for (const table of tables) {
      await emit(`BOOKS.${table}-schema`, async () => stack.save(`${table}-schema`, await stack.db.transaction(stack.fixture.slug,
        (sql) => assertSchema(sql, table))));
      await emit(`BOOKS.${table}-tenancy`, async () => stack.save(`${table}-tenancy`, await tenancy(stack.db, table, stack.fixture.slug)));
      await emit(`BOOKS.${table}-writers`, async () => {
        const source = assertWriters("books", table);
        assert(source.writers.length, "a runtime writer must exist, not just its empty schema");
        if (table === "book_facts") {
          await assert.rejects(stack.db.transaction(stack.fixture.slug, (sql) => sql.query("update app.book_facts set amount_raw='1' where org_id=$1", [stack.fixture.slug])),
            (error: { code?: string }) => error.code === "42501");
          await assert.rejects(stack.db.transaction(stack.fixture.slug, (sql) => sql.query("delete from app.book_facts where org_id=$1", [stack.fixture.slug])),
            (error: { code?: string }) => error.code === "42501");
        }
        stack.save(`${table}-writers`, source);
      });
    }
    let atomicProof: Promise<unknown> | undefined;
    for (const kind of ["record", "reverse"]) await emit(`BOOKS.${kind}-atomic`, async () => {
      const { worldNow } = await import("../../../../backend/src/devnet/door.ts");
      const at = await stack.db.transaction(stack.fixture.slug, worldNow);
      atomicProof ??= atomic(stack.db, stack.fixture.slug, stack.fixture.txHash, stack.fixture.amountAtomic, at);
      stack.save("atomic", await atomicProof);
    });
    let suite: ReturnType<typeof publicChecks> | undefined;
    const publicSuite = () => suite ??= publicChecks(stack);
    for (const transition of transitions) await emit(`BOOKS.${transition}`, async () => {
      assert((await publicSuite()).transitions[transition], "persisted exact transition is required");
    });
    await emit("BOOKS.rpc-errors", async () => { assert.equal((await errorChecks(stack, await publicSuite())).length, 6); });
    let vendor: Awaited<ReturnType<typeof vendorChecks>> | undefined;
    await emit("BOOKS.rpc-budget", async () => { vendor = await vendorChecks(stack, await publicSuite()); });
    await emit("BOOKS.rpc-spans", async () => {
      assert(vendor?.length, "native public calls must exist before a span claim");
      const { readSpans } = await import("../../../../backend/src/platform/spans.ts");
      const saved = [];
      for (const sample of vendor) {
        const spans = await readSpans(stack.db.worker, { runId: stack.receipt.id, worldId: stack.config.world.id, traceId: sample.traceId });
        const rpc = spans.find((s) => s.name === "rpc.books.annotations.save");
        assert(rpc && rpc.outcome === "success" && rpc.endedAt >= rpc.startedAt);
        assert(spans.some((s) => s.parentSpanId === rpc.spanId), "actual native provider child span required");
        saved.push(spans);
      }
      stack.save("spans", saved);
    });
    // The books invariants (#139). The live world and rolled-back interleavings are controls; the committed proof
    // runs concurrent writers on a throwaway Organization the run founded through the public setup.
    const settled = async () => {
      const { worldNow } = await import("../../../../backend/src/devnet/door.ts");
      const at = await stack.db.transaction(stack.fixture.slug, worldNow);
      const fact = (await stack.db.transaction(stack.fixture.slug, (sql) => sql.query(`select * from app.book_facts where org_id=$1
        and tx_hash=$2 and kind='payment_settled' order by seq limit 1`, [stack.fixture.slug, stack.fixture.txHash]))).rows[0];
      assert(fact, "the run's settlement fact templates the invariant writers");
      return { at, fact, template: sideOf(stack.fixture.slug, fact, stack.fixture.amountAtomic) };
    };
    await emit("BOOKS.facts-append-only", async () => stack.save("facts-append-only", await appendOnly(stack.db, stack.fixture.slug)));
    await emit("BOOKS.committed-world", async () => stack.save("committed-world", await committedWorld(stack.db)));
    await emit("BOOKS.rollback-interleavings", async () => {
      const { at, fact, template } = await settled();
      stack.save("rollback-interleavings", await rolledBack(stack.db, stack.fixture.slug, fact.money_key, template, at, Date.parse(stack.receipt.at)));
    });
    let property: Promise<unknown> | undefined;
    for (const name of ["feed-gap-free", "one-live-money-fact"]) await emit(`BOOKS.committed-${name}`, async () => {
      property ??= (async () => {
        const raw = JSON.parse(readFileSync(process.env.CAPXUL_ACCEPTANCE_FIXTURE!, "utf8"));
        const org = raw.throwaway?.orgId;
        assert(typeof org === "string" && org && org !== stack.fixture.slug, "a throwaway Organization founded in this run is required");
        const { at, template } = await settled();
        return committedProperty(stack.db, org, template, at, Date.parse(stack.receipt.at));
      })();
      stack.save("committed-property", await property);
    });
  } finally { await stack.db.close(); }
});
