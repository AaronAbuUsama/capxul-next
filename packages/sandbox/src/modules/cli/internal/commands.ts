/** The commands of `pnpm sandbox`, one function each, over a launcher (types.ts says what each does). */
import { execFileSync } from "node:child_process";
import { boxOf, nameOf, reap } from "../../box/service.ts";
import type { BoxRecord, Launcher, Link } from "../../box/types.ts";
import { DEFAULT_TTL_MS, type CliDeps, type CliResult } from "../types.ts";

const USAGE = [
  "usage: pnpm sandbox up <name> [--dir <checkout>] [--branch <b>] [--owner <who>] [--ttl 2h]",
  "       pnpm sandbox exec <name> [--cwd <dir>] -- <command…>",
  "       pnpm sandbox push|pull <name> <checkout> [--branch <b>] [--message <m>]",
  "       pnpm sandbox ls [--json] | down <name>… | down --owner <who> | down --all | reap [--dry-run]",
];
const done = (lines: string[] = []): CliResult => ({ code: 0, lines });
const refused = (...lines: string[]): CliResult => ({ code: 2, lines });
const failed = (line: string): CliResult => ({ code: 1, lines: [line] });

/** Flags (`--x value`, `--x` alone for a switch), the words before `--`, and everything after it. */
const parse = (argv: readonly string[], switches: readonly string[]): { flags: Map<string, string>; words: string[]; rest: string[] } => {
  const flags = new Map<string, string>(), words: string[] = [], cut = argv.indexOf("--");
  const head = cut < 0 ? argv : argv.slice(0, cut);
  for (let i = 0; i < head.length; i++) {
    const a = head[i]!;
    if (!a.startsWith("--")) words.push(a);
    else if (switches.includes(a.slice(2))) flags.set(a.slice(2), "true");
    else flags.set(a.slice(2), head[++i] ?? "");
  }
  return { flags, words, rest: cut < 0 ? [] : argv.slice(cut + 1) };
};

/** `90m`, `2h`: a time to live. */
const ttlOf = (s: string | undefined): number | undefined => {
  if (s === undefined) return DEFAULT_TTL_MS;
  const m = /^(\d+)(m|h)$/.exec(s);
  return m ? Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000) : undefined;
};

const branchOf = (dir: string, given?: string): string => given ?? execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const ago = (from: string, now: Date): string => { const m = Math.round((now.getTime() - Date.parse(from)) / 60_000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`; };
const row = (b: BoxRecord, now: Date): string => `${b.name.padEnd(24)} ${b.owner.padEnd(28)} ${(b.running ? "running" : "stopped").padEnd(8)} up ${ago(b.startedAt, now).padEnd(7)} expires in ${ago(now.toISOString(), new Date(Date.parse(b.expiresAt))).replace("-", "")}`;

const linked = (l: Launcher, name: string): Link | string => { const r = l.link(name); return r.ok ? r.value : r.error.message; };

const up = async (d: CliDeps, argv: readonly string[]): Promise<CliResult> => {
  const { flags, words } = parse(argv, []);
  const name = words[0], ttlMs = ttlOf(flags.get("ttl")), dir = flags.get("dir");
  if (!name) return refused("up needs a name", ...USAGE);
  if (ttlMs === undefined) return refused(`--ttl is minutes or hours, such as 90m or 2h: ${flags.get("ttl")}`);
  const started = await d.launcher.start(name, { owner: flags.get("owner") ?? "cli", ttlMs });
  if (!started.ok) return failed(started.error.message);
  const lines = [`${nameOf(name)} is up (${d.launcher.name}), expires ${new Date(d.now().getTime() + ttlMs).toISOString()}`];
  if (dir) {
    const pushed = await boxOf(started.value).push(dir, branchOf(dir, flags.get("branch")));
    if (!pushed.ok) return failed(`${lines[0]}, but the checkout did not reach it: ${pushed.error.message}`);
    lines.push(`${dir} is in it at ${pushed.value.slice(0, 12)}`);
  }
  return done(lines);
};

const exec = async (d: CliDeps, argv: readonly string[]): Promise<CliResult> => {
  const { flags, words, rest } = parse(argv, []);
  if (!words[0] || rest.length === 0) return refused("exec needs a name and a command after --", ...USAGE);
  const link = linked(d.launcher, words[0]);
  if (typeof link === "string") return failed(link);
  // One word after `--` is a shell line; several are a program and its arguments, unparsed.
  const r = await boxOf(link).run(rest.length === 1 ? rest[0]! : rest, { cwd: flags.get("cwd") ?? "/", onOutput: d.write });
  return r.code === 0 ? done() : { code: r.code ?? 1, lines: r.code === null ? [`the command did not finish: ${r.out.split("\n").at(-1)}`] : [] };
};

const carry = async (d: CliDeps, argv: readonly string[], way: "push" | "pull"): Promise<CliResult> => {
  const { flags, words } = parse(argv, []);
  const [name, dir] = words;
  if (!name || !dir) return refused(`${way} needs a name and a checkout`, ...USAGE);
  const link = linked(d.launcher, name);
  if (typeof link === "string") return failed(link);
  const box = boxOf(link), branch = branchOf(dir, flags.get("branch"));
  const r = way === "push" ? await box.push(dir, branch) : await box.pull(dir, branch, flags.get("message") ?? `sandbox: work from ${name}`);
  return r.ok ? done([`${dir} ${way === "push" ? "is in" : "has the commits of"} ${name} at ${r.value.slice(0, 12)}`]) : failed(r.error.message);
};

const ls = async (d: CliDeps, argv: readonly string[]): Promise<CliResult> => {
  const all = await d.launcher.list();
  if (!all.ok) return failed(all.error.message);
  if (parse(argv, ["json"]).flags.has("json")) return done([JSON.stringify(all.value)]);
  return done(all.value.length ? all.value.map((b) => row(b, d.now())) : ["no boxes"]);
};

const down = async (d: CliDeps, argv: readonly string[]): Promise<CliResult> => {
  const { flags, words } = parse(argv, ["all"]);
  let names = words;
  if (flags.has("owner") || flags.has("all")) {
    const all = await d.launcher.list();
    if (!all.ok) return failed(all.error.message);
    names = all.value.filter((b) => flags.has("all") || b.owner === flags.get("owner")).map((b) => b.name);
  }
  if (!words.length && !flags.has("owner") && !flags.has("all")) return refused("down needs names, --owner <who> or --all", ...USAGE);
  for (const n of names) await d.launcher.stop(n);
  return done([names.length ? `down: ${names.join(", ")}` : "no box to take down"]);
};

const sweep = async (d: CliDeps, argv: readonly string[]): Promise<CliResult> => {
  const dryRun = parse(argv, ["dry-run"]).flags.has("dry-run");
  const r = await reap(d.launcher, { now: d.now(), dryRun });
  if (!r.ok) return failed(r.error.message);
  return done(r.value.length ? r.value.map((g) => `${dryRun ? "would take down" : "took down"} ${g.box.name} (${g.box.owner}): ${g.why}`) : ["nothing to reap"]);
};

const COMMANDS: Readonly<Record<string, (d: CliDeps, argv: readonly string[]) => Promise<CliResult>>> = {
  up, exec, ls, down, reap: sweep, push: (d, a) => carry(d, a, "push"), pull: (d, a) => carry(d, a, "pull"),
};

export const sandboxCli = async (argv: readonly string[], d: CliDeps): Promise<CliResult> => {
  const run = COMMANDS[argv[0] ?? ""];
  return run ? run(d, argv.slice(1)) : refused(...USAGE);
};
