import { accessError, authenticate } from "../access/door.ts";
import type { Sql } from "../platform/db.ts";
import { mediaBodyLimit, routeMedia } from "./routes.ts";

/** Media's bearer routes for Core's shared dispatch: tenant role (the worker may not upload or read files),
 * Access's authenticate, and a body limit that admits the largest base64 upload. Image reads need no bearer. */
export function mediaRoutes() {
  return [{
    prefixes: ["/media/files/"], bodyLimit: mediaBodyLimit,
    route: (sql: Sql, path: string, input: Record<string, unknown>, bearer: string, now: number, trace = "") =>
      routeMedia(sql, path, input, bearer, { authenticate, now: async () => now }, trace),
    render: accessError,
  }];
}
