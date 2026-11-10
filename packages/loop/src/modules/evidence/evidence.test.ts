import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { capturesOf, evidenceTools, judge, nodeExec, refuseBrowser, refuseUrl, textOfCast, toolingOf, type Capture, type EvidenceDeps, type Exec } from "./service.ts";

const HOSTS = ["127.0.0.1", "localhost", "*.localhost"];
const CAST = (command: string, out: string, exit: number): string => [JSON.stringify({ version: 2, width: 110, height: 30, command }), JSON.stringify([0.1, "o", out]), JSON.stringify([0.2, "x", String(exit)])].join("\n") + "\n";

/** A recorder and a browser that are not there: each writes the file the real one would, and says what it was asked. */
const fake = (o: { exit?: number; out?: string } = {}): { exec: Exec; asked: string[][] } => {
  const asked: string[][] = [];
  const exec: Exec = async (file, args) => {
    asked.push([file, ...args]);
    const last = args.at(-1)!;
    if (file === "asciinema") { writeFileSync(last, CAST(args[args.indexOf("-c") + 1]!, `$ the command\r\n${o.out ?? "\u001b[32mok\u001b[0m\r\n"}`, o.exit ?? 0)); return { code: o.exit ?? 0, out: "" }; }
    if (file === "agg" || file === "ffmpeg") { writeFileSync(last, "GIF89a"); return { code: 0, out: "" }; }
    const words = args.slice(4);                                          // after --session s --allowed-domains d
    if (words[0] === "screenshot") { writeFileSync(words[1]!, "PNG"); return { code: 0, out: "saved" }; }
    if (words[0] === "get") return { code: 0, out: words[1] === "url" ? "http://127.0.0.1:4000/pay\n" : "Pay\n" };
    return { code: 0, out: `did ${words.join(" ")}` };
  };
  return { exec, asked };
};
const deps = (over: Partial<EvidenceDeps> = {}): EvidenceDeps => ({
  dir: join(mkdtempSync(join(tmpdir(), "loop-evidence-")), "evidence"), by: "make.1", cwd: tmpdir(), env: { PATH: "/usr/bin:/bin" }, now: () => new Date("2026-11-10T12:00:00.000Z"),
  exec: fake().exec, tooling: { asciinema: "asciinema", agg: "agg", browser: "agent-browser", ffmpeg: "ffmpeg" }, refuse: (c) => (c.startsWith("rm") ? "rm is not a command this agent may run" : undefined), hosts: HOSTS, ...over,
});
/** One call of a tool. A kit is one step's tools: calls that belong together (a recording's start and stop) share one. */
const call = async (d: EvidenceDeps | ReturnType<typeof evidenceTools>, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
  const tool = ("tools" in d ? d : evidenceTools(d)).tools.find((t) => t.name === name)!;
  const r = await (tool.execute as unknown as (a: unknown) => Promise<{ output: { text: string }[]; isError?: boolean }>)(args);
  return { text: r.output[0]!.text, isError: r.isError === true };
};

test("record_terminal runs the command under the recorder and keeps a capture: the GIF first, the cast, the command and how it ended", async () => {
  const f = fake({ exit: 3, out: "\u001b[31mrefused: not enough funds\u001b[0m\r\n" }), d = deps({ exec: f.exec });
  const r = await call(d, "record_terminal", { name: "pay-refuses-overdraft", command: "node cli.js pay 999" });
  assert.equal(r.isError, false);
  assert.match(r.text, /^Recorded as capture make\.1\.pay-refuses-overdraft: make\.1\.pay-refuses-overdraft\.gif \(6 B\)\. The command ended with 3\.\n\nrefused: not enough funds\n$/);
  assert.deepEqual(f.asked[0]!.slice(0, 3), ["asciinema", "rec", "--overwrite"]);
  assert.equal(f.asked[0]![f.asked[0]!.indexOf("-c") + 1], "printf '\\033[2m$ %s\\033[0m\\n' 'node cli.js pay 999'; node cli.js pay 999", "the recording opens with the command, quoted");
  assert.equal(f.asked[1]![f.asked[1]!.indexOf("--rows") + 1], "4", "a short run is drawn only as tall as it is");
  const [c] = capturesOf(d.dir);
  assert.deepEqual({ ...c, files: c!.files.map((x) => [x.name, x.type, x.bytes]) }, {
    id: "make.1.pay-refuses-overdraft", kind: "terminal", by: "make.1", at: "2026-11-10T12:00:00.000Z", ms: 0, source: { command: "node cli.js pay 999", exit: 3 },
    files: [["make.1.pay-refuses-overdraft.gif", "image/gif", 6], ["make.1.pay-refuses-overdraft.cast", "application/x-asciicast", c!.files[1]!.bytes]],
  });
  assert.match(c!.files[0]!.sha256, /^[0-9a-f]{64}$/);
});

test("record_terminal refuses what the agent's policy refuses, a bad name, a name used twice, and says when there is no recorder", async () => {
  const d = deps();
  assert.match((await call(d, "record_terminal", { name: "x", command: "rm -rf lane" })).text, /^Refused by the loop's policy: rm is not/);
  assert.match((await call(d, "record_terminal", { name: "Bad Name", command: "ls" })).text, /a capture's name is 1 to 48 lower-case letters/);
  assert.equal((await call(d, "record_terminal", { name: "once", command: "ls" })).isError, false);
  assert.match((await call(d, "record_terminal", { name: "once", command: "ls" })).text, /already a capture named make\.1\.once/);
  assert.equal(capturesOf(d.dir).length, 1);
  const none = deps({ tooling: { asciinema: null, agg: null, browser: null, ffmpeg: null } });
  assert.match((await call(none, "record_terminal", { name: "x", command: "ls" })).text, /not available on this machine: asciinema is not installed/);
  assert.deepEqual(evidenceTools(none).tools.map((t) => t.name), ["record_terminal"], "with no browser there are no browser tools");
});

test("the browser opens only the allowed hosts and takes only the listed actions", () => {
  assert.equal(refuseBrowser(["open", "http://127.0.0.1:4000/pay"], HOSTS), undefined);
  assert.equal(refuseBrowser(["open", "http://acme.loopab12.localhost:8000/"], HOSTS), undefined);
  assert.equal(refuseBrowser(["click", "@e2"], HOSTS), undefined);
  assert.equal(refuseBrowser(["snapshot", "-i"], HOSTS), undefined);
  assert.match(refuseBrowser(["open", "https://example.com/"], HOSTS)!, /example\.com is not a host this agent may open/);
  assert.match(refuseBrowser(["open", "file:///etc/passwd"], HOSTS)!, /only http and https/);
  assert.match(refuseBrowser(["tab", "new", "https://evil.example/"], HOSTS)!, /not a host/);
  assert.match(refuseBrowser(["eval", "fetch('https://x')"], HOSTS)!, /`eval` is not something this agent may tell the browser/);
  assert.match(refuseBrowser(["open", "http://127.0.0.1/", "--allow-file-access"], HOSTS)!, /no long options/);
  assert.match(refuseBrowser(["get", "cdp-url"], HOSTS)!, /debugging address/);
  assert.match(refuseUrl("http://localhost.evil.example/", HOSTS)!, /not a host/);
});

test("screenshot and record_screen keep captures that say which page they are of; the session is one per step and closed after", async () => {
  const f = fake(), d = deps({ exec: f.exec, by: "reviewer.1.agent" }), kit = evidenceTools(d);
  assert.deepEqual(kit.tools.map((t) => t.name), ["record_terminal", "browser", "screenshot", "record_screen"]);
  assert.equal((await call(d, "browser", { args: ["open", "http://127.0.0.1:4000/pay"] })).text, "did open http://127.0.0.1:4000/pay");
  assert.match((await call(d, "browser", { args: ["open", "https://example.com"] })).text, /^Refused by the loop's policy/);
  assert.match((await call(d, "screenshot", { name: "pay-form" })).text, /^Taken as capture reviewer\.1\.agent\.pay-form: reviewer\.1\.agent\.pay-form\.png \(3 B\) of Pay at http:\/\/127\.0\.0\.1:4000\/pay\.$/);
  assert.match((await call(kit, "record_screen", { name: "pays", action: "stop" })).text, /^no recording named pays is running: start it first$/);
  assert.match((await call(kit, "record_screen", { name: "pays", action: "start" })).text, /^Recording the browser: a frame is kept after each browser action/);
  assert.match((await call(kit, "record_screen", { name: "other", action: "start" })).text, /^the recording pays is still running: stop it first$/);
  await call(kit, "browser", { args: ["click", "@e2"] });
  assert.match(f.asked.at(-1)!.slice(5).join(" "), /^screenshot .*\.frames-reviewer\.1\.agent\.pays\/001\.png$/, "while it records, a frame is kept after each action");
  assert.match((await call(kit, "record_screen", { name: "pays", action: "stop" })).text, /^Kept as capture reviewer\.1\.agent\.pays: reviewer\.1\.agent\.pays\.gif \(2 frames, 6 B\)\.$/);
  const joined = f.asked.find((a) => a[0] === "ffmpeg")!;
  assert.deepEqual([joined[joined.indexOf("-framerate") + 1], joined.includes("-nostdin")], [String(1 / 1.5), true]);
  assert.equal(existsSync(join(d.dir, ".frames-reviewer.1.agent.pays")), false, "the frames are removed once they are joined");
  await kit.close();
  assert.deepEqual(f.asked.at(-1)!.slice(5), ["close"], "the step's browser is closed when the step ends");
  assert.deepEqual(capturesOf(d.dir).map((c) => [c.kind, c.source, c.files[0]!.type]), [
    ["screenshot", { url: "http://127.0.0.1:4000/pay", title: "Pay" }, "image/png"], ["screen-recording", { url: "http://127.0.0.1:4000/pay", title: "Pay" }, "image/gif"]]);
  assert.match((await call(deps({ exec: f.exec, tooling: { asciinema: null, agg: null, browser: "agent-browser", ffmpeg: null } }), "record_screen", { name: "x", action: "start" })).text, /ffmpeg is not installed\. Take a screenshot of each step instead\.$/);
  assert.ok(f.asked.filter((a) => a[0] === "agent-browser").every((a) => a[1] === "--session" && a[2] === f.asked[0]![2] && a[4] === HOSTS.join(",")), "every call names the same session and the allowed hosts");
});

test("a claim stands only when it names a capture of the run, says what it shows, and names an eval of the task", () => {
  const cap = (id: string, by: string): Capture => ({ id, kind: "terminal", by, at: "", ms: 0, source: { command: "x", exit: 0 }, files: [] });
  const captures = [cap("make.1.tests-pass", "make.1"), cap("reviewer.1.agent.tried", "reviewer.1.agent")];
  const judged = judge([
    { capture: "make.1.tests-pass", shows: "all 41 tests pass", eval: "e.one" }, { capture: "tests-pass", shows: "the short name finds it" },
    { capture: "made-up", shows: "nothing" }, { capture: "make.1.tests-pass", shows: " " }, { capture: "make.1.tests-pass", shows: "x", eval: "e.other" }, "not a claim",
  ], captures, { by: "make.1", evals: ["e.one"] });
  assert.deepEqual(judged, [
    { capture: "make.1.tests-pass", shows: "all 41 tests pass", eval: "e.one", ok: true }, { capture: "make.1.tests-pass", shows: "the short name finds it", ok: true },
    { capture: "made-up", shows: "nothing", ok: false, why: "no capture named made-up was made in this run" }, { capture: "make.1.tests-pass", shows: "", ok: false, why: "the claim does not say what the capture shows" },
    { capture: "make.1.tests-pass", shows: "x", eval: "e.other", ok: false, why: "e.other is not an eval of this task" }, { capture: "", shows: "", ok: false, why: "the claim names no capture" },
  ]);
  assert.deepEqual(judge(undefined, captures, { by: "make.1", evals: [] }), []);
  assert.equal(textOfCast(CAST("x", "\u001b[1ma\u001b[0m\r\nb\r\n", 0)), "a\nb\n");
});

test("with the real recorder, where this machine has one: a command is recorded with no screen attached, as a GIF, with its exit code", async (t) => {
  const tooling = toolingOf(process.env.PATH);
  if (!tooling.asciinema || !tooling.agg) return t.skip("asciinema and agg are not installed here");
  const d = deps({ exec: nodeExec, tooling: { ...tooling, browser: null }, refuse: () => undefined, env: { PATH: process.env.PATH ?? "", HOME: tmpdir() } });
  const r = await call(d, "record_terminal", { name: "real", command: "echo 'it''s recorded' && exit 4" });
  assert.match(r.text, /The command ended with 4\.\n\nits recorded\n$/);
  assert.match(readFileSync(join(d.dir, "make.1.real.cast"), "utf8"), /\$ echo 'it''s recorded' && exit 4/, "the cast opens with the command as typed");
  const [c] = capturesOf(d.dir);
  assert.deepEqual(c!.source, { command: "echo 'it''s recorded' && exit 4", exit: 4 });
  assert.equal(readFileSync(join(d.dir, c!.files[0]!.name)).subarray(0, 6).toString("latin1"), "GIF89a");
  assert.ok(existsSync(join(d.dir, "make.1.real.cast")));
});

test("when the agent is stopped, a program a tool started dies with everything under it, and nothing is kept", async () => {
  const stop = new AbortController(), t0 = Date.now();
  setTimeout(() => stop.abort(), 150);
  const ran = await nodeExec("/bin/sh", ["-c", "sleep 30 & wait"], { cwd: tmpdir(), env: { PATH: "/usr/bin:/bin" }, timeoutMs: 60_000, signal: stop.signal });
  assert.ok(Date.now() - t0 < 5000, "it did not wait for the sleep");
  assert.notEqual(ran.code, 0);

  // The recorder is asked to record, the agent is stopped meanwhile: the tool says so and keeps no capture.
  const asked: (AbortSignal | undefined)[] = [], halt = new AbortController();
  const d = deps({ exec: async (file, args, o) => { asked.push(o.signal); halt.abort(); writeFileSync(args.at(-1)!, CAST("x", "half\r\n", 0)); return { code: 143, out: "" }; } });
  const tool = evidenceTools(d).tools.find((t) => t.name === "record_terminal")!;
  const r = await (tool.execute as unknown as (a: unknown, api: unknown, context: unknown) => Promise<{ output: { text: string }[]; isError?: boolean }>)({ name: "cut-short", command: "node slow.js" }, undefined, { abortSignal: halt.signal });
  assert.deepEqual([r.output[0]!.text, r.isError], ["the agent was stopped while the command ran: nothing was kept", true]);
  assert.equal(asked[0], halt.signal, "the program is run with the agent's own signal");
  assert.deepEqual(capturesOf(d.dir), []);
  assert.equal(existsSync(join(d.dir, "make.1.cut-short.cast")), false);
});
