// The door: reach a company's Frappe site as a person. The person is vouched for with a signed assertion, valid 60 s, checked by the site
// (frappe/capxul/capxul/door.py). Nothing is stored for the person: no password, no key, no token; the only secret used is the shared one
// Core already holds. Errors come back as values (code, reason, what Frappe said), never a stack trace.
import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config.ts";
import { CliError } from "./errors.ts";
import { person } from "./cli.ts";
import { touchDoc, trace } from "./trace.ts";
import { siteOf } from "./world.ts";

export function assertion(slug: string, email: string): string {
  const raw = JSON.stringify({ u: email, s: siteOf(slug), exp: Math.floor(Date.now() / 1000) + 60, n: randomBytes(6).toString("hex") });
  return `${Buffer.from(raw).toString("base64url")}.${createHmac("sha256", config.secret).update(raw).digest("hex")}`;
}

const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
function messages(j: any): string[] {
  try { return (JSON.parse(j._server_messages ?? "[]") as string[]).map((m) => strip(String(JSON.parse(m).message ?? m))); } catch { return []; }
}

export function doorError(status: number, j: any): CliError {
  const msgs = messages(j);
  const exc = String(j?.exception ?? "");
  const type = String(j?.exc_type ?? exc.split(":")[0]!.split(".").pop() ?? "");
  const text = msgs[0] ?? (exc.includes(":") ? strip(exc.slice(exc.indexOf(":") + 1)) : "") ?? "";
  const reason = text || `Frappe answered HTTP ${status}`;
  const detail = { http: status, type, messages: msgs };
  const off = /\(feature: ([a-z]+)\)/.exec(reason);
  if (off) return new CliError(`feature ${off[1]} is switched off for this company: ${reason}`, "FEATURE_NOT_AVAILABLE", true, detail);
  if (status === 401 || type === "AuthenticationError") return new CliError(reason, "NO_HAT", true, detail);
  if (status === 403 || type === "PermissionError") return new CliError(reason, "FORBIDDEN", true, detail);
  if (status === 404 || type === "DoesNotExistError") return new CliError(reason, "NOT_FOUND", true, detail);
  if (status === 409 || type === "DuplicateEntryError") return new CliError(reason, "DUPLICATE", true, detail);
  if (status >= 400 && status < 500) return new CliError(reason, "INVALID", true, detail);
  return new CliError(reason, "FRAPPE_FAILED", false, detail);
}

export type Call = { query?: Record<string, string | undefined>; body?: unknown };
export async function frappe(slug: string, email: string, method: string, path: string, c: Call = {}): Promise<any> {
  person(email);
  const qs = Object.entries(c.query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join("&");
  let res: Response;
  try {
    res = await fetch(`${config.frappeUrl}${path}${qs ? `?${qs}` : ""}`, { method, signal: AbortSignal.timeout(120_000),
      headers: { "x-frappe-site-name": siteOf(slug), "x-capxul-assertion": assertion(slug, email), "x-capxul-trace": trace, accept: "application/json", "content-type": "application/json" },
      body: c.body === undefined ? undefined : JSON.stringify(c.body) });
  } catch (e) {
    throw new CliError(`Frappe is not reachable at ${config.frappeUrl} (${(e as Error).message})`, "FRAPPE_UNREACHABLE");
  }
  const text = await res.text();
  let j: any; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw doorError(res.status, j);
  return j;
}
export const noteDoc = (slug: string, doctype: string, name: string, action: string) => touchDoc({ site: siteOf(slug), doctype, name, action });
