import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { alertIds, type AlertId, type Command, type Fixture } from "./fixture.ts";

export interface Alert {
  id: AlertId;
  active: boolean;
  reason: string;
  observedAt: string;
  head?: number | null;
  chainHead?: number | null;
  lastAdvanceAt?: string | null;
  oldestDueAt?: string | null;
  pending?: number;
  events?: { event_key: string; seq?: number; kind?: string; reason?: string; last_error?: string | null }[];
}
export interface Observation { observedAt: string; alerts: Alert[] }
export type Emit = (name: string, check: () => Promise<void>) => Promise<boolean>;

/** Validate freshness before interpreting any boolean as healthy. Host time is independent of the world's frozen clock. */
export function observation(value: unknown, now = Date.now()): Observation {
  const data = value as Observation;
  const at = Date.parse(data?.observedAt);
  assert(Number.isFinite(at) && now - at <= 15000 && at <= now + 2000, "alert observation is missing, stale or from the future");
  assert(Array.isArray(data.alerts), "missing alert diagnostics");
  for (const id of alertIds) {
    const rows = data.alerts.filter((a) => a.id === id);
    assert.equal(rows.length, 1, `expected exactly one diagnostic for ${id}`);
    assert.equal(typeof rows[0]!.active, "boolean", `${id} has no active state`);
    assert.equal(typeof rows[0]!.reason, "string", `${id} has no reason`);
    const a = rows[0]!;
    const observed = Date.parse(a.observedAt);
    assert(Number.isFinite(observed) && now - observed <= 15000 && observed <= now + 2000, `${id} has stale/missing source diagnostics`);
    if (a.active) assert(a.reason.trim(), `${id} fired without a reason`);
    if (id === "indexer_unready") {
      assert(a.head === null || Number.isSafeInteger(a.head) && a.head! >= 0, "missing/invalid indexed head");
      assert(a.chainHead === null || Number.isSafeInteger(a.chainHead) && a.chainHead! >= 0, "missing/invalid chain head");
      if (a.head === null || a.chainHead === null) assert(a.active, "missing index observations were reported healthy");
      else {
        if (a.head! > a.chainHead!) assert(a.active, "index head beyond the chain was reported healthy");
        assert(a.lastAdvanceAt && Number.isFinite(Date.parse(a.lastAdvanceAt)), "missing index freshness");
        assert(Date.parse(a.lastAdvanceAt!) <= observed + 2000, "index freshness is from the future");
        if (a.head! < a.chainHead! && observed - Date.parse(a.lastAdvanceAt!) > 60000)
          assert(a.active, "stale lagging index was reported healthy");
      }
    } else {
      assert(Array.isArray(a.events), `${id} is missing its source event list`);
      assert(new Set(a.events.map((e) => e.event_key)).size === a.events.length && a.events.every((e) => e.event_key), "missing/duplicate event keys");
      if (id === "delivery_stuck") {
        assert(Number.isInteger(a.pending) && a.pending! >= 0, "missing pending count");
        assert(a.events.length <= a.pending!, "delivery event list exceeds pending count");
        const due = a.oldestDueAt === null ? null : Date.parse(a.oldestDueAt!);
        assert(due === null || Number.isFinite(due), "missing oldest due time");
        assert(a.pending === 0 || due !== null, "pending delivery has no due time");
        assert(a.pending !== 0 || due === null, "empty delivery queue has an oldest due event");
        assert.equal(a.active, a.pending! > 0 && due !== null && observed - due > 300000, "delivery alert disagrees with due age");
      } else {
        assert(a.events.every((e) => e.kind && e.reason), "parked money event lost its kind/reason");
        assert.equal(a.active, a.events.length > 0, "parked-money alert disagrees with its events");
      }
    }
  }
  assert(data.alerts.every((a) => alertIds.includes(a.id)), "unknown alert must not silently disappear from the acceptance gate");
  return data;
}

export async function readAlerts(f: Fixture): Promise<Observation> {
  const secret = process.env["SKELETON_SECRET"];
  assert(secret, "SKELETON_SECRET is required for authenticated operator diagnostics");
  const body = JSON.stringify({ slug: f.slug });
  const res = await fetch(new URL("/admin/alerts", f.coreUrl), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Capxul-Signature": createHmac("sha256", secret).update(body).digest("hex") },
    body, signal: AbortSignal.timeout(10000),
  });
  assert(res.ok, `operator diagnostics returned HTTP ${res.status}`);
  return observation(await res.json());
}

/** Fixture commands are argv, never interpolated shell strings; their output may contain secrets and is not recorded. */
export async function command(argv: Command): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "ignore", env: process.env, timeout: 360000 });
    child.on("error", () => reject(new Error("fixture command could not start")));
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`fixture command failed (exit ${code}, signal ${signal})`)));
  });
}

export function quiet(data: Observation): void {
  assert.deepEqual(data.alerts.filter((a) => a.active).map((a) => a.id), [], "healthy/repaired world has an active alert");
}

export async function proveAlerts(f: Fixture, emit: Emit, keep: (stage: string, value: Observation) => void): Promise<void> {
  // Sample through actual read/replay work, not an idle process or a fabricated empty list.
  const healthy = await emit("ACCEPT.alerts-quiet-under-load", async () => {
    for (let i = 0; i < 3; i++) {
      await command(f.load);
      const data = await readAlerts(f); keep(`healthy-${i}`, data); quiet(data);
      await setTimeout(2000);
    }
  });
  if (!healthy) return; // Fault attribution is impossible in an already-broken world.
  for (const id of alertIds) {
    let fired = false;
    const seeded = await emit(`ACCEPT.${id}-fires`, async () => {
      try {
        await command(f.faults[id].seed);
        const deadline = Date.now() + 330000;
        for (;;) {
          const data = await readAlerts(f); keep(`${id}-seeded`, data);
          const active = data.alerts.filter((a) => a.active);
          if (active.some((a) => a.id === id)) {
            assert.deepEqual(active.map((a) => a.id), [id], "the seeded fault fired the wrong/additional alert");
            await setTimeout(2000);
            const again = await readAlerts(f); keep(`${id}-held`, again);
            assert.deepEqual(again.alerts.filter((a) => a.active).map((a) => a.id), [id], "fault did not remain observable as one operator alert");
            const keys = (o: Observation) => o.alerts.find((a) => a.id === id)!.events?.map((e) => e.event_key).sort();
            assert.deepEqual(keys(again), keys(data), "the alert changed event identity between observations");
            fired = true; break;
          }
          assert.equal(active.length, 0, "a different alert fired before the expected one");
          assert(Date.now() < deadline, `${id} did not fire within its threshold and observation allowance`);
          await setTimeout(1000);
        }
      } finally {
        // Repair also runs when seeding only partially succeeded or assertions fail.
        await command(f.faults[id].repair);
      }
    });
    const cleared = await emit(`ACCEPT.${id}-clears`, async () => {
      assert(fired, "cannot prove clearing without first observing the fault");
      const deadline = Date.now() + 60000;
      for (;;) {
        const data = await readAlerts(f); keep(`${id}-repaired`, data);
        if (data.alerts.every((a) => !a.active)) break;
        assert(Date.now() < deadline, "repaired world did not return to quiet");
        await setTimeout(1000);
      }
    });
    if (!seeded || !cleared) break;
  }
}
