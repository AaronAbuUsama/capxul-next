import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import type { Sql } from "../platform/db.ts";
import type { Mail } from "../shared/door.ts";
import { accessError, accessPaths, routeAccess, type AccessServices } from "./routes.ts";

const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);

/** Access's bearer routes for Core. Companies House and AgentOwner come from the world's static deployment record,
 * never from a request. The challenge key is derived from Core's secret under its own label, so it signs nothing else. */
export function accessRoutes(input: { mail: Mail; secret: string; coreUrl: string; rpc: string; deploymentFile: string; namespace: string }) {
  const deployment = JSON.parse(readFileSync(input.deploymentFile, "utf8")) as Record<string, unknown>;
  if (!address(deployment.companiesHouse) || !address(deployment.agentOwner) || !input.namespace.trim())
    throw new Error("INVALID_CONFIG: Access needs the deployment's companiesHouse and agentOwner and a Safe namespace");
  const services: AccessServices = {
    mail: input.mail,
    personalSafe: { companiesHouse: deployment.companiesHouse, namespace: input.namespace },
    agent: { secret: createHmac("sha256", input.secret).update("capxul:access:challenge:v1").digest("base64url"),
      domain: new URL(input.coreUrl).host, rpc: input.rpc, agentOwner: deployment.agentOwner },
  };
  return [{
    paths: accessPaths, system: true,
    route: (sql: Sql, path: string, body: Record<string, unknown>, bearer: string, now: number, trace: string) =>
      routeAccess(sql, path, body, bearer, services, now, trace),
    render: accessError,
  }];
}
