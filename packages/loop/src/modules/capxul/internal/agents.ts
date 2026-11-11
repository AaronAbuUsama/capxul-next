/**
 * Agent definitions, as this repository's runs use them: where they are (`packages/loop/agents/`), what a definition may name
 * here (the tools, the shells, the sandboxes), and what each field comes to when an agent starts. The record and its
 * loading are the definitions module's; this file only decides for Capxul.
 */
import { join, relative } from "node:path";
import type { ProfileSpec } from "../../agents/service.ts";
import { agentNamed, loadAgents, type Agent, type Loaded, type Vocabulary } from "../../definitions/service.ts";
import { TOOL_NAMES } from "../../evidence/types.ts";
import { SANDBOX_TOOLS } from "./boxes.ts";
import type { AgentRecord } from "../../inspect/types.ts";
import type { Ctx, Opts, SandboxInfo } from "../types.ts";
import { POLICY, qualify, SHELLS } from "./config.ts";

/** Where the definitions are, from the repository's root: one file an agent, beside the scripts that use them. */
export const FOLDER = "packages/loop/agents";
const CODING = ["read", "write", "edit", "bash"] as const;
/** What a definition may name here. The capture tools are the evidence module's; the sandboxes go from the least to the most. */
export const VOCABULARY: Vocabulary = { tools: [...CODING, ...TOOL_NAMES, ...SANDBOX_TOOLS], shells: Object.keys(SHELLS), sandboxes: ["none", "light", "cloud", "heavy"] };

/** The definitions of the repository at `root`. `main.ts` loads them once and hands them in as `ctx.agents`. */
export const loadDefinitions = (root: string): Promise<Loaded> => loadAgents(join(root, FOLDER), VOCABULARY);

export const definitionOf = (ctx: Ctx, name: string): Agent | undefined => agentNamed(ctx.agents, name);
export const namesOf = (ctx: Ctx): string => ctx.agents.map((a) => a.name).join(", ") || "none";

/** The host's name for a definition's tools (`hostAs`): never one of the two profiles the host has anyway. */
export const profileOf = (agent: Agent): string => `agent.${agent.name}`;

/** Each definition as a profile of the host: its coding tools, what its bash may run, and the other tools it may call. */
export const profilesOf = (agents: readonly Agent[]): Record<string, ProfileSpec> => Object.fromEntries(agents.map((a) => [profileOf(a), {
  tools: CODING.filter((t) => a.tools.includes(t)), bash: SHELLS[a.shell]?.bash ?? [], writes: a.shell === "write", also: (POLICY.tools ?? []).filter((t) => a.tools.includes(t)),
}]));

/** An agent that has `write` or `edit` makes: what it leaves in its lane is committed as its work. Any other only reads, and what its commands leave is undone. */
export const makes = (agent: Agent): boolean => agent.tools.includes("write") || agent.tools.includes("edit");

/** The model an agent of this run uses: the run's choice for its side (`--model`, `--checker-model`, then `LOOP_MODEL`, `LOOP_CHECKER_MODEL`), else its definition's. */
export const modelOf = (ctx: Ctx, opts: Opts, agent: Agent): string =>
  qualify((agent.side === "checker" ? opts.checkerModel ?? ctx.env.LOOP_CHECKER_MODEL : opts.model ?? ctx.env.LOOP_MODEL) ?? agent.model);

/** Why this agent cannot work in this run's sandbox, or undefined when it can. */
export const lacks = (agent: Agent, box: SandboxInfo | undefined): string | undefined => {
  const has = box?.kind ?? "none", order = VOCABULARY.sandboxes;
  return agent.sandbox && order.indexOf(has) < order.indexOf(agent.sandbox) ? `the ${agent.name} needs a ${agent.sandbox} sandbox and this run has ${has === "none" ? "none" : `a ${has} one`}: start the run with --sandbox ${agent.sandbox}` : undefined;
};

/** What the agent is told to be: its instructions, then its skills by name and description, each with the file to read when it uses one. */
export const systemOf = (agent: Agent, root: string): string => agent.skills.length === 0 ? agent.instructions : [
  agent.instructions, "", "## Skills", "When one of these fits what you are doing, read its file first and follow it.",
  ...agent.skills.map((s) => `- ${s.name}: ${s.description} (\`${relative(root, s.file)}\`)`),
].join("\n");

/** The definition as the run records it when the agent starts (`loop.agent` in the ledger), for whoever looks at the run later. */
export const recordOf = (agent: Agent): Record<string, string | string[]> =>
  ({ name: agent.name, description: agent.description, tools: [...agent.tools], skills: agent.skills.map((s) => s.name), shell: agent.shell, ...(agent.sandbox ? { sandbox: agent.sandbox } : {}) }) satisfies AgentRecord;
