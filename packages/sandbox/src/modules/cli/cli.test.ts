// The CLI through its interface: argv in, a result out. Boxes are kept by a launcher in this test; `exec` reaches a
// real box server in this process. With SANDBOX_TEST_IMAGE=<tag> the last test drives local Docker containers instead.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { docker, serveBox, type BoxRecord, type Launcher, type Link } from "../box/service.ts";
import { sandboxCli, type CliDeps } from "./service.ts";

let link: Link, close: () => Promise<void>;
before(async () => {
  const s = await serveBox({ port: 0, host: "127.0.0.1", machine: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir() }, repo: process.cwd() });
  link = { url: `http://127.0.0.1:${s.port}`, headers: {} }; close = s.close;
});
after(() => close());

/** A launcher that keeps its boxes in a map, and lends each the one server above. */
const kept = (now: () => Date): Launcher & { boxes: Map<string, BoxRecord> } => {
  const boxes = new Map<string, BoxRecord>();
  return {
    name: "docker", boxes,
    async start(name, o) {
      boxes.set(name, { name, owner: o.owner, startedAt: now().toISOString(), expiresAt: new Date(now().getTime() + o.ttlMs).toISOString(), running: true });
      return { ok: true, value: link };
    },
    link: (name) => (boxes.has(name) ? { ok: true, value: link } : { ok: false, error: { kind: "box", message: `there is no box ${name}` } }),
    async stop(name) { boxes.delete(name); },
    async list() { return { ok: true, value: [...boxes.values()] }; },
  };
};

const rig = () => {
  let t = new Date("2026-11-11T12:00:00Z");
  const written: string[] = [], launcher = kept(() => t);
  const deps: CliDeps = { launcher, now: () => t, write: (s) => written.push(s) };
  return { launcher, deps, written, later: (ms: number) => { t = new Date(t.getTime() + ms); }, cli: (...a: string[]) => sandboxCli(a, deps) };
};

test("up starts a box for an owner with a time to live; ls shows it; down takes it away", async () => {
  const r = rig();
  const up = await r.cli("up", "feat-x", "--owner", "run:r1", "--ttl", "90m");
  assert.equal(up.code, 0, up.lines.join("\n"));
  assert.match(up.lines[0]!, /^feat-x is up \(docker\), expires 2026-11-11T13:30:00/);
  assert.match((await r.cli("ls")).lines[0]!, /^feat-x\s+run:r1\s+running\s+up 0m/);
  assert.deepEqual(JSON.parse((await r.cli("ls", "--json")).lines[0]!).map((b: BoxRecord) => b.owner), ["run:r1"]);
  assert.equal((await r.cli("down", "feat-x")).code, 0);
  assert.deepEqual((await r.cli("ls")).lines, ["no boxes"]);
});

test("a bad time to live, a missing name and an unknown command are refused with the usage", async () => {
  const r = rig();
  assert.equal((await r.cli("up", "x", "--ttl", "2d")).code, 2);
  assert.equal((await r.cli("up")).code, 2);
  const none = await r.cli("frobnicate");
  assert.equal(none.code, 2);
  assert.match(none.lines[0]!, /^usage: pnpm sandbox up/);
});

test("exec streams the command's output and its exit code is the CLI's", async () => {
  const r = rig();
  await r.cli("up", "b1");
  const ran = await r.cli("exec", "b1", "--cwd", "/", "--", "echo hello; exit 7");
  assert.equal(ran.code, 7);
  assert.match(r.written.join(""), /hello/);
  assert.equal((await r.cli("exec", "b1", "--", "true")).code, 0);
  assert.equal((await r.cli("exec", "nope", "--", "true")).code, 1);
});

test("down --owner takes down only that owner's boxes; down --all every one", async () => {
  const r = rig();
  for (const [n, o] of [["a", "run:r1"], ["b", "run:r1"], ["c", "run:r2"]] as const) await r.cli("up", n, "--owner", o);
  assert.deepEqual((await r.cli("down", "--owner", "run:r1")).lines, ["down: a, b"]);
  assert.deepEqual([...r.launcher.boxes.keys()], ["c"]);
  await r.cli("down", "--all");
  assert.equal(r.launcher.boxes.size, 0);
});

test("reap takes down boxes past their expiry and those not running; --dry-run only says so", async () => {
  const r = rig();
  await r.cli("up", "short", "--ttl", "10m");
  await r.cli("up", "long", "--ttl", "2h");
  await r.cli("up", "dead");
  r.launcher.boxes.set("dead", { ...r.launcher.boxes.get("dead")!, running: false });
  r.later(30 * 60_000);
  const dry = await r.cli("reap", "--dry-run");
  assert.deepEqual(dry.lines, ["would take down short (cli): past its expiry", "would take down dead (cli): not running"]);
  assert.equal(r.launcher.boxes.size, 3);
  await r.cli("reap");
  assert.deepEqual([...r.launcher.boxes.keys()], ["long"]);
});

test("docker: boxes carry their owner and expiry as labels; ls, reap and down see them", { skip: !process.env.SANDBOX_TEST_IMAGE }, async () => {
  const launcher = docker(process.env.SANDBOX_TEST_IMAGE!), deps: CliDeps = { launcher, now: () => new Date(), write: () => undefined };
  try {
    assert.equal((await sandboxCli(["up", "cli-test-a", "--owner", "run:t", "--ttl", "5m"], deps)).code, 0);
    assert.equal((await sandboxCli(["exec", "cli-test-a", "--", "pnpm --version && anvil --version"], deps)).code, 0);
    const listed = await launcher.list();
    assert.ok(listed.ok && listed.value.some((b) => b.name === "cli-test-a" && b.owner === "run:t" && b.running));
    const later: CliDeps = { ...deps, now: () => new Date(Date.now() + 10 * 60_000) };
    assert.match((await sandboxCli(["reap"], later)).lines.join("\n"), /took down cli-test-a \(run:t\): past its expiry/);
  } finally { await sandboxCli(["down", "--owner", "run:t"], deps); }
});
