#!/usr/bin/env -S node --experimental-strip-types --no-warnings
import { createSitesClient, ProvisioningError } from "@capxul/sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const args = process.argv.slice(2);
try {
  if (args[0] === "world" || args[0] === "record") {
    // The supervisor owns world and catalogue adapters, not site provisioning.
    const { runDevnet } = await import(new URL("./devnet.ts", import.meta.url).href);
    process.exitCode = await runDevnet(args);
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
    const sites = createSitesClient({ coreUrl: process.env.CAPXUL_CORE_URL, account: privateKeyToAccount(key as Hex) });
    const result = await sites.provision({ org });
    console.log(args.includes("--json") ? JSON.stringify(result) : `${result.org}: ${result.site} provisioned; Core delivery released`);
  }
} catch (error) {
  const e = error instanceof ProvisioningError ? error : new ProvisioningError("PROVIDER_ERROR", args[0] === "world" ? "World command failed" : "Provisioning failed; retry the same company");
  console.error(JSON.stringify({ error: { code: e.code, message: e.message } }));
  process.exitCode = e.code === "CLI_USAGE" ? 2 : 1;
}
