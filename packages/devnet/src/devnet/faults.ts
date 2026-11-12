import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bench, delivered, preparePayment, readFixture, settledPayment, submitPayment } from "./fixture.ts";
import { command } from "./processes.ts";
import { httpReady, loopback, signedCore, until } from "./supervisor.ts";
import type { composeWorld } from "./composition.ts";

/** These commands are private, reversible fixtures for the selected disposable world only. */
export async function fixtureOperation(stack: Awaited<ReturnType<typeof composeWorld>>, action: string, id: string) {
  const { c, host } = stack, f = await readFixture(c);
  if (c.world.kind !== "local" || c.world.id === "main") throw new Error("fault commands require a disposable local world");
  if (action === "load") {
    await stack.read(id);
    const replay = await signedCore(c, "/admin/resend", { slug: f.slug, from: 1 });
    assert(replay.events.length && replay.events.some((event: any) => event.kind === "payment_sent"), "replay must include the actual payment stream");
    assert(replay.events.every((event: any) => event.state === "pending" && event.applied_at === null), "resend did not establish a fresh replay baseline");
    await delivered(c, f, replay);
    await settledPayment(c, f);
    return;
  }
  if (!["seed", "repair"].includes(action)) throw new Error("expected fixture load|seed|repair");
  const repair = action === "repair";
  const compose = (...args: string[]) => command(["docker", "compose", ...c.bench.composeArgs, ...args], c.root);
  if (id === "indexer_unready") {
    await host[repair ? "start" : "stop"]("ponder");
    if (repair) await until("Core caught up after Ponder repair", () => httpReady(`${loopback(c.ports.core)}/ready`));
  } else if (id === "delivery_stuck") {
    if (repair) {
      await compose("up", "-d", "--wait", "frontend");
      await delivered(c, f);
    } else {
      // Real redelivery stays due while its actual HTTP ingress is down. No backdated metrics or fake event.
      await compose("stop", "frontend");
      await signedCore(c, "/admin/resend", { slug: f.slug, from: 1 });
      const unavailableAt = Date.now();
      await until("real unacknowledged delivery older than 300 seconds", async () => {
        const status = await signedCore(c, "/admin/alerts", { org: f.slug });
        return Date.now() - unavailableAt > 300_000 && status.alerts?.some((alert: any) => alert.id === "delivery_stuck" && alert.active) === true;
      }, 325_000);
    }
  } else if (id === "money_event_parked") {
    const file = join(c.controlDir, "parked-money.json");
    if (repair) {
      let parked: any;
      try { parked = JSON.parse(await readFile(file, "utf8")); } catch (e: any) { if (e.code === "ENOENT") return; throw e; }
      await bench(c, f.site, "frappe.db.set_value", ["Purchase Invoice", parked.invoice, "on_hold", 0]);
      if (parked.eventKey) await signedCore(c, "/admin/retry-parked", { org: f.slug, event_key: parked.eventKey });
      await delivered(c, f);
    } else {
      const extra = await preparePayment(c, f, 7.25);
      const parked = { invoice: extra.pi, eventKey: "" };
      await writeFile(file, JSON.stringify(parked), { mode: 0o600 });
      await bench(c, f.site, "frappe.db.set_value", ["Purchase Invoice", extra.pi, "on_hold", 1]);
      await submitPayment(c, f, extra.approval);
      await until("same real money event parked after ERPNext refused posting", async () => {
        const status = await signedCore(c, "/admin/status", { org: f.slug });
        const event = status.events.find((e: any) => e.kind === "payment_sent" && e.state === "parked");
        if (!event) return false;
        parked.eventKey = event.event_key;
        await writeFile(file, JSON.stringify(parked), { mode: 0o600 });
        return true;
      });
      assert(parked.eventKey);
    }
  } else throw new Error("unknown slice-zero fault");
}
