import { createProvisioningHandler } from "@capxul/site-service";
import { worldNow } from "./devnet/door.ts";
import { required, settings } from "./platform/config.ts";
import { createCore } from "./server.ts";
import { authorizeProvisioning } from "./sites/provision.ts";

const config = settings();
const core = createCore(config, (db) => createProvisioningHandler({
  coreUrl: `http://127.0.0.1:${config.port}`, coreSecret: config.secret,
  siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"), authorize: authorizeProvisioning(db, worldNow),
}));
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
