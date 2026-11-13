import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { readPrincipalByEmail, readPrincipalBySafe } from "../access/door.ts";
import type { Database } from "../platform/db.ts";
import { createDepartment, type DepartmentServices } from "./departments.ts";
import { listDepartments } from "./list.ts";

const refused = new Set(["NOT_AUTHENTICATED", "ROLE_PERMISSION_DENIED", "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID", "INVALID_INPUT",
  "WRONG_STATE", "ROLE_CONFLICT", "TOKEN_NOT_SUPPORTED", "CHILDREN_EXCEED_PARENT"]);
const coded = (error: unknown) => {
  const message = String((error as Error)?.message ?? error), candidate = message.split(":")[0]!;
  return Object.assign(error instanceof Error ? error : new Error(message), { code: refused.has(candidate) ? candidate : "PROVIDER_ERROR" });
};
const status = (code: string) => code === "NOT_AUTHENTICATED" ? 401 : code === "ROLE_PERMISSION_DENIED" ? 403
  : ["INVALID_INPUT", "ROLE_CONFLICT", "TOKEN_NOT_SUPPORTED"].includes(code) ? 400 : ["WRONG_STATE", "CHILDREN_EXCEED_PARENT"].includes(code) ? 409 : 502;

/** Composition mounts this before the private HMAC router, with the same `run` contract as Books' handler. */
export function departmentsHandler(db: Database, services: DepartmentServices,
  run: <A, E>(build: (context: { traceId: string; callId: string }) => Effect.Effect<A, E>, req: IncomingMessage) => Promise<A>) {
  const people = { byEmail: (email: string) => readPrincipalByEmail(db.worker, email), bySafe: (safe: string) => readPrincipalBySafe(db.worker, safe) };
  const routes: Record<string, (bearer: string, body: unknown, traceId: string) => Promise<unknown>> = {
    "/budgets/departments/create": (bearer, body, traceId) => db.transaction("", (sql) => createDepartment(sql, services, people, bearer, body, traceId)),
    "/budgets/departments/list": (bearer, body) => db.transaction("", (sql) => listDepartments(sql, services, people, bearer, body)),
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split("?")[0] ?? "", route = routes[path];
    if (!route) return false;
    let code = 200, result: unknown;
    try {
      if (req.method !== "POST") throw new Error("INVALID_INPUT: POST required");
      const bearer = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1_048_576) throw new Error("INVALID_INPUT: request too large"); chunks.push(chunk); }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("INVALID_INPUT: JSON body required"); }
      result = await run((context) => {
        res.setHeader("x-capxul-trace", context.traceId);
        return Effect.tryPromise({ try: () => route(bearer, body, context.traceId), catch: coded })
          .pipe(Effect.withSpan(`rpc${path.replaceAll("/", ".")}`));
      }, req);
    } catch (error) {
      const failure = coded(error);
      code = status(failure.code);
      result = { error: { code: failure.code, message: failure.code === "PROVIDER_ERROR" && !String(failure.message).startsWith("PROVIDER_ERROR")
        ? "The budgets service is unavailable" : failure.message } };
    }
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(result));
    return true;
  };
}
