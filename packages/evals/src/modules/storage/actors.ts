import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import type { Sql } from "../../../../backend/src/platform/db.ts";
import { worldNow } from "../../../../backend/src/devnet/door.ts";
import type { SelectedWorld } from "./service.ts";

export type Role = "ordinarySeat" | "books" | "outsider" | "person" | "agent";
export type Actor = { principalId: string; bearer: string; kind: "person" | "agent"; safe: string };
// The real Access door, loaded by URL so evals' stricter compile does not traverse backend internals it does not own.
const { authenticate } = await import(new URL("../../../../backend/src/access/door.ts", import.meta.url).href) as {
  authenticate(sql: Sql, bearer: string, now: number): Promise<{ personId: string }>;
};

export type Actors = { companySafe: string | null; actors: Record<Role, Actor> };

/** Runtime's post-restore public sign-in fixture (CAPXUL_ACCESS_ACTORS). This runner never creates sessions. */
export function readActors(world: SelectedWorld): Actors {
  const path = process.env.CAPXUL_ACCESS_ACTORS;
  assert(path && (statSync(path).mode & 0o077) === 0, "private post-restore public bearer actors required");
  const value = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(value.version, 1);
  assert.deepEqual(value.run, world.run);
  assert.equal(value.world?.id, world.world.id); assert.equal(value.world?.epoch, world.world.epoch);
  for (const role of ["ordinarySeat", "books", "outsider", "person", "agent"] as const) {
    const actor = value.actors?.[role];
    assert(typeof actor?.principalId === "string" && typeof actor.bearer === "string" && /^0x[0-9a-f]{40}$/.test(actor.safe) &&
      ["person", "agent"].includes(actor.kind), `actor ${role}`);
  }
  return { companySafe: typeof value.world.companySafe === "string" ? value.world.companySafe : null, actors: value.actors };
}

/** One restricted capxul_core transaction whose only identity is what Access.authenticate resolves from the bearer. */
export async function asActor<T>(world: SelectedWorld, actor: Actor | null, run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = await world.db.tenant.connect();
  try {
    await sql.query("begin");
    try {
      if (actor) {
        const principal = await authenticate(sql, actor.bearer, await worldNow(sql));
        assert.equal(principal.personId, actor.principalId);
      }
      return await run(sql);
    } finally { await sql.query("rollback"); }
  } finally { sql.release(); }
}

/** A direct write a session attempts must be refused by Postgres, not merely match no row. */
export async function refused(sql: Sql, query: string, params: unknown[] = []) {
  await sql.query("savepoint attempt");
  try { await assert.rejects(sql.query(query, params), /permission denied/); }
  finally { await sql.query("rollback to savepoint attempt"); }
}

export async function post(world: SelectedWorld, path: string, body: unknown, actor: Actor | null) {
  const response = await fetch(new URL(path, world.coreUrl), {
    method: "POST", headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${actor.bearer}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() as any };
}
