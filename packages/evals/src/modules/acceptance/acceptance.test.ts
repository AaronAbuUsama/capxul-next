import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { alertIds, localUrl, type Fixture } from "./fixture.ts";
import { observation, proveAlerts, readAlerts, type Observation } from "./alerts.ts";
import { cents, reconcile, type Sources } from "./sources.ts";

const fixture = {
  invoice: "PI-17", paymentEntry: "PE-29", company: "Acceptance Ltd", supplier: "Window Cleaning Ltd",
  safeAccount: "Safe - A", amountAtomic: "125500000", txHash: `0x${"a".repeat(64)}`,
} as Fixture;

const source = (): Sources => ({
  invoice: { name: "PI-17", company: "Acceptance Ltd", supplier: "Window Cleaning Ltd", currency: "USD", docstatus: 1, grand_total: 125.5, outstanding_amount: 0 },
  payment: { name: "PE-29", company: "Acceptance Ltd", party: "Window Cleaning Ltd", paid_from: "Safe - A", paid_from_account_currency: "USD", docstatus: 1,
    paid_amount: 125.5, capxul_status: "Sent", reference_no: fixture.txHash, capxul_approval_url: "/approve/17",
    references: [{ reference_doctype: "Purchase Invoice", reference_name: "PI-17", allocated_amount: 125.5 }] },
  request: { status: "Sent", tx_hash: fixture.txHash, approval_url: "/approve/17" },
  ledger: [
    { name: "GL-1", account: "Safe - A", debit: 1000.25, credit: 0, voucher_no: "CAPITAL-1" },
    { name: "GL-2", account: "Capital - A", debit: 0, credit: 1000.25, voucher_no: "CAPITAL-1" },
    { name: "GL-3", account: "Safe - A", debit: 0, credit: 125.5, voucher_no: "PE-29", capxul_trace: "trace-17" },
    { name: "GL-4", account: "Creditors - A", debit: 125.5, credit: 0, voucher_no: "PE-29", capxul_trace: "trace-17" },
  ],
  trial: [{ account: "Safe - A", closing_debit: 874.75, closing_credit: 0 }],
  safeAtomic: "874750000", block: "0x2a", observedAt: "2026-11-12T08:00:00Z",
});

const diagnostics = (active = "", at = new Date().toISOString()): Observation => ({
  observedAt: at,
  alerts: alertIds.map((id) => ({
    id, active: id === active, reason: id === active ? `seeded ${id}` : "", observedAt: at,
    ...(id === "indexer_unready" ? { head: id === active ? null : 42, chainHead: 42, lastAdvanceAt: at } :
      id === "delivery_stuck" ? { pending: id === active ? 1 : 0, oldestDueAt: id === active ? new Date(Date.parse(at) - 301000).toISOString() : null,
        events: id === active ? [{ event_key: "chain:tx:7", seq: 7, last_error: "site unavailable" }] : [] } :
        { events: id === active ? [{ event_key: "chain:tx:8", kind: "payment_sent", reason: "document hash mismatch" }] : [] }),
  })),
});

test("acceptance reconciles independent chain, ledger, allocation and Trial Balance controls", () => {
  reconcile(fixture, source());
  const mistakes: Record<string, (s: Sources) => void> = {
    "second posting": (s) => s.ledger.push({ ...s.ledger[2], name: "GL-5" }),
    "two half postings": (s) => { s.ledger[2]!.credit = 62.75; s.ledger.push({ ...s.ledger[2], name: "GL-5" }); },
    "invoice still owed": (s) => { s.invoice.outstanding_amount = 0.01; },
    "wrong allocation": (s) => { s.payment.references[0].allocated_amount = 125.49; },
    "missing founder capital": (s) => { s.ledger = s.ledger.slice(2); },
    "wrong Trial Balance": (s) => { s.trial[0]!.closing_debit = 874.74; },
    "lost trace": (s) => { s.ledger[2]!.capxul_trace = ""; },
    "conflicting traces": (s) => { s.ledger[3]!.capxul_trace = "other-trace"; },
    "different transaction": (s) => { s.request.tx_hash = `0x${"b".repeat(64)}`; },
  };
  for (const [name, mutate] of Object.entries(mistakes)) {
    const s = source(); mutate(s); assert.throws(() => reconcile(fixture, s), name);
  }
  assert.equal(cents("1000.2500"), 100025n);
  assert.equal(cents("-0.01"), -1n);
  assert.throws(() => cents("125.501"));
});

test("alert observations fail closed for missing, duplicate, stale and wrong-type diagnostics", () => {
  const good = () => diagnostics("", "2026-11-12T08:00:00Z");
  const now = Date.parse(good().observedAt);
  observation(good(), now + 15000);
  assert.throws(() => observation(good(), now + 15001));
  assert.throws(() => observation({ ...good(), alerts: [] }, now));
  const duplicate = good(); duplicate.alerts.push(duplicate.alerts[0]!);
  assert.throws(() => observation(duplicate, now));
  const active = good(); active.alerts[0]!.active = true;
  assert.throws(() => observation(active, now), /reason/);
  assert.throws(() => observation({ ...good(), observedAt: undefined }, now));
  const index = good(); index.alerts[0]!.head = 43;
  assert.throws(() => observation(index, now), /beyond the chain/);
  index.alerts[0]!.active = true; index.alerts[0]!.reason = "inconsistent head";
  observation(index, now);
  index.alerts[0]!.head = 41; index.alerts[0]!.active = false;
  index.alerts[0]!.lastAdvanceAt = new Date(now - 60000).toISOString();
  observation(index, now);
  index.alerts[0]!.lastAdvanceAt = new Date(now - 60001).toISOString();
  assert.throws(() => observation(index, now), /stale lagging/);
  index.alerts[0]!.head = 42; // A stopped world need not keep mining to stay quiet.
  observation(index, now);
  index.alerts[0]!.head = Number.NaN;
  assert.throws(() => observation(index, now), /invalid indexed head/);
  const hidden = diagnostics("money_event_parked", good().observedAt); hidden.alerts[2]!.active = false;
  assert.throws(() => observation(hidden, now), /disagrees/);
  const due = diagnostics("delivery_stuck", good().observedAt); due.alerts[1]!.active = false;
  assert.throws(() => observation(due, now), /disagrees/);
  const boundary = diagnostics("delivery_stuck", good().observedAt);
  boundary.alerts[1]!.oldestDueAt = new Date(now - 300000).toISOString(); boundary.alerts[1]!.active = false;
  observation(boundary, now); // Exactly five minutes is not "over five minutes".
  boundary.alerts[1]!.oldestDueAt = new Date(now - 300001).toISOString();
  assert.throws(() => observation(boundary, now), /disagrees/);
  for (const bad of ["https://production.example", "http://example.com", "http://localhost@evil.test", "http://127.0.0.1/seed"]) assert.throws(() => localUrl(bad));
  localUrl("http://slice-zero.localhost:8000");
});

test("operator HTTP contract authenticates every poll; seeded transitions repair even after a failed seed", async () => {
  const secret = "acceptance-contract-test-only";
  let active = "", failSeed = false;
  const repairs: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (req.url?.startsWith("/control/")) {
      const [, , op, id] = req.url.split("/");
      if (op === "repair") { repairs.push(id!); active = ""; }
      else { active = id!; if (failSeed) { res.writeHead(500); res.end(); return; } }
      res.end("ok"); return;
    }
    assert.equal(req.url, "/admin/alerts"); assert.equal(req.method, "POST");
    assert.equal(req.headers["x-capxul-signature"], createHmac("sha256", secret).update(body).digest("hex"));
    assert.deepEqual(JSON.parse(body), { slug: "acceptance" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(diagnostics(active)));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const control = (op: string, id: string) => [process.execPath, "--input-type=module", "-e", `const r=await fetch('${origin}/control/${op}/${id}');process.exit(r.ok?0:1)`] as const;
  const fault = (id: string) => ({ seed: control("seed", id), repair: control("repair", id) });
  const f = { ...fixture, slug: "acceptance", coreUrl: origin, load: [process.execPath, "-e", "process.exit(0)"],
    faults: { indexer_unready: fault("indexer_unready"), delivery_stuck: fault("delivery_stuck"), money_event_parked: fault("money_event_parked") } } as Fixture;
  const previous = process.env["SKELETON_SECRET"]; process.env["SKELETON_SECRET"] = secret;
  try {
    await readAlerts(f);
    const results: { name: string; passed: boolean }[] = [];
    const kept: Observation[] = [];
    const emit = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); results.push({ name, passed: true }); return true; }
      catch { results.push({ name, passed: false }); return false; }
    };
    await proveAlerts(f, emit, (_stage, value) => kept.push(value));
    assert.equal(results.length, 7); assert(results.every((r) => r.passed));
    assert.deepEqual(repairs, [...alertIds]); assert.equal(active, "");
    assert.equal(kept.filter((s) => s.alerts.some((a) => a.active)).length, 6);
    failSeed = true; results.length = 0;
    await proveAlerts(f, emit, () => {});
    assert.equal(results.find((r) => r.name.endsWith("indexer_unready-fires"))?.passed, false);
    assert.equal(results.find((r) => r.name.endsWith("indexer_unready-clears"))?.passed, false);
    assert.equal(repairs.at(-1), "indexer_unready"); assert.equal(active, "");
    assert(!results.some((r) => r.name.includes("delivery_stuck")), "must stop after an unattributable/failed seed");
  } finally {
    if (previous === undefined) delete process.env["SKELETON_SECRET"]; else process.env["SKELETON_SECRET"] = previous;
    server.close(); await once(server, "close");
  }
});
