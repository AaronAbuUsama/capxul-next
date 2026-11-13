import { createProvisioningHandler } from "@capxul/site-service";
import { required, settings } from "./platform/config.ts";
import { createCore } from "./server.ts";

const config = settings();
const provision = createProvisioningHandler({
  publicOrigin: config.url, rpcUrl: config.rpc, coreUrl: `http://127.0.0.1:${config.port}`,
  coreSecret: config.secret, siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"),
});
// The approval carrier starts once its chain half is composed as the third argument: PR84's approvalSponsor and
// Shared's bundler send/lookup. Until then approvals open and are signed but are not sponsored or sent.
const core = createCore(config, provision);
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
