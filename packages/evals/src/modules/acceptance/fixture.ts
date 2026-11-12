import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const alertIds = ["indexer_unready", "delivery_stuck", "money_event_parked"] as const;
export type AlertId = typeof alertIds[number];
export type Command = readonly [string, ...string[]];
export interface Fixture {
  version: 1;
  disposable: true;
  world: string;
  slug: string;
  site: string;
  frappeUrl: string;
  coreUrl: string;
  rpcUrl: string;
  cookieJar: string;
  user: string;
  company: string;
  supplier: string;
  invoice: string;
  paymentEntry: string;
  txHash: string;
  safe: string;
  token: string;
  safeAccount: string;
  amountAtomic: string;
  load: Command;
  faults: Record<AlertId, { seed: Command; repair: Command }>;
}

/** No production endpoint or main world is an acceptable fault-injection target. */
export function localUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.hostname.endsWith(".localhost"))
    throw new Error("acceptance requires an HTTP loopback test endpoint");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("endpoint must be a plain local origin");
  return url;
}

export function fixtureFrom(path: string, slug: string): Fixture {
  const f = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  if (f.version !== 1 || f.disposable !== true || !f.world || f.world === "main" || f.slug !== slug)
    throw new Error("fixture must name this slug and a disposable non-main world");
  for (const key of ["site", "cookieJar", "user", "company", "supplier", "invoice", "paymentEntry", "safeAccount"] as const)
    if (typeof f[key] !== "string" || !f[key]) throw new Error(`fixture needs ${key}`);
  if (f.user === "Administrator" || !f.site.endsWith(".localhost")) throw new Error("fixture needs a hat user on a local test site");
  for (const key of ["frappeUrl", "coreUrl", "rpcUrl"] as const) localUrl(f[key]);
  for (const key of ["safe", "token"] as const) if (!/^0x[0-9a-fA-F]{40}$/.test(f[key])) throw new Error(`invalid ${key}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(f.txHash)) throw new Error("invalid payment transaction");
  if (!/^[1-9][0-9]*$/.test(f.amountAtomic) || BigInt(f.amountAtomic) % 10000n !== 0n) throw new Error("slice zero uses positive cent-exact six-decimal USDC");
  const command = (c: Command) => { if (!Array.isArray(c) || !c.length || c.some((s) => typeof s !== "string" || !s)) throw new Error("seed, repair and load must be nonempty argv arrays"); };
  command(f.load);
  for (const id of alertIds) { command(f.faults?.[id]?.seed); command(f.faults?.[id]?.repair); }
  f.cookieJar = isAbsolute(f.cookieJar) ? f.cookieJar : resolve(path, "..", f.cookieJar);
  return f;
}

export function sessionCookie(path: string): string {
  const row = readFileSync(path, "utf8").split("\n").map((l) => l.replace(/^#HttpOnly_/, ""))
    .filter((l) => !l.startsWith("#")).map((l) => l.split("\t")).find((v) => v[5] === "sid");
  if (!row?.[6] || row[6] === "Guest") throw new Error("fixture has no signed-in Frappe session");
  return row[6];
}
