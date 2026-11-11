// CLI commands. They return lines; main.ts prints and sets the exit code.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { isAddress, type Address, type Hex } from "viem";
import { deployment, publicClient, sendPayment, syncTime, toUnits, touchChainTx, wears } from "./chain.ts";
import { config } from "./config.ts";
import { CliError, refuse } from "./errors.ts";
import { sign } from "./hmac.ts";
import { touched, trace } from "./trace.ts";
import { siteOf, world } from "./world.ts";
import { byEmail, operatorKey } from "./people.ts";

const exec = promisify(execFile);
export { CliError };

export async function core(path: string, body: unknown): Promise<any> {
  const raw = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(`${config.coreUrl}${path}`, { method: "POST", headers: { "x-capxul-signature": sign(raw), "content-type": "application/json", "x-capxul-trace": trace }, body: raw, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new CliError(`Core stub is not reachable at ${config.coreUrl} (${(e as Error).message}). Start it with core/bin/up.sh`, "CORE_UNREACHABLE");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new CliError(`Core ${path} answered ${res.status}: ${JSON.stringify(j)}`, "CORE_REFUSED", res.status < 500, j);
  return j;
}

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
export const person = (email: string) => byEmail(email) ?? (() => { throw refuse("UNKNOWN_PERSON", `unknown person ${email} (see core/people.json)`); })();

// The admin recorded for the org (Core keeps it, set by org create), unless --as names someone.
async function actingAdmin(slug: string, as?: string) {
  if (as) { touched.actor = as; return person(as); }
  const info = await core("/admin/org-info", { slug });
  if (!info.adminEmail) throw refuse("NO_ADMIN", `Core has no admin recorded for ${slug}; pass --as <email>`);
  touched.actor = info.adminEmail;
  return person(info.adminEmail);
}

async function ensureOnChain(slug: string, admin: string, budget: string, fund: string): Promise<{ safe: Address; created: boolean }> {
  const d = deployment();
  await syncTime();
  const { v4EnsureOrg } = await import("./v4.ts");
  return v4EnsureOrg(slug, person(admin), toUnits(budget), toUnits(fund), d.usdc);
}

export async function orgCreate(args: string[]): Promise<string[]> {
  const [slug, name] = args;
  const admin = flag(args, "admin");
  if (!slug || !name || !admin) throw refuse("USAGE", 'usage: org create <slug> "<company name>" --admin <email> [--budget 10000] [--fund 50000]');
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) throw refuse("USAGE", "slug must be lowercase letters, digits and dashes");
  person(admin);
  touched.actor = admin;
  if (!existsSync(config.newSiteScript)) {
    throw new CliError(`the Frappe half's script does not exist yet: ${config.newSiteScript}. Nothing was created.`, "NO_SCRIPT");
  }
  const up = await fetch(`${config.coreUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  if (!up) throw new CliError(`Core stub is not reachable at ${config.coreUrl}. Start it with core/bin/up.sh. Nothing was created.`, "CORE_UNREACHABLE");

  const out: string[] = [];
  const { safe, created } = await ensureOnChain(slug, admin, flag(args, "budget") ?? "10000", flag(args, "fund") ?? "50000");
  out.push(created ? `chain: org ${slug} minted by Companies House, Safe ${safe}, ${admin} wears admin`
    : `chain: org ${slug} already on the chain, reusing Safe ${safe}`);
  await core("/admin/org", { slug, name, safe, adminEmail: admin });

  // a company template (frappe/bin/template-build.sh) makes the site by restoring it, about three times faster; no template, or --no-template, or a script named in NEW_SITE_SCRIPT: the full build
  const fromTemplate = !process.env.NEW_SITE_SCRIPT && !args.includes("--no-template") && existsSync(`${config.templateDir}/template.json`);
  const script = fromTemplate ? config.newSiteFromTemplateScript : config.newSiteScript;
  out.push(`frappe: running ${script}${fromTemplate ? " (from the company template)" : ""}`);
  let stdout: string;
  try {
    ({ stdout } = await exec(script, [slug, name, safe, admin], { env: { ...process.env, TEMPLATE_DIR: config.templateDir, SITE_NAME: siteOf(slug), CAPXUL_WORLD: world, CAPXUL_CORE_URL: `http://host.docker.internal:${config.corePort}` }, maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 }));
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
  if (!slug || !hatName || !email) throw refuse("USAGE", `usage: hat ${kind} <slug> <hat> <email> [--department <name>] [--as <admin email>]`);
  const dept = flag(args, "department") ?? "";
  const admin = await actingAdmin(slug, flag(args, "as"));
  // --address: a wearer Core has no person for (the end-to-end script's poison event, B4g)
  const wearer = (flag(args, "address") ?? person(email).address) as Address;
  if (!(await wears(slug, admin.address as Address, "admin"))) throw refuse("CHAIN_REFUSED", `chain refused hat ${kind}: NotAdmin (${admin.email} does not wear admin in ${slug})`);
  await syncTime();
  const { v4Hat } = await import("./v4.ts");
  try {
    const hash = await v4Hat(kind, slug, hatName, wearer, dept);
    touchChainTx(hash, `hat ${kind}`);
    return [`chain: ${hatName} ${kind === "grant" ? "granted to" : "revoked from"} ${email}${dept ? ` (${dept})` : ""} by the Board at ${admin.email}'s request, tx ${hash}`];
  } catch (e) {
    throw refuse("CHAIN_REFUSED", `chain refused hat ${kind}: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}`);
  }
}
export const hatGrant = (a: string[]) => hat("grant", a);
export const hatRevoke = (a: string[]) => hat("revoke", a);

export async function eventsStatus(args: string[]): Promise<string[]> {
  if (!args[0]) throw refuse("USAGE", "usage: events status <slug>");
  const s = await core("/admin/status", { slug: args[0] });
  return [`org ${s.slug}: released=${s.released} last_seq=${s.lastSeq} applied=${s.applied} pending=${s.pending.length}`,
    ...s.pending.map((p: any) => `  pending seq ${p.seq} ${p.kind} attempts=${p.attempts}${p.lastError ? ` error: ${p.lastError}` : ""}`)];
}
export async function eventsResend(args: string[]): Promise<string[]> {
  if (!args[0]) throw refuse("USAGE", "usage: events resend <slug>");
  const s = await core("/admin/resend", { slug: args[0] });
  return [`resend triggered; now last_seq=${s.lastSeq} applied=${s.applied} pending=${s.pending.length}`];
}

// A payment on the chain with no Frappe document: the "unmatched bank line" case.
export async function payDirect(args: string[]): Promise<string[]> {
  const [slug, to, amount] = args;
  if (!slug || !to || !amount) throw refuse("USAGE", "usage: pay direct <slug> <to address|email> <amount> [--as <email>]");
  const toAddr = isAddress(to) ? to : person(to).address;
  const admin = await actingAdmin(slug, flag(args, "as"));
  const documentHash = `0x${randomBytes(32).toString("hex")}` as Hex;
  const r = await sendPayment({ org: slug, to: toAddr as Address, amount: toUnits(amount), documentHash, privateKey: admin.privateKey });
  if (!r.ok) throw refuse("CHAIN_REFUSED", `chain refused the payment: ${r.reason} (${r.detail})`, { reason: r.reason });
  return [`chain: ${amount} USDC from ${slug}'s Safe to ${toAddr}, document hash ${documentHash} (no Frappe document), tx ${r.txHash}`];
}

// Test seam: make Core offer one event again (a repeat delivery), so the end-to-end run can prove it posts once.
export async function eventsRedeliver(args: string[]): Promise<string[]> {
  if (!args[0] || !args[1]) throw refuse("USAGE", "usage: events redeliver <slug> <seq>");
  await core("/admin/redeliver", { slug: args[0], seq: Number(args[1]) });
  return [`redelivered seq ${args[1]} of ${args[0]}`];
}

// Feature switches. The admin hat is checked on the chain stand-in; the site service (frappe/bin/feature.sh) does the work.
async function featureScript(slug: string, args: string[]): Promise<{ site: string; features: Record<string, string> }> {
  let stdout: string;
  try {
    ({ stdout } = await exec(config.featureScript, [slug, ...args], { env: { ...process.env, TRACE_ID: trace, SITE_NAME: siteOf(slug) }, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }));
  } catch (e: any) {
    const why = String(e.stderr || e.message).trim().split("\n").filter((l) => !/^\[\d+s\]/.test(l)).slice(-3).join(" ");
    throw e.code === 3 ? refuse("REFUSED_BY_SITE", `refused by the site: ${why}`) : new CliError(`feature.sh failed (exit ${e.code}): ${why}`, "FEATURE_SCRIPT_FAILED");
  }
  const last = stdout.trim().split("\n").pop() ?? "";
  try { return JSON.parse(last); } catch { throw new CliError(`feature.sh exited 0 but its last line is not JSON: ${last.slice(0, 200)}`); }
}
const showFeatures = (r: { site: string; features: Record<string, string> }) =>
  [`site ${r.site}`, ...Object.entries(r.features).map(([f, s]) => `  ${f.padEnd(14)} ${s}`)];

export async function featureList(args: string[]): Promise<string[]> {
  if (!args[0]) throw refuse("USAGE", "usage: feature list <slug>");
  return showFeatures(await featureScript(args[0], ["list"]));
}
async function featureSwitch(kind: "on" | "off", args: string[]): Promise<string[]> {
  const [slug, feature] = args;
  const as = flag(args, "as");
  if (!slug || !feature || !as) throw refuse("USAGE", `usage: feature ${kind} <slug> <feature> --as <admin email>`);
  const who = person(as);
  touched.actor = as;
  const isAdmin = await wears(slug, who.address as Address, "admin");
  if (!isAdmin) throw refuse("NOT_ADMIN", `refused: ${as} does not wear the admin hat in ${slug} on the chain, so cannot turn ${feature} ${kind}. Nothing was changed.`);
  return [`chain: ${as} wears admin in ${slug}`, ...showFeatures(await featureScript(slug, [kind, feature]))];
}
export const featureOn = (a: string[]) => featureSwitch("on", a);
export const featureOff = (a: string[]) => featureSwitch("off", a);

// What Core knows of the org: its name, its Safe and its admin (one line each, `--json` gives them as one object).
export async function orgShow(args: string[]): Promise<string[]> {
  const [slug] = args;
  if (!slug) throw refuse("USAGE", "usage: org show <slug>");
  const info = await core("/admin/org-info", { slug });
  if (!info.safe) throw refuse("UNKNOWN_ORG", `Core knows no org ${slug}`);
  return [`org ${info.slug}: ${info.name ?? ""}`, `safe ${info.safe}`, `admin ${info.adminEmail ?? "-"}`];
}

// The company's Safe as the chain itself says it is (the end-to-end script's B1 checks): the CompanySafeMinted event
// Companies House emitted for the company's founder and name. The first line is what the chain says (the event's Safe and
// founderSafe, the founder's personal Safe by the claimer, the company Safe's owners); the last line is the Safe alone.
export async function orgChainSafe(args: string[]): Promise<string[]> {
  const [slug] = args;
  if (!slug) throw refuse("USAGE", "usage: org chain-safe <slug>");
  const { proto, v4Org } = await import("./v4.ts");
  const { companySafeMinted, founderSafeOf } = await import("../../../../packages/devnet/src/modules/company/service.ts");
  const { SAFE_ABI } = await import("../../../../packages/devnet/src/modules/protocol/service.ts");
  const info = await core("/admin/org-info", { slug });
  if (!v4Org(slug) || !info.adminEmail) throw refuse("UNKNOWN_ORG", `no company ${slug} on the chain`);
  const p = await proto();
  const minted = await companySafeMinted(p, info.adminEmail, slug);
  if (!minted) throw refuse("UNKNOWN_ORG", `Companies House emitted no CompanySafeMinted for ${slug} founded by ${info.adminEmail}`);
  if ((await publicClient.getCode({ address: minted.safe })) === undefined) throw refuse("UNKNOWN_ORG", `the Safe minted for ${slug} (${minted.safe}) has no code`);
  const owners = await publicClient.readContract({ address: minted.safe, abi: SAFE_ABI, functionName: "getOwners" }) as string[];
  const facts = { safe: minted.safe, founderSafe: minted.founderSafe, founderPersonalSafe: await founderSafeOf(p, info.adminEmail), owners, mintTx: minted.txHash };
  return [JSON.stringify(facts), minted.safe];
}
