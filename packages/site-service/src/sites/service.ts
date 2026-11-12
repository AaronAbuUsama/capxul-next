import { createServer } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { benchProvisioner, type BenchOptions, type SiteIdentity } from "./bench.ts";
import { failure, json, readBody, ServiceError } from "./http.ts";

export type SiteServiceOptions = BenchOptions & { token: string; stateDir: string; baseDomain: string; siteScheme?: "http" | "https"; sitePort?: number };
const hash = (s: string) => createHash("sha256").update(s).digest();

/** Private bench-host HTTP service. One immutable intent per deterministic company/world hostname. */
export function createSiteService(options: SiteServiceOptions) {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(options.world) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(options.baseDomain) || !options.token) {
    throw new Error("A world without hyphens, base domain and private token are required");
  }
  const provision = benchProvisioner(options);
  const running = new Map<string, { intent: string; work: Promise<void> }>();
  // Bench creation is host-local and serialized, including different companies.
  let tail: Promise<unknown> = Promise.resolve();
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, component: "site-service" });
      if (req.method !== "POST" || req.url !== "/sites/create") return json(res, 404, { error: { code: "NOT_FOUND" } });
      if (!timingSafeEqual(hash(req.headers.authorization ?? ""), hash(`Bearer ${options.token}`))) {
        throw new ServiceError(401, "NOT_AUTHENTICATED", "Private site-service token required");
      }
      const input = JSON.parse(await readBody(req));
      if (!input || !/^[a-z][a-z0-9-]{1,30}$/.test(input.org) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 140 ||
          !/^0x[\da-fA-F]{40}$/.test(input.safe) || typeof input.adminEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail)) {
        throw new ServiceError(400, "INVALID_INPUT", "Invalid company identity");
      }
      const identity: SiteIdentity = { org: input.org, name: input.name, safe: input.safe.toLowerCase(), adminEmail: input.adminEmail.toLowerCase() };
      const site = `${identity.org}-${options.world}.${options.baseDomain}`;
      const url = `${options.siteScheme ?? "https"}://${site}${options.sitePort ? `:${options.sitePort}` : ""}`;
      const intent = JSON.stringify({ ...identity, site, world: options.world });
      let active = running.get(site);
      if (active && active.intent !== intent) throw new ServiceError(409, "INVALID_INPUT", "Site creation is already running for a different identity");
      if (!active) {
        const work = tail.then(async () => {
          await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
          const path = join(options.stateDir, `${site}.json`);
          const temporary = join(options.stateDir, `${randomUUID()}.tmp`);
          await writeFile(temporary, intent, { flag: "wx", mode: 0o600 });
          try { await link(temporary, path); }
          catch (error: any) { if (error.code !== "EEXIST") throw error; }
          finally { await unlink(temporary); }
          if (await readFile(path, "utf8") !== intent) throw new ServiceError(409, "INVALID_INPUT", "Site identity conflicts with its stored creation intent");
          await provision(identity, site, url);
        });
        active = { intent, work };
        running.set(site, active);
        tail = work.catch(() => {});
        void work.finally(() => running.delete(site)).catch(() => {});
      }
      await active.work;
      json(res, 200, { org: identity.org, safe: identity.safe, site, url, state: "provisioned" });
    } catch (error) {
      failure(res, error instanceof SyntaxError ? new ServiceError(400, "INVALID_INPUT", "Invalid JSON") : error);
    }
  });
}
