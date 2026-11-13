import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { selected } from "./door.ts";

type Stack = Awaited<ReturnType<typeof selected>>;
type Actor = { principalId: string; bearer: string; kind: "person" | "agent"; safe: string };
type Role = "ordinarySeat" | "books" | "outsider" | "person" | "agent";

/** Private bearer fixture is produced by receipt-first public sign-in, never by this runner. */
function actors(stack: Stack): Record<Role, Actor> {
  const path = process.env.CAPXUL_ACCESS_ACTORS;
  assert(path && (statSync(path).mode & 0o077) === 0, "private post-restore public bearer actors required");
  const value = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(value.version, 1);
  assert.deepEqual(value.run, { id: stack.receipt.id, at: stack.receipt.at, commit: stack.receipt.commit });
  assert.deepEqual(value.world, { id: stack.config.world.id, epoch: stack.config.world.epoch });
  for (const role of ["ordinarySeat", "books", "outsider", "person", "agent"] as const) {
    const actor = value.actors[role];
    assert(actor?.principalId && actor.bearer && actor.safe && ["person", "agent"].includes(actor.kind));
  }
  return value.actors;
}

export async function publicChecks(stack: Stack) {
  const people = actors(stack);
  const request = async (actor: Actor | null, input: unknown) => {
    const start = performance.now();
    const response = await fetch(new URL("/books/annotations/save", stack.fixture.coreUrl), {
      method: "POST", headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${actor.bearer}` } : {}) },
      body: JSON.stringify(input), signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    return { status: response.status, traceId: response.headers.get("x-capxul-trace"), body, elapsed: performance.now() - start };
  };
  const reference = { kind: "movement", id: `personal-check-${randomUUID()}` };
  const personal = { actor: { kind: "person" }, reference };
  const transitions: Record<string, unknown> = {};
  for (const [name, input, from, to] of [
    ["assign", { ...personal, account: "6100", suggest: "must not survive a decision" }, null, "decided"],
    ["recategorize", { ...personal, account: "6200" }, "decided", "decided"],
    ["requeue", { ...personal, account: "6999", suggest: "private suggestion", memo: "private memo" }, "decided", "waiting"],
    ["queue", { ...personal, reference: { ...reference, id: `${reference.id}-queue` }, memo: "private memo" }, null, "waiting"],
  ] as const) {
    const result = await request(people.person, input);
    assert.equal(result.status, 200, "public personal annotation must succeed");
    assert(result.traceId);
    const annotation = result.body.annotation;
    assert.equal(annotation.actor.id, people.person.principalId);
    assert.equal(annotation.lastEditor.id, people.person.principalId);
    // Read back as the person's own owner scope: the same RLS view the save itself wrote under.
    const persisted = await stack.db.ownerTransaction({ kind: "person", id: people.person.principalId }, async (sql) => {
      const rows = (await sql.query("select event from app.transition_outbox where event->>'trace_id'=$1", [result.traceId])).rows;
      assert.equal(rows.length, 1, "one committed save occurrence is exactly one common-outbox event");
      const event = rows[0]!.event;
      assert.deepEqual(event.props, { from, to, transition: name, owner_kind: "person", owner_id: people.person.principalId,
        reference_kind: input.reference.kind, reference_id: input.reference.id, account: annotation.account?.account ?? null });
      assert.equal(event.name, "book_annotation_transitioned"); assert.equal(event.machine, "book-annotation");
      assert.equal(event.actor, people.person.principalId);
      assert.deepEqual(JSON.parse(event.entity_id), ["person", people.person.principalId, input.reference.kind, input.reference.id]);
      const row = (await sql.query(`select * from app.book_annotations where owner_kind='person' and owner_id=$1
        and reference_kind=$2 and reference_id=$3`, [people.person.principalId, input.reference.kind, input.reference.id])).rows[0];
      assert(row); assert.equal(event.at, row.updated_at, "the event carries the save's own world time");
      assert.equal(annotation.updatedAt, row.updated_at); assert.equal(row.status, to); assert.equal(row.account, annotation.account?.account ?? null);
      assert.equal(row.suggestion, to === "decided" ? null : annotation.suggestion);
      assert.equal((await sql.query("select count(*)::int as n from app.book_facts")).rows[0]!.n, 0, "person context cannot expose Organization facts");
      return { event, row };
    });
    transitions[name] = { status: result.status, traceId: result.traceId, persisted };
  }
  stack.save("personal-transitions", transitions);
  return { people, request, transitions };
}

/** Declared refusals, compared by exact code. Separate so a missing authority cannot fail the transition checks. */
export async function errorChecks(stack: Stack, suite: Awaited<ReturnType<typeof publicChecks>>) {
  const { people, request } = suite;
  const reference = { kind: "movement", id: `personal-refusal-${randomUUID()}` };
  const personal = { actor: { kind: "person" }, reference };
  const errors = [];
  for (const [actor, input, expected] of [
    [null, personal, "NOT_AUTHENTICATED"],
    [people.person, { ...personal, category: "retired free text" }, "INVALID_INPUT"],
    [people.person, { ...personal, account: "9999" }, "INVALID_INPUT"],
    [people.person, { ...personal, actor: { kind: "person", id: people.outsider.principalId } }, "INVALID_INPUT"],
    [people.outsider, { ...personal, actor: { kind: "organization", orgId: stack.fixture.slug } }, "ROLE_PERMISSION_DENIED"],
    [people.ordinarySeat, { ...personal, actor: { kind: "organization", orgId: stack.fixture.slug }, memo: "needs Books" }, "ROLE_PERMISSION_DENIED"],
  ] as const) {
    const result = await request(actor, input);
    assert.equal(result.body.error?.code, expected); assert.notEqual(result.status, 200);
    errors.push({ expected, status: result.status, code: result.body.error.code });
  }
  stack.save("public-refusals", errors);
  return errors;
}

/** Real site work, on separate chain-proven money; never recategorize the retained acceptance payment. */
export async function vendorChecks(stack: Stack, suite: Awaited<ReturnType<typeof publicChecks>>) {
  const fact = await stack.db.transaction(stack.fixture.slug, async (sql) => (await sql.query(`select f.* from app.book_facts f
    where f.org_id=$1 and f.money_key is not null and f.tx_hash<>$2 and f.kind<>'reversed'
      and not exists(select 1 from app.book_facts r where r.org_id=f.org_id and r.reverses_fact_id=f.fact_id)
    order by f.seq limit 1`, [stack.fixture.slug, stack.fixture.txHash])).rows[0]);
  assert(fact, "vendor checks require separate real settled money, not a fabricated or original fixture row");
  const input = { actor: { kind: "organization", orgId: stack.fixture.slug },
    reference: { kind: fact.reference_kind, id: fact.reference_id }, account: stack.fixture.safeAccount };
  const measurements = [];
  // Warm-up is a real authorized native read/save, not a mocked provider or DB-only timing.
  assert.equal((await suite.request(suite.people.books, input)).status, 200);
  for (let i = 0; i < 20; i++) {
    const result = await suite.request(suite.people.ordinarySeat, input);
    assert.equal(result.status, 200); assert(result.traceId);
    assert.equal(result.body.annotation.account?.account, stack.fixture.safeAccount);
    measurements.push({ elapsed: result.elapsed, traceId: result.traceId, status: result.status });
  }
  const sorted = measurements.map((m) => m.elapsed).sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  assert(p95 <= 4000, "actual public native-validation latency p95 must meet the declared vendor budget");
  stack.save("vendor-budget", { measurements, p95 });
  return measurements;
}
