// The outbox: every event Core owes a Frappe site, persisted in state/outbox.json.
// Core assigns each org's gap-free seq at enqueue time and resends, in order, until Frappe answers applied.
// Delivery is at-least-once; Frappe's event_key makes it effectively once.
import { readFileSync } from "node:fs";
import { config } from "./config.ts";
import { siteOf } from "./world.ts";
import { sign } from "./hmac.ts";
import { loadJson, saveJson } from "./store.ts";

export type Kind = "hat_granted" | "hat_revoked" | "payment_sent" | "payment_failed" | "founder_capital";
export type OutEvent = {
  seq: number; event_key: string; kind: Kind; data: Record<string, unknown>;
  applied: boolean; attempts: number; lastError?: string; lastAttemptAt?: string;
};
export type OrgRecord = {
  slug: string; hash: string; name?: string; safe?: string; adminEmail?: string;
  released: boolean;       // false until the site exists: events queue up but are not sent
  nextSeq: number; events: OutEvent[]; retryAt: number; failures: number;
};
type File = { orgs: Record<string, OrgRecord> };

const log = (m: string) => console.log(`${new Date().toISOString()} [outbox] ${m}`);
let state: File = loadJson<File>("outbox.json", { orgs: {} });
const save = () => saveJson("outbox.json", state);

export const orgs = (): OrgRecord[] => Object.values(state.orgs);
export const getOrg = (slug: string): OrgRecord | undefined => state.orgs[slug];
export const orgByHash = (hash: string): OrgRecord | undefined =>
  orgs().find((o) => o.hash.toLowerCase() === hash.toLowerCase());

export function ensureOrg(slug: string, hash: string, patch: Partial<OrgRecord> = {}): OrgRecord {
  const o = state.orgs[slug] ?? (state.orgs[slug] = { slug, hash, released: false, nextSeq: 1, events: [], retryAt: 0, failures: 0 });
  Object.assign(o, patch);
  save();
  return o;
}

// Idempotent on event_key: a log re-read after a crash does not get a second seq.
export function enqueue(slug: string, event_key: string, kind: Kind, data: Record<string, unknown>): OutEvent {
  const o = state.orgs[slug];
  if (!o) throw new Error(`enqueue for unknown org ${slug}`);
  const existing = o.events.find((e) => e.event_key === event_key);
  if (existing) return existing;
  const ev: OutEvent = { seq: o.nextSeq++, event_key, kind, data, applied: false, attempts: 0 };
  o.events.push(ev);
  save();
  log(`${slug} seq ${ev.seq} ${kind} queued (${event_key})`);
  return ev;
}

// Releasing is "a site now exists for this org". The site may be a NEW one for an org Core already delivered to
// (the site was dropped and org create ran again), so everything is offered again from seq 1: Frappe answers
// "already applied" to what it has and applies the rest. (Found in the end-to-end run.)
export const release = (slug: string): void => {
  const o = ensureOrg(slug, "", { released: true, retryAt: 0, failures: 0 });
  for (const e of o.events) e.applied = false;
  save();
};
// Test seam (end to end): offer one already-applied event again, to prove a repeat posts nothing twice.
export const redeliver = (slug: string, seq: number): boolean => {
  const ev = state.orgs[slug]?.events.find((e) => e.seq === seq);
  if (!ev) return false;
  ev.applied = false; state.orgs[slug]!.retryAt = 0; save();
  return true;
};
export const resend = (slug: string): void => {
  const o = state.orgs[slug];
  if (o) { o.retryAt = 0; o.failures = 0; save(); }
};

// The trace id a command filed with the hash of a transaction it sent (chain.ts), so the event that transaction causes carries it to the site.
function traceOf(tx: unknown): string {
  if (typeof tx !== "string") return "";
  try {
    const hit = readFileSync(`${config.stateDir}/tx-trace.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse().find((r) => r.tx === tx);
    return hit?.trace ?? "";
  } catch { return ""; }
}
type Answer = { status: number; body: any };
async function post(o: OrgRecord, ev: OutEvent): Promise<Answer> {
  const body = JSON.stringify({ event_key: ev.event_key, seq: ev.seq, org: o.slug, kind: ev.kind, data: ev.data });
  const res = await fetch(`${config.frappeUrl}/api/method/capxul.api.chain_event`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-capxul-signature": sign(body), "x-frappe-site-name": siteOf(o.slug), "x-capxul-trace": traceOf(ev.data.tx_hash) },
    body, signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let parsed: any = undefined;
  try { parsed = JSON.parse(text); } catch { /* keep raw text for the error */ }
  return { status: res.status, body: parsed ?? { raw: text.slice(0, 300) } };
}

const fail = (o: OrgRecord, ev: OutEvent | undefined, msg: string) => {
  if (ev) ev.lastError = msg;
  o.failures++;
  o.retryAt = Date.now() + Math.min(config.retryMaxMs, config.retryMinMs * 2 ** Math.min(o.failures - 1, 6));
  save();
  log(`${o.slug} seq ${ev?.seq ?? "-"} NOT delivered: ${msg} (retry in ${Math.round((o.retryAt - Date.now()) / 100) / 10}s)`);
};

// Deliver one org's pending events in seq order. Stops at the first one that is not applied.
export async function deliver(o: OrgRecord): Promise<void> {
  for (;;) {
    const ev = o.events.find((e) => !e.applied);
    if (!ev) return;
    ev.attempts++; ev.lastAttemptAt = new Date().toISOString();
    let ans: Answer;
    try { ans = await post(o, ev); } catch (e) { return fail(o, ev, `network: ${(e as Error).message}`); }

    if (ans.status === 200) {
      const m = ans.body?.message ?? {};
      ev.applied = true; ev.lastError = undefined; o.failures = 0; save();
      log(`${o.slug} seq ${ev.seq} ${ev.kind} ${m.applied === false ? "already applied" : "applied"} (last_seq ${m.last_seq})`);
    } else if (ans.status === 409) {
      const expected = Number(ans.body?.expected ?? ans.body?.message?.expected);
      if (!Number.isInteger(expected) || expected < 1 || expected > ev.seq) {
        return fail(o, ev, `409 without a usable "expected": ${JSON.stringify(ans.body).slice(0, 200)}`);
      }
      // Frappe's view wins: everything below `expected` is applied, everything from it is sent again, in order.
      for (const e of o.events) e.applied = e.seq < expected;
      log(`${o.slug} seq ${ev.seq} -> 409 expected ${expected}: resending from ${expected} in order`);
      if (o.events.find((e) => !e.applied)?.seq === ev.seq) return fail(o, ev, `409 expected ${expected} equals seq sent`);
      save();
    } else if (ans.status === 401) {
      return fail(o, ev, "401 bad signature (is SKELETON_SECRET the same on both sides?)");
    } else {
      return fail(o, ev, `HTTP ${ans.status}: ${JSON.stringify(ans.body).slice(0, 200)}`);
    }
  }
}

let busy = false;
export async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (const o of orgs()) {
      if (o.released && Date.now() >= o.retryAt && o.events.some((e) => !e.applied)) await deliver(o);
    }
  } finally { busy = false; }
}

export const status = (slug: string) => {
  const o = state.orgs[slug];
  if (!o) return undefined;
  const pending = o.events.filter((e) => !e.applied);
  return { slug, released: o.released, lastSeq: o.nextSeq - 1, applied: o.events.length - pending.length,
    pending: pending.map((e) => ({ seq: e.seq, kind: e.kind, attempts: e.attempts, lastError: e.lastError })),
    // `payment list`: each PaymentSent on chain, settled once the site has applied it (posted its entry)
    payments: o.events.filter((e) => e.kind === "payment_sent").map((e) => ({ ...e.data, status: e.applied ? "settled" : "sent" })) };
};
