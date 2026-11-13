import { createProvisioningHandler } from "@capxul/site-service";
import { createPublicClient, http } from "viem";
import { carrierChain, worldChainConfig } from "./approvals/door.ts";
import { required, settings } from "./platform/config.ts";
import { createCore } from "./server.ts";

const config = settings();
const provision = createProvisioningHandler({
  publicOrigin: config.url, rpcUrl: config.rpc, coreUrl: `http://127.0.0.1:${config.port}`,
  coreSecret: config.secret, siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"),
});
// The approval carrier runs only in a world Runtime gives a gateway; read once here, its world-level addresses come
// from the world's deployment file. Without it approvals open and are signed but are never sponsored or sent.
const chain = process.env.BUNDLER_GATEWAY_URL ? carrierChain(worldChainConfig(
  { deploymentFile: required("DEPLOYMENT_FILE"), chainId: config.chainId, entryPoint: required("ENTRY_POINT_ADDRESS"), paymaster: required("PAYMASTER_ADDRESS") },
  { client: createPublicClient({ transport: http(config.rpc) }), gatewayUrl: required("BUNDLER_GATEWAY_URL") })) : undefined;
const core = createCore(config, provision, chain);
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
