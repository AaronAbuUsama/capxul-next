import { Effect } from "effect";
import { authenticate } from "../access/door.ts";
import { readSetupFounder, requireSeat } from "../organizations/door.ts";
import type { Database, Sql } from "../platform/door.ts";

/** sites.provision-principal: Access authenticates the Bearer on the world clock; Organizations then admits the founder of
 * the company's setup while it has deployed its money and is neither complete nor failed, and otherwise requires a current
 * Seat. One worker transaction, as Organizations' setup reads require: a founder holds no Seat yet, so a tenant read of the
 * company sees nothing. Sites does not depend on the world clock's owner, so the composition injects `worldNow`. */
export const authorizeProvisioning = (db: Database, worldNow: (sql: Sql) => Promise<number>) =>
  ({ orgId, bearer }: { orgId: string; bearer: string }) => Effect.tryPromise({
    try: () => db.transaction("", async (sql) => {
      const principal = await authenticate(sql, bearer, await worldNow(sql));
      const setup = await readSetupFounder(sql, orgId);
      if (setup?.founderPrincipalId === principal.personId && setup.steps.includes("money_deployed") &&
          setup.status !== "ready" && setup.status !== "failed") return principal;
      await requireSeat(sql, orgId, { principalId: principal.personId, kind: principal.kind === "person" ? "human" : "agent", safe: principal.safeAddress });
      return principal;
    }, true),
    // Core's doors throw "CODE: message"; the handler takes { code, message } and replaces any code it does not declare.
    catch: (error) => {
      const [code = "", ...rest] = String(error instanceof Error ? error.message : "").split(": ");
      return { code, message: rest.join(": ") };
    },
  });
