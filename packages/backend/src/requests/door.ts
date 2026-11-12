import type { Sql } from "../platform/db.ts";
import type { Request, RequestIdentity } from "./types.ts";

export { migrateRequests } from "./migrate.ts";
export type { Request, RequestIdentity } from "./types.ts";
export { followPayment, onPaymentTransition, type ReadPayment, type ReadEscrowAtEnd } from "./followers.ts";

/** Notices and the owning public query share the source row; normal tenant RLS still applies. */
export async function getRequest(sql: Sql, key: RequestIdentity): Promise<Request> {
  const row = (await sql.query("select * from app.requests where owner_kind=$1 and owner_id=$2 and request_id=$3",
    [key.owner_kind, key.owner_id, key.request_id])).rows[0];
  if (!row) throw new Error("INVALID_INPUT: request_id");
  return row;
}
