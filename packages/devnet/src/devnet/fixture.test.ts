import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bench, delivered, settledPayment } from "./fixture.ts";
import type { Config } from "./supervisor.ts";

function config(root: string): Config {
  return { root, secret: "test-core-secret", chainId: 84532, ports: { core: 0 }, bench: { composeArgs: [] } } as unknown as Config;
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as { port: number }).port;
}

test("native bench reads preserve raw scalars, structured JSON and empty None results", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-bench-output-")), c = config(root);
  const previous = { PATH: process.env.PATH, BENCH_RESULT: process.env.BENCH_RESULT };
  try {
    await writeFile(join(root, "docker"), `#!${process.execPath}\nprocess.stdout.write(process.env.BENCH_RESULT);\n`, { mode: 0o700 });
    process.env.PATH = `${root}:${process.env.PATH}`;
    for (const [output, expected] of [["harbourlineproof\n", "harbourlineproof"], ["0xc97056edb98c2dce657fdd1ab7928035745fde51\n", "0xc97056edb98c2dce657fdd1ab7928035745fde51"],
      ['["Company",125.5]\n', ["Company", 125.5]], ["", null], ['diagnostic\nJSON:{"posted":true}\n', { posted: true }]] as const) {
      process.env.BENCH_RESULT = output;
      assert.deepEqual(await bench(c, "fixture.localhost", "fixture.read"), expected);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true });
  }
});

test("delivery readback converges when a new acknowledged event arrives between Core and native site reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-delivery-readback-")), c = config(root);
  const previous = process.env.PATH;
  let sequence = 0;
  const core = createServer((_req, res) => {
    sequence = Math.min(sequence + 1, 2);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ released: true, last_seq: String(sequence), last_ack: String(sequence), pending: [],
      events: [{ event_key: "hat", seq: "1", state: "applied" }] }));
  });
  c.ports.core = await listen(core);
  try {
    await writeFile(join(root, "docker"), `#!${process.execPath}\nconst args=process.argv;process.stdout.write(args.includes("frappe.db.get_single_value")?"2":args.includes("frappe.db.exists")?"hat-grant":"1");\n`, { mode: 0o700 });
    process.env.PATH = `${root}:${previous}`;
    await delivered(c, { slug: "harbourline", site: "fixture.localhost", email: "director@example.invalid" } as any);
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    await new Promise<void>((done) => core.close(() => done()));
    await rm(root, { recursive: true });
  }
});

test("payment settlement waits for its own consumed event and delayed native posting", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-payment-readback-")), c = config(root);
  const previous = process.env.PATH, txHash = `0x${"a".repeat(64)}`;
  const stateFile = join(root, "payment.json");
  const draft = { pe: { docstatus: 0, capxul_status: "Waiting for signature", reference_no: null }, outstanding: 125.5, safe_credit: 0 };
  const posted = { pe: { docstatus: 1, capxul_status: "Sent", reference_no: txHash }, outstanding: 0, safe_credit: 125.5 };
  let reads = 0, selectedPublished = false;
  const core = createServer(async (_req, res) => {
    selectedPublished = ++reads >= 3;
    if (selectedPublished) await writeFile(join(root, "consumed"), "selected payment consumed");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ released: true, last_seq: "2", last_ack: "2", pending: [], events: [
      { event_key: `${c.chainId}:0x${"b".repeat(64)}:4`, kind: "payment_sent", state: "applied", seq: "1" },
      { event_key: `${c.chainId}:${txHash}:3`, kind: selectedPublished ? "payment_sent" : "deposit_received", state: "applied", seq: "2" },
    ] }));
  });
  c.ports.core = await listen(core);
  try {
    await writeFile(stateFile, JSON.stringify(draft));
    await writeFile(join(root, "docker"), `#!${process.execPath}
const fs=require("node:fs"),args=process.argv;
if(args.includes("capxul.testutil.state")) {
  process.stdout.write(fs.readFileSync(${JSON.stringify(stateFile)},"utf8"));
  if(fs.existsSync(${JSON.stringify(join(root, "consumed"))})) fs.writeFileSync(${JSON.stringify(stateFile)},${JSON.stringify(JSON.stringify(posted))});
} else process.stdout.write(args.includes("frappe.db.get_single_value")?"2":args.includes("frappe.db.exists")?"hat-grant":"1");
`, { mode: 0o700 });
    process.env.PATH = `${root}:${previous}`;
    const f = { slug: "harbourline", site: "fixture.localhost", email: "director@example.invalid", invoice: "PI-1", paymentEntry: "PE-1", txHash } as any;
    await settledPayment(c, f);
    assert.equal(selectedPublished, true, "an older acknowledged payment cannot satisfy the selected transaction barrier");
    assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), posted);
    // Even an already-posted native entry must not hide a selected event still absent from Core.
    reads = 0; selectedPublished = false;
    await settledPayment(c, f);
    assert.equal(selectedPublished, true);
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    await new Promise<void>((done) => core.close(() => done()));
    await rm(root, { recursive: true });
  }
});
