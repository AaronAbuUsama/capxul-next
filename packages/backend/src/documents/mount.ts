import { accessError, authenticate } from "../access/door.ts";
import type { Sql } from "../platform/db.ts";
import { documentsPaths, routeDocuments } from "./door.ts";

/** Documents' bearer routes for Core's shared dispatch: tenant role (RLS stays in force), Access's authenticate,
 * and the dispatch's world-clock instant from the same transaction. No body field supplies authority. */
export function documentsRoutes() {
  return [{
    paths: documentsPaths,
    route: (sql: Sql, path: string, input: Record<string, unknown>, bearer: string, now: number) =>
      routeDocuments(sql, path, input, bearer, { authenticate, now: async () => now }),
    render: accessError,
  }];
}
