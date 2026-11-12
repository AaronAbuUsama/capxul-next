import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDocumentClient, ProvisioningError } from "@capxul/sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const usage = `capxul doc create <DocType> --org <slug> [--field name=value ... | --data JSON|@FILE] [--call-id ID] [--json]
capxul doc get <DocType> <name> --org <slug> [--json]
capxul doc submit <DocType> <name> --org <slug> [--call-id ID] [--json]
capxul report run <report> --org <slug> [--filter name=value ... | --filters JSON|@FILE] [--json]
Calls run as the signing person. There is no --as impersonation or bench credential.
Keep --call-id on retries of create/submit. --field and --filter values accept JSON; other values are strings.`;
const refuse = (message: string): never => { throw new ProvisioningError("CLI_USAGE", message); };
const record = (raw: string): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw); }
  catch { return refuse("Expected a JSON object or @FILE"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("Expected a JSON object");
  return value as Record<string, unknown>;
};

export async function runDocuments(args: string[]): Promise<void> {
  const command = args.slice(0, 2).join(" ");
  if (!["doc create", "doc get", "doc submit", "report run"].includes(command)) return refuse(usage);
  if (args.includes("--help")) { console.log(usage); return; }
  const positionals: string[] = [], flags = new Map<string, string>(), fields: Record<string, unknown> = {};
  let json = false;
  const repeated = command === "doc create" ? "--field" : command === "report run" ? "--filter" : "";
  const allowed = ["--org", ...(command === "doc create" ? ["--data", "--call-id"] : command === "doc submit" ? ["--call-id"] : command === "report run" ? ["--filters"] : [])];
  for (let i = 2; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { if (json) return refuse("Repeated --json"); json = true; continue; }
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    if (!allowed.includes(arg) && arg !== repeated) return refuse(`Unknown option ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) return refuse(`${arg} requires a value`);
    if (arg === repeated) {
      const equal = value.indexOf("="), key = value.slice(0, equal);
      if (equal < 1 || !/^[a-z][a-z0-9_]*$/i.test(key) || Object.hasOwn(fields, key)) return refuse(`${arg} requires a unique field=value`);
      let parsed: unknown = value.slice(equal + 1);
      try { parsed = JSON.parse(String(parsed)); } catch { /* A non-JSON value is a string, including names with spaces. */ }
      Object.defineProperty(fields, key, { value: parsed, enumerable: true });
    } else {
      if (flags.has(arg)) return refuse(`Repeated ${arg}`);
      flags.set(arg, value);
    }
  }
  const count = ["doc get", "doc submit"].includes(command) ? 2 : 1;
  const orgId = flags.get("--org");
  if (positionals.length !== count || !orgId) return refuse(usage);
  const dataFlag = command === "doc create" ? "--data" : "--filters";
  if (flags.has(dataFlag) && Object.keys(fields).length) return refuse(`Use ${dataFlag} or ${repeated}, not both`);
  const key = process.env.CAPXUL_PRIVATE_KEY;
  if (!/^0x[\da-fA-F]{64}$/.test(key ?? "")) throw new ProvisioningError("NOT_AUTHENTICATED", "CAPXUL_PRIVATE_KEY must contain the caller's local signing key");
  if (!process.env.CAPXUL_CORE_URL) return refuse("CAPXUL_CORE_URL is required");
  const client = createDocumentClient({ coreUrl: process.env.CAPXUL_CORE_URL, account: privateKeyToAccount(key as Hex) });
  const callId = flags.get("--call-id") ?? randomUUID();
  let result: unknown;
  try {
    if (command === "doc create") result = await client.create({ orgId, doctype: positionals[0]!, callId,
      fields: flags.has("--data") ? record(flags.get("--data")!) : fields });
    else if (command === "doc get") result = await client.get({ orgId, doctype: positionals[0]!, name: positionals[1]! });
    else if (command === "doc submit") result = await client.submit({ orgId, doctype: positionals[0]!, name: positionals[1]!, callId });
    else result = await client.report({ orgId, report: positionals[0]!, filters: flags.has("--filters") ? record(flags.get("--filters")!) : fields });
  } catch (error) {
    if (error instanceof ProvisioningError && ["doc create", "doc submit"].includes(command))
      throw new ProvisioningError(error.code, `${error.message}; retry with --call-id ${callId}`);
    throw error;
  }
  console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
}
