import { accessError, authenticate } from "../access/door.ts";
import type { Sql } from "../platform/db.ts";
import { mediaBodyLimit, mediaPaths, routeMedia } from "./routes.ts";

/** Media's bearer routes for Core's shared dispatch: tenant role (the worker may not upload or read files),
 * Access's authenticate and renderer. Only upload gets the large body limit; the anonymous image read keeps the
 * dispatch's default, so an unauthenticated caller cannot make Core buffer an upload-sized body. Exact paths only:
 * an unknown path under /media/files/ never inherits upload's limit. */
export function mediaRoutes() {
  const route = (sql: Sql, path: string, input: Record<string, unknown>, bearer: string, now: number) =>
    routeMedia(sql, path, input, bearer, { authenticate, now: async () => now });
  return [
    { paths: [mediaPaths[0]], bodyLimit: mediaBodyLimit, route, render: accessError },
    { paths: [mediaPaths[1]], route, render: accessError },
  ];
}
