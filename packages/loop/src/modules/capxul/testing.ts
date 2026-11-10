/**
 * What the run tests stand on: a throwaway repository with a fake plan and a bare origin, a fake model that says what a
 * test scripts, and a fake recorder. Not a test itself; the tests of this module import it.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Exec } from "../evidence/service.ts";
import { git } from "../lanes/service.ts";
import { DEFAULTS, type Ctx, type Opts } from "./service.ts";

const AGENTS = join(import.meta.dirname, "../../../../../.claude/agents");
const FAKE_PLAN = `import fs from "node:fs";
const a = process.argv.slice(2);
if (a[0] === "show" && a[1] === "--json") console.log(fs.readFileSync("plan.json", "utf8"));
else fs.appendFileSync("plan-calls.log", a.join(" ") + "\\n");
`;
const PLAN = { plan: { tasks: [
  { id: "t1", title: "First", why: "because", state: "todo", needs: [] },
  { id: "t2", title: "Second", why: "later", state: "todo", needs: ["t1"] },
  { id: "t3", title: "Third", why: "done already", state: "done", needs: [] },
], path: { tasks: ["t1", "t2", "t3"] } } };

/** A recorder that is not there: it writes the cast and the GIF the real one would, and a command named `leave` leaves a file behind. */
const recorderOf = (gate: { entered: () => void; go: Promise<void> }): Exec => async (file, args, o) => {
  const command = args[args.indexOf("-c") + 1] ?? "";
  if (file === "asciinema" && command.includes("hold")) { gate.entered(); await gate.go; }   // a command a test holds, so the agent is busy for as long as the test wants
  if (file === "asciinema" && command.includes("leave")) writeFileSync(join(o.cwd, "stray.txt"), "left behind\n");
  writeFileSync(args.at(-1)!, file === "agg" ? "GIF89a" : `${JSON.stringify({ version: 2, command })}\n${JSON.stringify([0.1, "o", "ran\r\n"])}\n`);
  return { code: 0, out: "" };
};

export const rig = () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-capxul-"));
  const root = join(dir, "root"), origin = join(dir, "origin.git");
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "tools"));
  cpSync(AGENTS, join(root, ".claude/agents"), { recursive: true });
  writeFileSync(join(root, "tools/plan.ts"), FAKE_PLAN);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "rig", private: true, scripts: { plan: "node --experimental-strip-types --no-warnings tools/plan.ts" } }));
  writeFileSync(join(root, "plan.json"), JSON.stringify(PLAN));
  writeFileSync(join(root, "README.md"), "root\n");
  writeFileSync(join(root, ".gitignore"), "var/\nplan-calls.log\n");
  git(dir, "init", "--bare", "-q", origin);
  git(dir, "init", "-q", "-b", "integration/build", root);
  git(root, "config", "user.email", "t@t"); git(root, "config", "user.name", "t");
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "origin", "integration/build");
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>((r) => { entered = r; }), go = new Promise<void>((r) => { release = r; });
  const recorder = recorderOf({ entered, go });
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const lines: string[] = [];
  const ctx = (gates: { name: string; sh: string }[] = [{ name: "ok", sh: "true" }]): Ctx => ({ root, env: { PATH: process.env.PATH ?? "", HOME: dir }, now: () => new Date(), say: (l) => lines.push(l), models, gates, retry: { maxRetries: 0, baseDelayMs: 1, waitsMs: [5, 5] }, evidence: { tooling: { asciinema: "asciinema", agg: "agg", browser: null, ffmpeg: null }, exec: recorder } });
  const calls = (): string[] => (existsSync(join(root, "plan-calls.log")) ? readFileSync(join(root, "plan-calls.log"), "utf8").split("\n").filter(Boolean) : []);
  return { dir, root, origin, faux, ctx, calls, lines, held, release };
};

export const opts: Opts = { ...DEFAULTS, model: "faux/faux-1", checkerModel: "faux/faux-1", rounds: 2 };
export const handback = (note: string) => `\`\`\`json\n${JSON.stringify({ submit: { version: { kind: "commit", repo: "x", commit: "0" }, addresses: [], note }, pr: 0, handover: { done: ["made it"], left: [], decisions: [], where: [] }, ran: {} })}\n\`\`\``;
export const check = (verdict: string, findings: unknown[] = []) => `\`\`\`json\n${JSON.stringify({ verdict, findings, fixed: [], ran: {}, verdicts: [] })}\n\`\`\``;
export const makes = (file: string) => [fauxAssistantMessage(fauxToolCall("write", { path: file, content: "made\n" }), { stopReason: "toolUse" }), fauxAssistantMessage(handback("Changed: a file."))];
