import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { resumeFault } from "./faults.ts";
import type { Config } from "./supervisor.ts";

const config = (directory: string, core: number): Config => ({ version: 1, root: directory, controlDir: join(directory, "control"), snapshots: join(directory, "snapshots"),
  codeVersion: "fixture-version", world: { id: "slice0", kind: "local", database: "world_slice0", stateDir: directory, sites: [], epoch: 1 },
  database: { admin: "postgres://operator:a@localhost:5432/postgres", tenant: "postgres://capxul_core:t@localhost:5432/w", worker: "postgres://capxul_worker:w@localhost:5432/w", ponder: "postgres://capxul_ponder:p@localhost:5432/w" },
  ports: { anvil: 1, ponder: 2, core, siteService: 4, bench: 5, socket: 6, publicCore: 7, publicRpc: 8, publicBench: 9, publicBundler: 10 },
  secret: "private-core-secret", siteToken: "t", finality: 0, chainId: 84532, bench: { composeArgs: [], env: {}, dbPassword: "d", adminPassword: "a", baseDomain: "localhost" } });

test("a resume fault kills Core holding an effect without its ACK, then supervision restarts and resumes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "resume-fault-"));
  const resumed: string[] = [];
  const core = createServer((req, res) => { if (req.url === "/admin/snapshot/resume") resumed.push(req.headers["x-capxul-signature"] as string); res.end("{}"); });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const c = config(directory, (core.address() as { port: number }).port);
  const birth = async (pid: number) => { const s = await readFile(`/proc/${pid}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; };
  await mkdir(c.controlDir, { recursive: true });
  // This test process plays Core's supervised wrapper; its child runs the real outbox consume with a recording SQL stub.
  await writeFile(join(c.controlDir, "core.json"), JSON.stringify({ pid: process.pid, birth: await birth(process.pid), codeVersion: c.codeVersion, state: "running" }));
  const consumer = (name: string, transition = "settle") => {
    const script = `import { consume } from ${JSON.stringify(resolve(import.meta.dirname, "../../../backend/src/platform/outbox.ts"))};
      const sql = { query: async (text) => { if (text.includes("transition_acks (consumer")) console.log("ack");
        return text.includes("select event from") ? { rows: [{ event: { id: "evt-1", name: "payment_transitioned", props: { transition: ${JSON.stringify(transition)} } } }], rowCount: 1 } : { rows: [], rowCount: 0 }; } };
      await consume(sql, ${JSON.stringify(name)}, "evt-1", async () => console.log("effect"));`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
      { env: { ...process.env, CAPXUL_FAULT_DIR: join(c.controlDir, "faults") }, stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; child.stdout.on("data", (chunk) => { out += chunk; });
    return { child, output: () => out, exit: new Promise<string | null>((done) => child.once("exit", (_code, signal) => done(signal))) };
  };
  try {
    const match = { event: "payment_transitioned", transition: "settle" };
    assert.deepEqual(await resumeFault(c, { start: async () => {} }, "resume-arm", "activity.feed", 10_000, match), { consumer: "activity.feed", ...match, state: "armed" });
    await assert.rejects(resumeFault(c, { start: async () => {} }, "resume-arm", "activity.feed"), /already has an armed/);
    const other = consumer("notices.mail");
    assert.equal(await other.exit, null);
    assert.equal(other.output(), "effect\nack\n", "an unarmed consumer is untouched");
    const earlier = consumer("activity.feed", "submit");
    assert.equal(await earlier.exit, null);
    assert.equal(earlier.output(), "effect\nack\n", "a delivery of another transition does not take the arm");
    const victim = consumer("activity.feed"), sleeper = spawn("sleep", ["30"]);
    const started: string[] = [];
    // Stand-in for supervision: once the victim dies, a new wrapper writes its running receipt.
    void victim.exit.then(async () => writeFile(join(c.controlDir, "core.json"),
      JSON.stringify({ pid: sleeper.pid, birth: await birth(sleeper.pid!), codeVersion: c.codeVersion, state: "running" })));
    const result = await resumeFault(c, { start: async (component) => { started.push(component); } }, "resume-kill", "activity.feed", 10_000) as any;
    assert.equal(await victim.exit, "SIGKILL");
    assert.equal(victim.output(), "effect\n", "the effect ran but its ACK never did");
    assert.equal(result.eventId, "evt-1"); assert.equal(result.transition, "settle"); assert.equal(result.killed.pid, victim.child.pid); assert.equal(result.restarted.pid, sleeper.pid);
    assert.deepEqual(started, ["core"]); assert.equal(resumed.length, 1);
    sleeper.kill();
    // One-shot: the arm is spent, so the redelivered effect now acknowledges normally and the consumer can be armed again.
    const redelivery = consumer("activity.feed");
    assert.equal(await redelivery.exit, null); assert.equal(redelivery.output(), "effect\nack\n");
    assert.deepEqual(await resumeFault(c, { start: async () => {} }, "resume-arm", "activity.feed"), { consumer: "activity.feed", state: "armed" });
  } finally { core.close(); await rm(directory, { recursive: true, force: true }); }
});
