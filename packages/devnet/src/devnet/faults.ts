import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resumeFaultStem } from "@capxul/backend/devnet";
import { bench, delivered, preparePayment, readFixture, settledPayment, submitPayment } from "./fixture.ts";
import { alive, command } from "./processes.ts";
import { httpReady, loopback, signedCore, stateFile, until, type Config, type Host } from "./supervisor.ts";
import type { composeWorld } from "./composition.ts";

const procStat = async (pid: number) => { const s = await readFile(`/proc/${pid}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" "); };

/**
 * `wfl:*\/resume` fault mount. `resume-arm` arms one consumer's next effect; `resume-kill` waits until Core reports it
 * holds that effect uncommitted and unacknowledged, SIGKILLs the Core process, then lets supervision restart it paused
 * and resumes it through the same signed path as `world up`. The ACK and the effect die together; the restarted relay
 * must redeliver. `resume-disarm` withdraws an arm no delivery has claimed, for a drive that failed after arming; a claimed
 * arm is refused, because only resume-kill can end it. A fault whose holding Core already died is cleared by either command and
 * reported as `abandoned`, with the event it held. Evidence is returned and kept under the private fault directory;
 * nothing here judges the claim.
 */
export async function resumeFault(c: Config, host: Pick<Host, "start">, action: string, consumer: string, timeout = 120_000,
  match: { event?: string; transition?: string } = {}) {
  const directory = join(c.controlDir, "faults"), stem = join(directory, resumeFaultStem(consumer));
  const exists = (suffix: string) => access(`${stem}.${suffix}`).then(() => true, () => false);
  // A fault whose holder already died (a crash, a manual restart) can never be killed: clear it and say so, never leave it for a manual rm.
  const abandoned = async () => {
    if (!await exists("reached")) return undefined;
    const reached = JSON.parse(await readFile(`${stem}.reached`, "utf8"));
    if (await access(`/proc/${reached.pid}`).then(() => true, () => false)) return undefined;
    await rm(`${stem}.reached`, { force: true }); await rm(`${stem}.claimed`, { force: true });
    return { consumer, eventId: reached.eventId, event: reached.event, transition: reached.transition, state: "abandoned" as const };
  };
  if (action === "resume-arm") {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const suffix of ["armed", "claimed", "reached"]) if (await exists(suffix)) throw new Error("this consumer already has an armed or unresolved resume fault");
    await writeFile(`${stem}.armed`, JSON.stringify({ consumer, ...match, armedAt: Date.now() }), { flag: "wx", mode: 0o600 });
    return { consumer, ...match, state: "armed" };
  }
  if (action === "resume-disarm") {
    // The same atomic rename Core uses to claim: exactly one of the two takes the arm.
    try { await rename(`${stem}.armed`, `${stem}.disarming`); }
    catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      const lost = await abandoned();
      if (lost) return lost;
      if (await exists("claimed") || await exists("reached")) throw new Error("a delivery claimed this arm; run resume-kill to finish the fault");
      return { consumer, state: "none" };
    }
    await rm(`${stem}.disarming`);
    return { consumer, state: "disarmed" };
  }
  try { await until("consumer reached its resume fault point", () => exists("reached"), timeout); }
  catch (error) { await rm(`${stem}.armed`, { force: true }); throw error; }
  const lost = await abandoned();
  if (lost) return lost;
  const reached = JSON.parse(await readFile(`${stem}.reached`, "utf8"));
  const before = JSON.parse(await readFile(stateFile(c, "core"), "utf8"));
  if (reached.consumer !== consumer || before.state !== "running" || Number((await procStat(reached.pid))[1]) !== before.pid) {
    throw new Error("the process holding the fault is not this world's supervised Core");
  }
  process.kill(reached.pid, "SIGKILL");
  const killedAt = Date.now();
  // Supervision restarts the wrapper, whose Core starts paused; start() only waits for and re-pauses a live one.
  await until("supervised Core restart", async () => {
    try { const now = JSON.parse(await readFile(stateFile(c, "core"), "utf8")); return now.pid !== before.pid && await alive(stateFile(c, "core")); }
    catch { return false; }
  }, timeout);
  await host.start("core");
  await signedCore(c, "/admin/snapshot/resume");
  await until("Core /ready after resume fault", () => httpReady(`${loopback(c.ports.core)}/ready`), timeout);
  const after = JSON.parse(await readFile(stateFile(c, "core"), "utf8"));
  const result = { consumer, eventId: reached.eventId, event: reached.event, transition: reached.transition, reachedAt: reached.at, killed: { pid: reached.pid, signal: "SIGKILL", at: killedAt },
    restarted: { pid: after.pid, birth: after.birth, codeVersion: after.codeVersion, readyAt: Date.now() } };
  await writeFile(`${stem}-${killedAt}.done.json`, JSON.stringify(result), { flag: "wx", mode: 0o600 });
  await rm(`${stem}.reached`); await rm(`${stem}.claimed`);
  return result;
}

/** These commands are private, reversible fixtures for the selected disposable world only. */
export async function fixtureOperation(stack: Awaited<ReturnType<typeof composeWorld>>, action: string, id: string, match: { event?: string; transition?: string } = {}) {
  const { c, host } = stack;
  if (c.world.kind !== "local" || c.world.id === "main") throw new Error("fault commands require a disposable local world");
  if (action === "resume-arm" || action === "resume-kill" || action === "resume-disarm") return resumeFault(c, host, action, id, 120_000, match);
  const f = await readFixture(c);
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
