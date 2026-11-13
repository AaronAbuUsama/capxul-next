import { Effect } from "effect";
import { setTimeout as delay } from "node:timers/promises";
import { ServiceError } from "./http.ts";
import type { SitesStore } from "./store.ts";

export type SiteObservation = {
  version: string; apps: string[]; company: string; features: Record<string, "on" | "off">; map_version: string;
  sign_in: { mode: "assertion"; configured: boolean; oauth: boolean };
};
export type ProvisioningLifecycle = {
  world: string; bench: string; store: SitesStore;
  readSite(input: { orgId: string; site: string; traceId?: string }): Effect.Effect<SiteObservation, { code: string; message: string }>;
};

/** Native state, not the success of the bench process, decides whether this site is ready. */
export async function settleSite(lifecycle: ProvisioningLifecycle, info: { slug: string; site: string; name: string }, trace: string): Promise<void> {
  const observed = await Effect.runPromise(Effect.result(lifecycle.readSite({ orgId: info.slug, site: info.site, traceId: trace })));
  if (observed._tag === "Failure") throw new ServiceError(503, "PROVIDER_ERROR", "The provisioned site could not be inspected");
  const site = observed.success;
  if (site.company !== info.name || !site.version || !site.map_version || site.sign_in.mode !== "assertion" ||
      !site.sign_in.configured || site.sign_in.oauth || ["frappe", "erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"].some((app) => !site.apps.includes(app)))
    throw new ServiceError(502, "PROVIDER_RESPONSE_INVALID", "The site did not confirm its company, apps and native sign-in configuration");
  await lifecycle.store.confirmFeatures(info.slug, site.features);
  const deadline = Date.now() + 30_000;
  do {
    try {
      await lifecycle.store.transition(info.slug, "ready", trace, { appVersion: site.version, mapVersion: site.map_version });
      return;
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "WRONG_STATE") throw error;
      const row = await lifecycle.store.site(info.slug);
      if (row?.state !== "creating") throw error;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new ServiceError(503, "PROVIDER_ERROR", "Site exists but its initial events are not acknowledged; retry the same company");
}
