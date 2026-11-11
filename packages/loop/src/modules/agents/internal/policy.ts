/**
 * The confinement of the coding tools, as an extension whose `beforeTool` hook looks at every call. File tools may touch
 * only paths inside the conversation's directory; bash runs only commands that match the policy's allow-list. This is a
 * policy on what the model asks for, not a sandbox: a command the list allows (`node`, `pnpm exec`) can do anything the
 * user can. The README says so.
 */
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { AgentDoc, defineExtension, hook, ToolTask, type Extension } from "@earendil-works/pi-durable";
import type { Policy } from "../types.ts";
import { commandsOf } from "./shell.ts";

const FILE_TOOLS = new Set(["read", "write", "edit"]);

/** A command line as the commands it runs one after another, each as its words (internal/shell.ts). Undefined when a quote is left open. */
export const segmentsOf = (line: string): string[] | undefined => commandsOf(line)?.map((c) => c.words.join(" "));

/** Why a path a command names is refused, or undefined. Each reason says the way round, so a refused agent does not try the same thing another way. */
const refuseNamed = (token: string, cwd: string): string | undefined => {
  if (token === "/dev/null" || token === "/tmp" || token.startsWith("/tmp/")) return undefined;
  if (isAbsolute(token)) {
    if (token === cwd || token.startsWith(`${cwd}/`)) return undefined;
    if (token.startsWith("/home/user/")) return `${token} is outside the lane, and does not exist on this machine (a path of an old cloud session)`;
    return `${token} is outside the lane`;
  }
  return normalize(token).split("/")[0] === ".." ? `${token} is outside the lane: name paths from the lane's root, without \`..\`` : undefined;
};

/**
 * Why a bash command is refused, or undefined when it is allowed. Pure: the tests call it. Only what the shell acts on is
 * judged; text in quotes or a here-document is the program's (internal/shell.ts). Output may be redirected to a file
 * only when `writes` is given (a reader changes nothing), and never into a path it lists. A `hint` matching the command
 * is added to its refusal.
 */
export const refuseBash = (command: string, cwd: string, allow: readonly RegExp[], writes?: { readonly deny: readonly RegExp[] }, hints: Policy["hints"] = []): string | undefined => {
  const commands = commandsOf(command);
  if (!commands) return "a quote or a here-document in the command is never closed";
  for (const c of commands) {
    if (c.forbidden) return c.forbidden;
    const line = c.words.join(" ");
    if (!allow.some((a) => a.test(line))) {
      const hint = hints.find(([when]) => when.test(line))?.[1];
      return `\`${line.slice(0, 60)}\` is not a command this agent may run${hint ? `: ${hint}` : ""}`;
    }
    for (const w of c.words) if (w.startsWith("/") || w.startsWith("..")) { const why = refuseNamed(w, cwd); if (why) return why; }
    for (const target of c.redirects) {
      if (target === "/dev/null") continue;
      const why = refuseNamed(target, cwd); if (why) return why;
      if (!writes) return "this agent only reads: it may not send output to a file";
      if (!target.startsWith("/tmp")) {
        const rel = relative(cwd, resolve(cwd, target));
        if (writes.deny.some((d) => d.test(rel))) return `${rel} may not be written`;
      }
    }
  }
  return undefined;
};

/** Why a file call is refused, or undefined. */
export const refusePath = (path: string, cwd: string, write: boolean, deny: readonly RegExp[]): string | undefined => {
  const rel = relative(cwd, resolve(cwd, path));
  if (rel.startsWith("..") || isAbsolute(rel)) return `${path} is outside the lane`;
  if (write && deny.some((d) => d.test(rel))) return `${rel} may not be written`;
  return undefined;
};

/** What one profile is held to: what its bash may run, what the file tools may not write, which further tools it may call. */
export interface Rules { readonly bash: readonly RegExp[]; readonly denyWrite: Policy["denyWrite"]; readonly tools: readonly string[]; readonly writes?: boolean | undefined; readonly hints?: Policy["hints"] }

/** The extension for the profile named `name`; select it on a conversation next to `coding-tools`. */
export const confine = (name: string, rules: Rules): Extension =>
  defineExtension({
    name: `confine-${name}`,
    hooks: [hook(ToolTask, {
      beforeTool: async (call, api, context) => {
        const cwd = (await api.snapshot(AgentDoc, api.conversationId, context))?.cwd;
        if (!cwd) return { block: "this agent has no directory" };
        const args = call.arguments as { path?: string; command?: string };
        const why = FILE_TOOLS.has(call.name) ? refusePath(String(args.path ?? "."), cwd, call.name !== "read", rules.denyWrite)
          : call.name === "bash" ? refuseBash(String(args.command ?? ""), cwd, rules.bash, rules.writes ? { deny: rules.denyWrite } : undefined, rules.hints)
          : rules.tools.includes(call.name) ? undefined
          : `the tool ${call.name} is not available`;
        return why ? { block: `Refused by the loop's policy: ${why}` } : undefined;
      },
    })],
  });
