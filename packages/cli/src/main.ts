#!/usr/bin/env -S node --experimental-strip-types --no-warnings
import { createSitesClient, isTraceparent, newTraceparent, ProvisioningError } from "@capxul/sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { runDocuments } from "./documents.ts";

const args = process.argv.slice(2);
// One trace per command that calls Core, carried by every request it makes (components.cli-traceparent). A harness may
// name it with CAPXUL_TRACEPARENT; empty means unset, and it is checked only when the command is about to send.
const commandTrace = (): string => {
  const named = process.env.CAPXUL_TRACEPARENT || undefined;
  if (named !== undefined && !isTraceparent(named)) throw new ProvisioningError("CLI_USAGE", "CAPXUL_TRACEPARENT must be a W3C traceparent");
  return named ?? newTraceparent();
};
try {
  if (args[0] === "world" || args[0] === "record") {
    // The supervisor owns world and catalogue adapters, not site provisioning.
    const { runDevnet } = await import(new URL("./devnet.ts", import.meta.url).href);
    process.exitCode = await runDevnet(args);
  } else if (args[0] === "doc" || args[0] === "report") {
    await runDocuments(args, commandTrace);
  } else {
    const usage = "capxul org site provision --org <slug> --confirm [--json]";
    const rest = args.slice(3);
    const orgIndex = rest.indexOf("--org");
    const org = rest[orgIndex + 1];
    if (args.slice(0, 3).join(" ") !== "org site provision" || orgIndex < 0 || !org || org.startsWith("--") ||
        rest.some((arg, index) => index !== orgIndex + 1 && !["--org", "--confirm", "--json"].includes(arg))) {
      throw new ProvisioningError("CLI_USAGE", usage);
    }
    if (!args.includes("--confirm")) throw new ProvisioningError("CLI_USAGE", "Review the registered company, then pass --confirm to provision its site");
    const key = process.env.CAPXUL_PRIVATE_KEY;
    if (!/^0x[\da-fA-F]{64}$/.test(key ?? "")) throw new ProvisioningError("NOT_AUTHENTICATED", "CAPXUL_PRIVATE_KEY must contain the caller's local signing key");
    if (!process.env.CAPXUL_CORE_URL) throw new ProvisioningError("CLI_USAGE", "CAPXUL_CORE_URL is required");
    const sites = createSitesClient({ coreUrl: process.env.CAPXUL_CORE_URL, account: privateKeyToAccount(key as Hex), traceparent: commandTrace() });
    const result = await sites.provision({ org });
    console.log(args.includes("--json") ? JSON.stringify(result) : `${result.org}: ${result.site} provisioned; Core delivery released`);
  }
} catch (error) {
  const message = args[0] === "world" ? "World command failed" : args[0] === "doc" || args[0] === "report"
    ? "Document command failed; retain the call id when retrying" : "Provisioning failed; retry the same company";
  const e = error instanceof ProvisioningError ? error : new ProvisioningError("PROVIDER_ERROR", message);
  console.error(JSON.stringify({ error: { code: e.code, message: e.message } }));
  const documentExit: Record<string, number> = { CLI_USAGE: 2, INVALID_INPUT: 2, WRONG_STATE: 2, NOT_AUTHENTICATED: 3,
    ROLE_PERMISSION_DENIED: 4, PROVIDER_ERROR: 5, PROVIDER_RESPONSE_INVALID: 5, FEATURE_NOT_AVAILABLE: 6 };
  process.exitCode = args[0] === "doc" || args[0] === "report" ? documentExit[e.code] ?? 1 : e.code === "CLI_USAGE" ? 2 : 1;
}
