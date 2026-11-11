/**
 * Boxes an agent makes for itself: `sandbox_up`, `sandbox_exec`, `sandbox_down`. They run here, in the process that
 * plays the run, so the sandbox key never reaches an agent. Every box an agent makes is owned by the run (`run:<id>`),
 * named `<run>-<the agent's name for it>`, capped at MAX_PER_RUN at once, and taken down when the run ends; the
 * launcher's own guard (expiry, idle stop) catches whatever is left.
 */
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { boxOf, nameOf } from "@capxul/sandbox/box";
import type { Job } from "../types.ts";
import { launcherOf, ownerOf } from "./cloud.ts";

export const SANDBOX_TOOLS = ["sandbox_up", "sandbox_exec", "sandbox_down"] as const;
/** Boxes one run's agents may hold at once, beside the run's own. */
export const MAX_PER_RUN = 3;
const MAX_TTL_MIN = 180;

type Said = { text: string; ok: boolean };
const tool = (name: string, description: string, properties: Record<string, object>, required: string[], run: (args: Record<string, unknown>) => Promise<Said>): ToolRegistration =>
  defineTool({
    name, description, parameters: { type: "object", properties, required },
    execute: async (args: Record<string, unknown>) => { const s = await run(args); return { output: [{ type: "text" as const, text: s.text }], ...(s.ok ? {} : { isError: true }) }; },
  }) as unknown as ToolRegistration;
const str = (description: string) => ({ type: "string", description });
const no = (text: string): Said => ({ text, ok: false });

export const sandboxTools = (job: Job, allowed: readonly string[]): ToolRegistration[] => {
  const runBox = nameOf(job.run.id), boxName = (n: unknown): string => nameOf(`${job.run.id}-${String(n ?? "")}`);
  const launcher = () => launcherOf(job.ctx);
  const mine = async (): Promise<string[]> => {
    const l = launcher();
    if (typeof l === "string") return [];
    const all = await l.list();
    return all.ok ? all.value.filter((b) => b.owner === ownerOf(job.run.id) && b.running && b.name !== runBox).map((b) => b.name) : [];
  };

  const up = tool("sandbox_up", `Start a box of your own: a fresh container with the repository's toolchain and packages and no internet, off this machine. With "lane": true your lane's committed state is copied into it at the same path. At most ${MAX_PER_RUN} at once; each lives at most ${MAX_TTL_MIN} minutes and goes down when the run ends.`,
    { name: str("a short name for it: letters, digits, dashes"), lane: { type: "boolean", description: "copy your lane's commits into it" }, ttl_minutes: { type: "number", description: `how long it may live, at most ${MAX_TTL_MIN}` } }, ["name"],
    async (a) => {
      const l = launcher();
      if (typeof l === "string") return no(l);
      const name = boxName(a.name), held = await mine();
      if (!held.includes(name) && held.length >= MAX_PER_RUN) return no(`you already hold ${held.length} boxes (${held.join(", ")}): take one down with sandbox_down first`);
      const ttlMs = Math.min(Math.max(Number(a.ttl_minutes ?? 60), 1), MAX_TTL_MIN) * 60_000;
      const r = await l.start(name, { owner: ownerOf(job.run.id), ttlMs });
      if (!r.ok) return no(r.error.message);
      if (a.lane === true) { const p = await boxOf(r.value).push(job.lane!.dir, job.lane!.branch); if (!p.ok) return no(`${name} is up, but your lane did not reach it: ${p.error.message}`); }
      return { ok: true, text: `${name} is up for ${ttlMs / 60_000} minutes${a.lane === true ? `, with your lane at ${job.lane!.dir}` : ""}. Use sandbox_exec with name "${String(a.name)}".` };
    });

  const exec = tool("sandbox_exec", "Run a shell command in one of your boxes. Returns its exit code and the end of its output.",
    { name: str("the name you gave it"), command: str("a shell command line"), cwd: str("where to run it; default your lane's path in the box") }, ["name", "command"],
    async (a) => {
      const l = launcher();
      if (typeof l === "string") return no(l);
      const name = boxName(a.name);
      if (!(await mine()).includes(name)) return no(`you hold no box named ${String(a.name)}: start it with sandbox_up`);
      const link = l.link(name);
      if (!link.ok) return no(link.error.message);
      const r = await boxOf(link.value).run(String(a.command), { cwd: String(a.cwd ?? job.lane!.dir), timeoutMs: 20 * 60_000, stopped: () => false });
      return { ok: r.code === 0, text: `exit ${r.code ?? "none (killed)"}${r.timedOut ? " (timed out after 20 minutes)" : ""}\n\n${r.out.slice(-6000)}` };
    });

  const down = tool("sandbox_down", "Take one of your boxes down. What is in it is gone.", { name: str("the name you gave it") }, ["name"],
    async (a) => {
      const l = launcher();
      if (typeof l === "string") return no(l);
      const name = boxName(a.name);
      if (!(await mine()).includes(name)) return no(`you hold no box named ${String(a.name)}`);
      await l.stop(name);
      return { ok: true, text: `${name} is down` };
    });

  return [up, exec, down].filter((t) => allowed.includes(t.name));
};
