import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, parseAbi, parseUnits, toBytes, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connect } from "../modules/chain/service.ts";
import * as companies from "../modules/company/service.ts";
import type { Company, Protocol } from "../modules/company/types.ts";
import { testKey } from "../modules/test-keys/service.ts";
import { command } from "./processes.ts";
import { loopback, signedCore, until, writeConfig, type Config } from "./supervisor.ts";

export type FixtureState = {
  slug: string; site: string; name: string; email: string; company: Company; budget: bigint;
  member?: { name: string; email: string; address: Hex; personalSafe: Hex };
  invoice?: string; paymentEntry?: string; txHash?: Hex; userOpHash?: Hex; safeAccount?: string;
};
const serialize = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
export const fixturePath = (c: Config) => join(c.controlDir, "fixture.json");
/** Caller credentials are inherited privately, never added to public argv or acceptance evidence. */
export const sitesEnvironment = (c: Config): NodeJS.ProcessEnv => ({
  CAPXUL_CORE_URL: loopback(c.ports.publicCore), CAPXUL_PRIVATE_KEY: testKey("founder").key,
  CAPXUL_SITES_ACTORS: join(c.controlDir, "sites-actors.json"),
});
async function writeSitesActors(c: Config, f: FixtureState) {
  assert(f.member, "selected fixture has no registered negative-control member");
  const actors = await open(sitesEnvironment(c).CAPXUL_SITES_ACTORS!, "w", 0o600);
  try {
    await actors.chmod(0o600);
    await actors.writeFile(JSON.stringify({ version: 1, world: { id: c.world.id, epoch: c.world.epoch }, org: f.slug, site: f.site,
      director: { name: "Harbourline Director", email: f.email, address: privateKeyToAccount(f.company.founderKey).address,
        personalSafe: f.company.founderSafe, privateKey: f.company.founderKey },
      member: { ...f.member, privateKey: testKey("second").key } }));
  } finally { await actors.close(); }
}
export async function persistFixture(c: Config, f: FixtureState) { await writeFile(fixturePath(c), serialize(f), { mode: 0o600 }); }
export async function readFixture(c: Config): Promise<FixtureState> {
  const f = JSON.parse(await readFile(fixturePath(c), "utf8"));
  for (const field of ["boardTopHat", "topBudget"]) f.company[field] = BigInt(f.company[field]);
  f.company.officerHats = f.company.officerHats.map(BigInt);
  f.budget = BigInt(f.budget);
  return f;
}
export async function protocol(c: Config): Promise<Protocol> {
  return { chain: await connect(loopback(c.ports.anvil)),
    record: JSON.parse(await readFile(join(c.root, "packages/contracts/deployments/devnet.json"), "utf8")),
    installerAbi: JSON.parse(await readFile(join(c.root, "packages/contracts/out/Installer.sol/Installer.json"), "utf8")).abi };
}
export async function bench(c: Config, site: string, method: string, args: unknown[] = [], kwargs?: object): Promise<any> {
  const text = await command(["docker", "compose", ...c.bench.composeArgs, "run", "--rm", "-T", "--no-deps", "site-admin", "bench",
    "--site", site, "execute", method, ...(kwargs ? ["--kwargs", JSON.stringify(kwargs)] : ["--args", JSON.stringify(args)])], c.root);
  // Native bench execute prints strings verbatim, structured values as JSON, and None as nothing.
  const marked = text.split("\n").findLast((line) => line.startsWith("JSON:"));
  if (marked) return JSON.parse(marked.slice(5));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
const single = (c: Config, site: string, field: string) => bench(c, site, "frappe.db.get_single_value", ["Capxul Settings", field]);

/** Independent diagnostic reads, not the provisioner's own success response. */
export async function verifySite(c: Config, f: FixtureState): Promise<void> {
  const [org, safe, account, bankName, company] = await Promise.all([
    single(c, f.site, "org_slug"), single(c, f.site, "safe_address"), single(c, f.site, "safe_account"), single(c, f.site, "safe_bank_account"),
    bench(c, f.site, "frappe.db.get_value", ["Company", { company_name: f.name }, ["name", "company_name", "default_currency"]]),
  ]);
  assert.equal(org, f.slug); assert.equal(String(safe).toLowerCase(), f.company.companySafe.toLowerCase());
  assert.deepEqual(company, [f.name, f.name, "USD"]);
  const [bank, ledgerCompany] = await Promise.all([
    bench(c, f.site, "frappe.db.get_value", ["Bank Account", bankName, ["company", "integration_id", "account", "is_company_account"]]),
    bench(c, f.site, "frappe.db.get_value", ["Account", account, "company"]),
  ]);
  assert.equal(bank[0], f.name); assert.equal(String(bank[1]).toLowerCase(), f.company.companySafe.toLowerCase());
  assert.equal(bank[2], account); assert.equal(bank[3], 1); assert.equal(ledgerCompany, f.name);
  f.safeAccount = account; await persistFixture(c, f);
}
export async function delivered(c: Config, f: FixtureState, replay?: any): Promise<void> {
  let status: any;
  await until("released company's acknowledged event stream", async () => {
    status = await signedCore(c, "/admin/status", { slug: f.slug });
    if (!(status.released === true && BigInt(status.last_seq) > 0n && BigInt(status.last_ack) === BigInt(status.last_seq) && !status.pending.length && status.events.every((e: any) => e.state === "applied"))) return false;
    // A fully acknowledged older stream says nothing about a newly mined payment not yet consumed by Core.
    if (f.txHash && !status.events.some((event: any) => event.kind === "payment_sent" &&
      event.event_key.startsWith(`${c.chainId}:${f.txHash!.toLowerCase()}:`) && event.state === "applied")) return false;
    // Native reads can outlast another delivery. Retry the pair rather than comparing a stale Core head afterward.
    if (BigInt(await single(c, f.site, "last_seq")) !== BigInt(status.last_ack)) return false;
    return !replay || BigInt(status.last_ack) >= BigInt(replay.last_seq) && replay.events.every((before: any) => {
      const event = status.events.find((after: any) => after.event_key === before.event_key && BigInt(after.seq) === BigInt(before.seq));
      return event?.state === "applied" && event.applied_at && !event.last_error && Number(event.attempts) > Number(before.attempts);
    });
  }, 180_000);
  const person = await bench(c, f.site, "frappe.db.get_value", ["User", f.email, "enabled"]);
  const grant = await bench(c, f.site, "frappe.db.exists", ["Capxul Hat Grant", { user: f.email }]);
  assert.equal(person, 1); assert(grant, "indexed personal-Safe hat did not create the fixture user");
}

/** Trusted chain birth is fixture setup. Supplier money below is NEVER sent by a direct transaction. */
export async function provisionFixture(c: Config, file: string, slug: string): Promise<FixtureState> {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) throw new Error("invalid company slug");
  let f: FixtureState;
  try { f = await readFixture(c); assert.equal(f.slug, slug, "this world already has a different fixture"); }
  catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const pending = join(c.controlDir, "fixture-pending.json");
    // A partial chain birth must be inspected, never silently repeated with different identity.
    await writeFile(pending, JSON.stringify({ slug }), { flag: "wx", mode: 0o600 });
    const p = await protocol(c), deployment = JSON.parse(await readFile(join(c.world.stateDir, "deployment.json"), "utf8"));
    const email = `${slug}@example.invalid`, name = `${slug} Ltd`;
    const company = await companies.createCompany(p, { founder: testKey("founder").key, relayer: testKey("deployer").key, tierService: testKey("tierService").key }, {
      founderEmail: email, company: name, token: deployment.usdc, officers: [{ details: "admin", maxSupply: 1 }],
      ceiling: 1_000_000_000n, topAmount: 1_000_000_000n, salt: `0x${randomBytes(32).toString("hex")}`,
    });
    await companies.grantHat(p, company, company.officerHats[0]!, company.founderSafe);
    const budget = await companies.createDepartment(p, company, company.officerHats[0]!);
    await companies.setBudget(p, company, budget, 500_000_000n);
    f = { slug, site: `${slug}-${c.world.id}.${c.bench.baseDomain}`, name, email, company, budget };
    await persistFixture(c, f);
    const { rm } = await import("node:fs/promises"); await rm(pending);
  }
  if (!c.world.sites.some((site) => site.company === slug)) { c.world.sites.push({ company: slug, name: f.site }); await writeConfig(file, c); }
  const p = await protocol(c);
  if (!f.member) {
    const email = `${slug}-member@example.invalid`, key = testKey("second");
    const personalSafe = await companies.claimPersonalSafe(p, testKey("tierService").key, email, key.address);
    f.member = { name: "Harbourline Member", email, address: key.address, personalSafe };
    await persistFixture(c, f);
  }
  const founder = { email: f.email, name: "Harbourline Director", address: privateKeyToAccount(f.company.founderKey).address, personalSafe: f.company.founderSafe };
  for (const hat of [f.company.boardTopHat, ...f.company.officerHats]) {
    assert.equal(await companies.wears(p, f.member.personalSafe, hat), false, "negative-control member must not wear a company hat");
  }
  await signedCore(c, "/admin/org", { slug, name: f.name, safe: f.company.companySafe, site: f.site, adminEmail: f.email, token: f.company.token,
    hats: { [f.company.officerHats[0]!.toString()]: { name: "admin" } },
    people: [founder, f.member] });
  await writeSitesActors(c, f);
  const caller: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...sitesEnvironment(c) };
  const result = JSON.parse(await command(["pnpm", "--silent", "capxul", "org", "site", "provision", "--org", slug, "--confirm", "--json"], c.root, caller));
  assert.equal(result.site, f.site); assert.equal(result.safe.toLowerCase(), f.company.companySafe.toLowerCase()); assert.equal(result.state, "provisioned");
  await verifySite(c, f);
  const clock = JSON.parse(await readFile(join(c.world.stateDir, "clock.json"), "utf8"));
  assert.equal(clock.clockMode, "stopped");
  await bench(c, f.site, "capxul.clock.write_world", [], { world: c.world.id, offset_ms: 0, frozen_at_ms: clock.nowMs, rate: clock.rate });
  // An indexed mint, not a current balance, identifies the one fixture funding even after money is spent.
  const abi = parseAbi(["function mint(address,uint256)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const funding = await p.chain.client.getContractEvents({ address: f.company.token, abi, eventName: "Transfer", args: { from: zeroAddress, to: f.company.companySafe }, fromBlock: 0n });
  if (!funding.length) {
    const hash = await p.chain.walletFor(testKey("deployer").key).writeContract({ address: f.company.token, abi, functionName: "mint", args: [f.company.companySafe, 500_000_000n] });
    await p.chain.client.waitForTransactionReceipt({ hash });
  }
  await delivered(c, f);
  return f;
}

export async function asPerson(c: Config, f: FixtureState, method: string, data: object): Promise<any> {
  const raw = JSON.stringify({ u: f.email, s: f.site, exp: Math.floor(Date.now() / 1000) + 60 });
  const assertion = `${Buffer.from(raw).toString("base64url")}.${createHmac("sha256", c.secret).update(raw).digest("hex")}`;
  const res = await fetch(`${loopback(c.ports.bench)}/api/method/${method}`, { method: "POST", body: JSON.stringify(data),
    headers: { "Content-Type": "application/json", "X-Frappe-Site-Name": f.site, "X-Capxul-Assertion": assertion }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`hat-holder ${method} refused (${res.status})`);
  return (await res.json() as any).message;
}
export async function preparePayment(c: Config, f: FixtureState, amount: number) {
  const made = await bench(c, f.site, "capxul.testutil.make_payable", [], { wallet: testKey("payee").address, amount, supplier: "Harbourline Supplier" });
  const request = await asPerson(c, f, "capxul.api.request_payment", { name: made.pe });
  assert.equal(request.safe, true);
  let row: any;
  await until("Core collected and answered the committed payment request", async () => {
    row = await bench(c, f.site, "frappe.db.get_value", ["Capxul Payment Request", request.request, ["approval_id", "status"]]);
    return row?.[0] && row[1] === "Waiting for signature";
  });
  return { ...made, approval: await signedCore(c, "/approvals/get", { org: f.slug, id: row[0] }) };
}

export function requirePaymentSlot(c: Config) {
  if (c.world.kind !== "local" || c.world.id === "main") throw new Error("slice-zero execution requires a disposable non-main local world");
  if (!c.bundler?.paymaster || !/^0x[0-9a-fA-F]{40}$/.test(c.bundler.paymaster)) throw new Error("real bundler argv/url and deployed funded paymaster required; no direct transaction fallback");
}
export async function submitPayment(c: Config, f: FixtureState, approval: any) {
  requirePaymentSlot(c);
  const p = await protocol(c);
  assert.equal(approval.org, f.slug); assert.equal(approval.site, f.site); assert.equal(approval.requested_by, f.email);
  const result = await companies.payByUserOp(p, { safe: f.company.founderSafe, ownerKey: testKey("founder").key,
    paymaster: c.bundler!.paymaster as Hex, submit: companies.viaBundler(c.bundler!.url), budget: f.budget,
    to: approval.to_address, amount: parseUnits(approval.amount, 6), kind: 1,
    documentHash: approval.document_hash, jobNonce: keccak256(toBytes(approval.id)) });
  assert(result.ok && result.userOpHash && /^0x[0-9a-fA-F]{64}$/.test(result.userOpHash), "real successful UserOperation and PaymentSent required");
  await signedCore(c, "/approvals/submitted", { org: f.slug, id: approval.id, signer: f.email, txHash: result.txHash });
  return { ...result, userOpHash: result.userOpHash };
}

export async function settledPayment(c: Config, f: FixtureState): Promise<void> {
  assert(f.invoice && f.paymentEntry && f.txHash);
  await delivered(c, f);
  await until("selected transaction's native payment settlement", async () => {
    const state = await bench(c, f.site, "capxul.testutil.state", [], { pe: f.paymentEntry, pi: f.invoice });
    return state.pe.docstatus === 1 && state.pe.capxul_status === "Sent" &&
      state.pe.reference_no?.toLowerCase() === f.txHash!.toLowerCase() && Number(state.outstanding) === 0 && Number(state.safe_credit) === 125.5;
  }, 180_000);
}

/** Native Frappe one-time login, after the real on-chain hat has created the user. No password/Administrator session. */
export async function acceptanceFixture(c: Config, f: FixtureState, configFile: string, snapshot: string): Promise<string> {
  await settledPayment(c, f);
  await writeSitesActors(c, f);
  const link = await bench(c, f.site, "frappe.www.login._generate_temporary_login_link", [], { email: f.email, expiry: 5 });
  const path = new URL(link, loopback(c.ports.publicBench));
  const response = await fetch(new URL(path.pathname + path.search, loopback(c.ports.publicBench)), { redirect: "manual", headers: { "X-Frappe-Site-Name": f.site } });
  const sid = response.headers.getSetCookie().map((cookie) => /^sid=([^;]+)/.exec(cookie)?.[1]).find((value) => value && value !== "Guest");
  assert(sid, "native Frappe login did not create a hat-holder session");
  const cookieJar = join(c.controlDir, "acceptance.cookies");
  await writeFile(cookieJar, `# Netscape HTTP Cookie File\n${f.site}\tFALSE\t/\tFALSE\t0\tsid\t${sid}\n`, { mode: 0o600 });
  const argv = (action: string, ...args: string[]) => [process.execPath, "--experimental-strip-types", "--no-warnings", join(c.root, "packages/cli/src/main.ts"), "world", "fixture", action, ...args, "--config", configFile];
  const output = join(c.controlDir, "acceptance.json");
  await writeFile(output, JSON.stringify({ version: 1, disposable: true, world: "slice-zero", slug: f.slug, site: f.site,
    frappeUrl: loopback(c.ports.publicBench), coreUrl: loopback(c.ports.core), rpcUrl: loopback(c.ports.publicRpc), cookieJar,
    user: f.email, company: f.name, supplier: "Harbourline Supplier", invoice: f.invoice, paymentEntry: f.paymentEntry,
    txHash: f.txHash, safe: f.company.companySafe, token: f.company.token, safeAccount: f.safeAccount, amountAtomic: "125500000",
    load: argv("load", snapshot), faults: Object.fromEntries(["indexer_unready", "delivery_stuck", "money_event_parked"].map((id) => [id, { seed: argv("seed", id), repair: argv("repair", id) }])) }), { mode: 0o600 });
  return output;
}
