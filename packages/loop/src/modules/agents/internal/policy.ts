/**
 * The confinement of the coding tools, as an extension whose `beforeTool` hook looks at every call. File tools may touch
 * only paths inside the conversation's directory; bash runs only commands that match the policy's allow-list. This is a
 * policy on what the model asks for, not a sandbox: a command the list allows (`node`, `pnpm exec`) can do anything the
 * user can. The README says so.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { AgentDoc, defineExtension, hook, ToolTask, type Extension } from "@earendil-works/pi-durable";
import type { Policy, Profile } from "../types.ts";

const FILE_TOOLS = new Set(["read", "write", "edit"]);

/**
 * A command line as the commands it runs one after another: cut at `&&`, `||`, `;`, `|` and a new line, but never inside
 * quotes, so `grep -E 'a|b' f` and a commit message of several lines are each one command. Undefined when a quote is left open.
 */
export const segmentsOf = (line: string): string[] | undefined => {
  const out: string[] = [];
  let now = "", quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { now += c; if (c === "\\" && quote === '"' && i + 1 < line.length) now += line[++i]!; else if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') { quote = c; now += c; continue; }
    if (c === "\\" && i + 1 < line.length) { now += c + line[++i]!; continue; }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") { out.push(now); now = ""; i++; continue; }
    if (c === ";" || c === "|" || c === "\n") { out.push(now); now = ""; continue; }
    now += c;
  }
  return quote ? undefined : [...out, now].map((s) => s.trim()).filter(Boolean);
};

/** Why a bash command is refused, or undefined when it is allowed. Pure: the tests call it. */
export const refuseBash = (command: string, cwd: string, allow: readonly RegExp[]): string | undefined => {
  const plain = command.replace(/\d?>&\d|2>\/dev\/null/g, " ");
  if (/[`<>]|\$\(|\.\.\//.test(plain)) return "no redirects, substitutions or `..` in a command";
  const segments = segmentsOf(plain);
  if (!segments) return "a quote in the command is never closed";
  for (const segment of segments) {
    if (!allow.some((a) => a.test(segment))) return `\`${segment.slice(0, 60)}\` is not a command this agent may run`;
    for (const token of segment.split(/\s+/)) {
      if (isAbsolute(token) && !token.startsWith(cwd) && !token.startsWith("/tmp/")) return `${token} is outside the lane`;
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

/** The extension for one profile; select it on a conversation next to `coding-tools`. */
export const confine = (profile: Profile, policy: Policy): Extension =>
  defineExtension({
    name: `confine-${profile}`,
    hooks: [hook(ToolTask, {
      beforeTool: async (call, api, context) => {
        const cwd = (await api.snapshot(AgentDoc, api.conversationId, context))?.cwd;
        if (!cwd) return { block: "this agent has no directory" };
        const args = call.arguments as { path?: string; command?: string };
        const why = FILE_TOOLS.has(call.name) ? refusePath(String(args.path ?? "."), cwd, call.name !== "read", policy.denyWrite)
          : call.name === "bash" ? refuseBash(String(args.command ?? ""), cwd, policy.bash[profile])
          : `the tool ${call.name} is not available`;
        return why ? { block: `Refused by the loop's policy: ${why}` } : undefined;
      },
    })],
  });
