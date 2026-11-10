// The world's clock: `world clock show|set|advance|reset <world>`. It belongs to the world, so one command moves the chain and EVERY company's
// site in it together: the chain (anvil's time controls; one block is mined so blocks carry the world's time), then each site (capxul/clock.py;
// `advance` also runs what falls due at each day on the way, one process per site, in parallel), then the world's one clock file on the bench.
// Admin of a world, in the spike, is the operator account (`--as operator`).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "./args.ts";
import { publicClient } from "./chain.ts";
import type { Out } from "./doc.ts";
import { config } from "./config.ts";
import { CliError, refuse } from "./errors.ts";
import { loadJson } from "./store.ts";
import { touched, trace } from "./trace.ts";
import { offsetMs, setOffset, siteOf, world, worldNowMs } from "./world.ts";

const exec = promisify(execFile);
const py = (v: unknown): string => v === null ? "None" : v === true ? "True" : v === false ? "False" : JSON.stringify(v);
export async function bench(site: string, fn: string, kw: Record<string, unknown>): Promise<any> {
  const kwargs = `{${Object.entries(kw).map(([k, v]) => `"${k}": ${py(v)}`).join(", ")}}`;
  let stdout: string;
  try { ({ stdout } = await exec(config.benchExecScript, [site, fn, kwargs], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 })); }
  catch (e: any) { throw new CliError(`the site ${site} could not run ${fn}: ${String(e.stderr || e.message).slice(-300)}`, "FRAPPE_FAILED"); }
  // a job that prints progress with carriage returns (search indexing) leaves the answer on the same line: take the last piece
  try { return JSON.parse(stdout.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).pop()!); } catch { throw new CliError(`${fn} on ${site} answered something that is not JSON: ${stdout.slice(0, 200)}`, "FRAPPE_FAILED"); }
}
// the companies of this world (Core's outbox knows every org it was told about)
export const companies = (): string[] => Object.entries(loadJson<{ orgs: Record<string, { released?: boolean }> }>("outbox.json", { orgs: {} }).orgs).filter(([, o]) => o.released).map(([k]) => k);
async function chainRpc(method: string, params: unknown[]): Promise<void> { await (publicClient as any).request({ method, params }); }
export async function chainTime(): Promise<string> { return new Date(Number((await publicClient.getBlock()).timestamp) * 1000).toISOString(); }

// The world's admin: in the spike the operator account (a real world has its own admin hat on its own chain).
export function requireOperator(as: string | true | undefined, what: string): void {
  if (as === undefined || as === true) throw refuse("NEEDS_PERSON", `usage: ${what} --as operator`);
  touched.actor = as;
  if (as !== "operator") throw refuse("NOT_WORLD_ADMIN", `refused: ${as} is not the admin of world ${world} (in the spike that is the operator: --as operator). Nothing was changed.`);
}
export function parseDuration(s: string): number {
  const m = /^(\d+)(s|m|h|d|w)$/.exec(s);
  if (!m) throw refuse("USAGE", `a duration is a number and one of s, m, h, d, w (for example 30d); got ${s}`);
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2] as "s"];
}
const need = (a: string[], n: number, usage: string) => { const p = parseArgs(a); if (p.pos.length < n) throw refuse("USAGE", `usage: ${usage}`); return p; };
const asOf = (s: unknown) => (typeof s === "string" ? s : undefined);

export async function clockShow(args: string[]): Promise<Out> {
  need(args, 1, "world clock show <world>");
  const sites = await Promise.all(companies().map(async (c) => {
    const j = await fetch(`${config.frappeUrl}/api/method/capxul.clock.now`, { headers: { "x-frappe-site-name": siteOf(c), "x-capxul-trace": trace } }).then((r) => r.json()).then((x: any) => x.message).catch(() => null);
    return { company: c, site: siteOf(c), now: j?.world_local ?? "unreachable", today: j?.nowdate, tz: j?.tz, world: j?.world };
  }));
  const data = { world, time: new Date(worldNowMs()).toISOString(), offsetMs: offsetMs(), host: new Date().toISOString(), chainLatestBlock: await chainTime(), sites };
  return { data, lines: [`world ${world}: ${data.time} (host ${data.host}, offset ${Math.round(data.offsetMs / 1000)} s)`, `chain latest block ${data.chainLatestBlock}`, ...sites.map((s) => `site ${s.site}: ${s.now} ${s.tz ?? ""}`)] };
}

async function move(targetMs: number, kind: "set" | "advance", step: number): Promise<Out> {
  const t0 = Date.now(), before = worldNowMs(), fromOffset = offsetMs();
  let newOffset = targetMs - Date.now(); if (Math.abs(newOffset) < 2000) newOffset = 0;
  const sites = companies().map(siteOf);
  const first = sites[0];
  await chainRpc("anvil_setTime", [Math.floor(targetMs / 1000)]);
  await chainRpc("evm_mine", []);
  if (kind === "set" && first) await bench(first, "capxul.clock.write_world", { world, offset_ms: newOffset });   // before the rewind, which reads the new time
  const per = await Promise.all(sites.map((s) => kind === "advance"
    ? bench(s, "capxul.clock.advance", { from_offset_ms: fromOffset, to_offset_ms: newOffset, step_days: step, trace_id: trace })
    : (targetMs < before ? bench(s, "capxul.clock.rewind_jobs", {}) : Promise.resolve({}))));
  if (kind === "advance" && first) await bench(first, "capxul.clock.write_world", { world, offset_ms: newOffset });   // the one write every site of the world reads
  setOffset(newOffset);
  const data = { world, from: new Date(before).toISOString(), to: new Date(targetMs).toISOString(), chainBlock: await chainTime(), sites: sites.length,
    ...(kind === "advance" ? { stopsPerSite: per[0]?.stops, jobsRun: per.reduce((n: number, p: any) => n + (p.jobs_run ?? 0), 0) } : {}), ms: Date.now() - t0 };
  touched.extra.clock = { world, from: data.from, to: data.to };
  return { data, lines: [`world ${world} ${data.from} -> ${data.to} in ${data.ms} ms; chain block at ${data.chainBlock}; ${sites.length} sites${kind === "advance" ? `; ${data.stopsPerSite} stops each, ${data.jobsRun} scheduled jobs ran` : ""}`] };
}
export async function clockSet(args: string[]): Promise<Out> {
  const { pos, flags } = need(args, 2, "world clock set <world> <iso time> --as operator");
  requireOperator(asOf(flags.as), "world clock set <world> <iso time>");
  const t = Date.parse(pos[1]!);
  if (Number.isNaN(t)) throw refuse("USAGE", `not a time: ${pos[1]} (use ISO, for example 2026-03-02T09:00:00Z)`);
  return move(t, "set", 1);
}
export async function clockAdvance(args: string[]): Promise<Out> {
  const { pos, flags } = need(args, 2, "world clock advance <world> <duration> --as operator [--step 1d]");
  requireOperator(asOf(flags.as), "world clock advance <world> <duration>");
  const step = typeof flags.step === "string" ? Math.max(1, Math.round(parseDuration(flags.step) / 864e5)) : 1;
  return move(worldNowMs() + parseDuration(pos[1]!), "advance", step);
}
export async function clockReset(args: string[]): Promise<Out> {
  const { flags } = need(args, 1, "world clock reset <world> --as operator");
  requireOperator(asOf(flags.as), "world clock reset <world>");
  return move(Date.now(), "set", 1);
}
