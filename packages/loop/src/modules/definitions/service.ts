/**
 * GENERIC. The door of the definitions module: write a definition (`defineAgent`), load a folder of them (`loadAgents`),
 * find one by name. See types.ts.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { instructionsAt, skillAt } from "./internal/read.ts";
import type { Agent, AgentDefinition, Loaded, Skill, Vocabulary } from "./types.ts";

export type * from "./types.ts";

/** A definition, as its file's default export. It changes nothing: it is here so the file is checked as it is written. */
export const defineAgent = (definition: AgentDefinition): AgentDefinition => definition;

const NAME = /^[a-z][a-z0-9-]*$/;
const strings = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** One definition from `file`, with its paths followed, or why it is not sound. Pure but for reading the files it names. */
export const resolveAgent = (raw: unknown, file: string, known: Vocabulary): { agent?: Agent; problems: string[] } => {
  if (!raw || typeof raw !== "object") return { problems: [`${file}: its default export is not a definition (\`export default defineAgent({ ... })\`)`] };
  const d = raw as Partial<Record<keyof AgentDefinition, unknown>>;
  const name = typeof d.name === "string" ? d.name : "", at = name ? `${name} (${file})` : file, problems: string[] = [];
  const bad = (why: string): void => { problems.push(`${at}: ${why}`); };
  if (!NAME.test(name)) bad("a definition's name is lower-case letters, digits and dashes");
  if (typeof d.description !== "string" || d.description.trim() === "") bad("it has no description");
  if (typeof d.model !== "string" || d.model.trim() === "") bad("it names no model");
  if (d.side !== undefined && d.side !== "maker" && d.side !== "checker") bad("its side is maker or checker");
  const tools = strings(d.tools) ? d.tools : [];
  if (!strings(d.tools) || tools.length === 0) bad("it lists no tools");
  for (const t of tools.filter((t) => !known.tools.includes(t))) bad(`there is no tool named ${t}: the tools are ${known.tools.join(", ")}`);
  if (new Set(tools).size !== tools.length) bad("it lists a tool twice");
  if (typeof d.shell !== "string" || !known.shells.includes(d.shell)) bad(`its shell is one of ${known.shells.join(", ")}`);
  if (d.sandbox !== undefined && (typeof d.sandbox !== "string" || !known.sandboxes.includes(d.sandbox))) bad(`its sandbox is one of ${known.sandboxes.join(", ")}`);
  if (d.skills !== undefined && !strings(d.skills)) bad("its skills are a list of paths");
  const text = typeof d.instructions === "string" ? instructionsAt(file, d.instructions) : { ok: false as const, why: "it names no instructions file" };
  if (!text.ok) bad(text.why);
  const skills: Skill[] = [];
  for (const path of strings(d.skills) ? d.skills : []) { const s = skillAt(file, path); if (s.ok) skills.push(s.value); else bad(s.why); }
  if (new Set(skills.map((s) => s.name)).size !== skills.length) bad("two of its skills have the same name");
  if (problems.length > 0 || !text.ok) return { problems };
  return { problems, agent: {
    name, description: (d.description as string).trim(), model: (d.model as string).trim(), side: d.side === "checker" ? "checker" : "maker",
    instructions: text.value, tools, shell: d.shell as string, skills, ...(typeof d.sandbox === "string" ? { sandbox: d.sandbox } : {}), file,
  } };
};

/**
 * Every definition in `dir`: each `.ts` file's default export. A folder that is not there holds none. A file that
 * cannot be imported, a definition that is not sound and a name used twice are problems, and those agents are left out.
 */
export const loadAgents = async (dir: string, known: Vocabulary): Promise<Loaded> => {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort().map((f) => join(dir, f)) : [];
  const agents: Agent[] = [], problems: string[] = [];
  for (const file of files) {
    let raw: unknown;
    try { raw = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default; }
    catch (cause) { problems.push(`${file}: it cannot be loaded: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`); continue; }
    const got = resolveAgent(raw, file, known);
    problems.push(...got.problems);
    if (!got.agent) continue;
    const twin = agents.find((a) => a.name === got.agent!.name);
    if (twin) problems.push(`${got.agent.name} (${file}): ${twin.file} already defines an agent of that name`);
    else agents.push(got.agent);
  }
  return { agents, problems };
};

export const agentNamed = (agents: readonly Agent[], name: string): Agent | undefined => agents.find((a) => a.name === name);
