import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ServiceError } from "./http.ts";

const exec = promisify(execFile);
export type SiteIdentity = { org: string; name: string; safe: string; adminEmail: string };
export type BenchOptions = {
  command: readonly string[]; dbRootPassword: string; adminPassword: string; secret: string; world: string;
};

/** The deployer fixes command/credentials. Caller strings are argv values, never shell source. */
export function benchProvisioner(options: BenchOptions) {
  const [command, ...prefix] = options.command;
  if (!command || !options.secret || !options.adminPassword || !options.dbRootPassword) throw new Error("Bench command and private credentials are required");
  const bench = async (...args: string[]): Promise<string> => {
    const result = await exec(command, [...prefix, ...args], { timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout.trim();
  };
  const value = async (site: string, field: string): Promise<string | null> => {
    const text = await bench("--site", site, "execute", "frappe.db.get_single_value", "--args", JSON.stringify(["Capxul Settings", field]));
    // Frappe's execute prints JSON with surrounding quotes stripped: scalar strings are not JSON.
    return text || null;
  };
  return async (identity: SiteIdentity, site: string, url: string): Promise<void> => {
    let apps: string[];
    try { apps = JSON.parse(await bench("--site", site, "list-apps", "--format", "json"))[site]; }
    catch {
      await bench("new-site", site, "--db-root-password", options.dbRootPassword, "--admin-password", options.adminPassword, "--mariadb-user-host-login-scope", "%");
      apps = [];
    }
    if (!Array.isArray(apps)) throw new ServiceError(502, "PROVIDER_RESPONSE_INVALID", "Bench returned an invalid app list");
    if (apps.includes("capxul")) {
      const [org, safe] = await Promise.all([value(site, "org_slug"), value(site, "safe_address")]);
      if ((org && org !== identity.org) || (safe && safe.toLowerCase() !== identity.safe.toLowerCase())) {
        throw new ServiceError(409, "INVALID_INPUT", "Existing site belongs to a different company or Safe");
      }
    }
    // Join the world before any app installs or setup stamps a date: the clock reads only this site config, and an unset
    // world means host time (the Fiscal Year included).
    await bench("--site", site, "set-config", "capxul_world", options.world);
    // The image contains these apps; provisioning never downloads or changes the image.
    for (const app of ["erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"]) {
      if (!apps.includes(app)) await bench("--site", site, "install-app", app);
    }
    await bench("--site", site, "set-config", "host_name", url);
    await bench("--site", site, "execute", "capxul.setup.configure_site", "--kwargs", JSON.stringify({
      slug: identity.org, company_name: identity.name, safe_address: identity.safe, admin_email: identity.adminEmail,
      core_url: "", secret: options.secret,
    }));
    await bench("--site", site, "enable-scheduler");
    await bench("--site", site, "clear-cache");
    const [org, safe] = await Promise.all([value(site, "org_slug"), value(site, "safe_address")]);
    if (org !== identity.org || safe?.toLowerCase() !== identity.safe.toLowerCase()) {
      throw new ServiceError(503, "PROVIDER_ERROR", "Site did not confirm its company and Safe");
    }
  };
}
