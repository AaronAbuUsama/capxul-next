// CLI commands. They return lines; main.ts prints and sets the exit code.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { isAddress, type Address, type Hex } from "viem";
import { abis, deployment, orgId, publicClient, sendPayment, toUnits, wallet } from "./chain.ts";
import { config } from "./config.ts";
import { sign } from "./hmac.ts";
import { byEmail, operatorKey } from "./people.ts";

const exec = promisify(execFile);
export class CliError extends Error {}

async function core(path: string, body: unknown): Promise<any> {
  const raw = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(`${config.coreUrl}${path}`, { method: "POST", headers: { "x-capxul-signature": sign(raw), "content-type": "application/json" }, body: raw, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new CliError(`Core stub is not reachable at ${config.coreUrl} (${(e as Error).message}). Start it with core/bin/up.sh`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new CliError(`Core ${path} answered ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const person = (email: string) => byEmail(email) ?? (() => { throw new CliError(`unknown person ${email} (see core/people.json)`); })();

// The admin recorded for the org (Core keeps it, set by org create), unless --as names someone.
async function actingAdmin(slug: string, as?: string) {
  if (as) return person(as);
  const info = await core("/admin/org-info", { slug });
  if (!info.adminEmail) throw new CliError(`Core has no admin recorded for ${slug}; pass --as <email>`);
  return person(info.adminEmail);
}

async function ensureOnChain(slug: string, admin: string, budget: string, fund: string): Promise<{ safe: Address; created: boolean }> {
  const d = deployment();
  const id = orgId(slug);
  const existing = await publicClient.readContract({ address: d.payments, abi: abis.payments, functionName: "safeOf", args: [id] }) as Address;
  if (/^0x0{40}$/.test(existing)) {
    const op = wallet(operatorKey);
    const hash = await op.writeContract({ address: d.orgs, abi: abis.orgs, functionName: "createOrg",
      args: [slug, person(admin).address as Address, toUnits(budget), toUnits(fund)] });
    await publicClient.waitForTransactionReceipt({ hash });
    const safe = await publicClient.readContract({ address: d.payments, abi: abis.payments, functionName: "safeOf", args: [id] }) as Address;
    return { safe, created: true };
  }
  return { safe: existing, created: false };
}

export async function orgCreate(args: string[]): Promise<string[]> {
  const [slug, name] = args;
  const admin = flag(args, "admin");
  if (!slug || !name || !admin) throw new CliError('usage: org create <slug> "<company name>" --admin <email> [--budget 10000] [--fund 50000]');
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) throw new CliError("slug must be lowercase letters, digits and dashes");
  person(admin);
  if (!existsSync(config.newSiteScript)) {
    throw new CliError(`the Frappe half's script does not exist yet: ${config.newSiteScript}. Nothing was created.`);
  }
  const up = await fetch(`${config.coreUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  if (!up) throw new CliError(`Core stub is not reachable at ${config.coreUrl}. Start it with core/bin/up.sh. Nothing was created.`);

  const out: string[] = [];
  const { safe, created } = await ensureOnChain(slug, admin, flag(args, "budget") ?? "10000", flag(args, "fund") ?? "50000");
  out.push(created ? `chain: org ${slug} registered, Safe stand-in ${safe}, ${admin} wears admin`
    : `chain: org ${slug} already registered, reusing Safe stand-in ${safe}`);
  await core("/admin/org", { slug, name, safe, adminEmail: admin });

  out.push(`frappe: running ${config.newSiteScript}`);
  let stdout: string;
  try {
    ({ stdout } = await exec(config.newSiteScript, [slug, name, safe, admin], { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 }));
  } catch (e: any) {
    throw new CliError(`new-site.sh failed (exit ${e.code}) for ${slug}. The org is on the chain and held; re-run this command to retry.\n${String(e.stderr || e.message).slice(-1500)}`);
  }
  const last = stdout.trim().split("\n").pop() ?? "";
  let site: { site: string; url: string };
  try { site = JSON.parse(last); } catch { throw new CliError(`new-site.sh exited 0 but its last line is not JSON: ${last.slice(0, 200)}`); }
  out.push(`frappe: site ${site.site} at ${site.url}`);

  await core("/admin/release", { slug });
  out.push(`core: delivering ${slug}'s events from seq 1 (see: events status ${slug})`);
  out.push(JSON.stringify({ org: slug, safe, site: site.site, url: site.url, admin }));
  return out;
}

async function hat(kind: "grant" | "revoke", args: string[]): Promise<string[]> {
  const [slug, hatName, email] = args;
  if (!slug || !hatName || !email) throw new CliError(`usage: hat ${kind} <slug> <hat> <email> [--department <name>] [--as <admin email>]`);
  const dept = flag(args, "department") ?? "";
  const admin = await actingAdmin(slug, flag(args, "as"));
  const d = deployment();
  const w = wallet(admin.privateKey);
  const params = { address: d.hats, abi: abis.hats, functionName: kind, account: w.account,
    args: [orgId(slug), hatName, person(email).address as Address, dept] } as const;
  try {
    await publicClient.simulateContract(params);
    const hash = await w.writeContract(params);
    await publicClient.waitForTransactionReceipt({ hash });
    return [`chain: ${hatName} ${kind === "grant" ? "granted to" : "revoked from"} ${email}${dept ? ` (${dept})` : ""} by ${admin.email}, tx ${hash}`];
  } catch (e) {
    throw new CliError(`chain refused hat ${kind}: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}`);
  }
}
export const hatGrant = (a: string[]) => hat("grant", a);
export const hatRevoke = (a: string[]) => hat("revoke", a);

export async function eventsStatus(args: string[]): Promise<string[]> {
  if (!args[0]) throw new CliError("usage: events status <slug>");
  const s = await core("/admin/status", { slug: args[0] });
  return [`org ${s.slug}: released=${s.released} last_seq=${s.lastSeq} applied=${s.applied} pending=${s.pending.length}`,
    ...s.pending.map((p: any) => `  pending seq ${p.seq} ${p.kind} attempts=${p.attempts}${p.lastError ? ` error: ${p.lastError}` : ""}`)];
}
export async function eventsResend(args: string[]): Promise<string[]> {
  if (!args[0]) throw new CliError("usage: events resend <slug>");
  const s = await core("/admin/resend", { slug: args[0] });
  return [`resend triggered; now last_seq=${s.lastSeq} applied=${s.applied} pending=${s.pending.length}`];
}

// A payment on the chain with no Frappe document: the "unmatched bank line" case.
export async function payDirect(args: string[]): Promise<string[]> {
  const [slug, to, amount] = args;
  if (!slug || !to || !amount) throw new CliError("usage: pay direct <slug> <to address|email> <amount> [--as <email>]");
  const toAddr = isAddress(to) ? to : person(to).address;
  const admin = await actingAdmin(slug, flag(args, "as"));
  const documentHash = `0x${randomBytes(32).toString("hex")}` as Hex;
  const r = await sendPayment({ org: slug, to: toAddr as Address, amount: toUnits(amount), documentHash, privateKey: admin.privateKey });
  if (!r.ok) throw new CliError(`chain refused the payment: ${r.reason} (${r.detail})`);
  return [`chain: ${amount} USDC from ${slug}'s Safe to ${toAddr}, document hash ${documentHash} (no Frappe document), tx ${r.txHash}`];
}

// Test seam: make Core offer one event again (a repeat delivery), so the end-to-end run can prove it posts once.
export async function eventsRedeliver(args: string[]): Promise<string[]> {
  if (!args[0] || !args[1]) throw new CliError("usage: events redeliver <slug> <seq>");
  await core("/admin/redeliver", { slug: args[0], seq: Number(args[1]) });
  return [`redelivered seq ${args[1]} of ${args[0]}`];
}

// Feature switches. The admin hat is checked on the chain stand-in; the site service (frappe/bin/feature.sh) does the work.
async function featureScript(slug: string, args: string[]): Promise<{ site: string; features: Record<string, string> }> {
  let stdout: string;
  try {
    ({ stdout } = await exec(config.featureScript, [slug, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }));
  } catch (e: any) {
    const why = String(e.stderr || e.message).trim().split("\n").filter((l) => !/^\[\d+s\]/.test(l)).slice(-3).join(" ");
    throw new CliError(e.code === 3 ? `refused by the site: ${why}` : `feature.sh failed (exit ${e.code}): ${why}`);
  }
  const last = stdout.trim().split("\n").pop() ?? "";
  try { return JSON.parse(last); } catch { throw new CliError(`feature.sh exited 0 but its last line is not JSON: ${last.slice(0, 200)}`); }
}
const showFeatures = (r: { site: string; features: Record<string, string> }) =>
  [`site ${r.site}`, ...Object.entries(r.features).map(([f, s]) => `  ${f.padEnd(14)} ${s}`)];

export async function featureList(args: string[]): Promise<string[]> {
  if (!args[0]) throw new CliError("usage: feature list <slug>");
  return showFeatures(await featureScript(args[0], ["list"]));
}
async function featureSwitch(kind: "on" | "off", args: string[]): Promise<string[]> {
  const [slug, feature] = args;
  const as = flag(args, "as");
  if (!slug || !feature || !as) throw new CliError(`usage: feature ${kind} <slug> <feature> --as <admin email>`);
  const who = person(as);
  const d = deployment();
  const isAdmin = await publicClient.readContract({ address: d.hats, abi: abis.hats, functionName: "wears", args: [orgId(slug), who.address as Address, "admin"] }) as boolean;
  if (!isAdmin) throw new CliError(`refused: ${as} does not wear the admin hat in ${slug} on the chain, so cannot turn ${feature} ${kind}. Nothing was changed.`);
  return [`chain: ${as} wears admin in ${slug}`, ...showFeatures(await featureScript(slug, [kind, feature]))];
}
export const featureOn = (a: string[]) => featureSwitch("on", a);
export const featureOff = (a: string[]) => featureSwitch("off", a);
