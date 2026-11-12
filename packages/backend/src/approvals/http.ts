import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import type { Database, Sql } from "../platform/db.ts";
import { read } from "./store.ts";
import { signingGet, signingReview, signingSign, signingDecline, type SigningContext } from "./signing.ts";

export type SigningTransport = {
  db: Pick<Database, "transaction">;
  site_url: string;
  network: SigningContext["network"];
  now: (sql: Sql) => Promise<number>;
  /** Access.authenticate must set its verified transaction-local GUCs, not just return an identity. */
  authenticate: (sql: Sql, bearer: string, now: number) => Promise<{ personId: string; safeAddress: string }>;
  requireFeature: SigningContext["requireFeature"];
  terminal?: SigningContext["terminal"];
};
const paths = new Map(["get", "review", "sign", "decline"].map((name) => [`/approvals/signing/${name}`, name]));
const identifier = /^[a-zA-Z0-9_.:+-]{1,200}$/;
const statuses: Record<string, number> = { NOT_AUTHENTICATED: 401, INVALID_INPUT: 400, WRONG_STATE: 409, FEATURE_NOT_AVAILABLE: 403 };

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0]!;
  return Object.hasOwn(statuses, code) ? { code, message } : { code: "PROVIDER_ERROR", message: "Signing service unavailable" };
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Mount before the shared service-HMAC/body parser. No service credential is accepted here. */
export function createSigningHandler(options: SigningTransport) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://core");
    const method = paths.get(url.pathname);
    if (!method) return false;
    const stop = new AbortController();
    const disconnected = () => stop.abort();
    res.once("close", disconnected);
    try {
      if (req.method !== (method === "get" ? "GET" : "POST")) {
        json(res, 405, { error: { code: "INVALID_INPUT", message: "Wrong HTTP method" } }); return true;
      }
      const auth = req.headers.authorization;
      if (typeof auth !== "string" || !/^Bearer [^\s]+$/.test(auth)) throw new Error("NOT_AUTHENTICATED: bearer required");
      const bearer = auth.slice(7);
      let input: { approvalId: string; signature?: string };
      const trace = req.headers["x-capxul-trace"], callId = req.headers["x-capxul-call-id"];
      if (method === "get") {
        if ([...url.searchParams.keys()].some((key) => key !== "approvalId") || url.searchParams.getAll("approvalId").length !== 1) throw new Error("INVALID_INPUT: approvalId");
        input = { approvalId: url.searchParams.get("approvalId")! };
      } else {
        if (typeof trace !== "string" || !identifier.test(trace) || typeof callId !== "string" || !identifier.test(callId)) throw new Error("INVALID_INPUT: trace and callId required");
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16_384) throw new Error("INVALID_INPUT: request too large");
          chunks.push(Buffer.from(chunk));
        }
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new Error("INVALID_INPUT: JSON"); }
        const allowed = method === "sign" ? ["approvalId", "signature"] : ["approvalId"];
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key)) ||
            (method === "sign" && typeof input.signature !== "string")) throw new Error("INVALID_INPUT: signing input");
      }
      if (typeof input.approvalId !== "string" || !identifier.test(input.approvalId)) throw new Error("INVALID_INPUT: approvalId");
      const frame = () => options.db.transaction("", async (sql) => {
        if (stop.signal.aborted) throw new Error("CANCELLED");
        const now = await options.now(sql);
        if (!Number.isSafeInteger(now)) throw new Error("INVALID_CLOCK");
        const principal = await options.authenticate(sql, bearer, now);
        const scope = (await sql.query(`select current_setting('app.person_id',true) as person,
          current_setting('app.safe_address',true) as safe,current_setting('app.owner_kind',true) as kind,
          current_setting('app.owner_id',true) as owner`)).rows[0];
        if (!principal.personId || scope?.person !== principal.personId || scope.safe !== principal.safeAddress ||
            scope.kind !== "person" || scope.owner !== principal.personId) throw new Error("NOT_AUTHENTICATED: principal scope required");
        const ctx: SigningContext = { person_id: principal.personId, sender: principal.safeAddress, site_url: options.site_url,
          now: new Date(now), network: options.network, requireFeature: options.requireFeature, terminal: options.terminal };
        const row = await read(sql, ctx.person_id, input.approvalId);
        if (row.gate) await options.requireFeature(sql, row.gate, { personId: ctx.person_id, ...(row.org_id ? { orgId: row.org_id } : {}) });
        if (stop.signal.aborted) throw new Error("CANCELLED");
        if (method === "get") return signingGet(sql, ctx, input);
        const request = { method, input };
        await sql.query(`insert into app.approval_calls(person_id,call_id,request,trace_id,at) values($1,$2,$3,$4,$5)
          on conflict(person_id,call_id) do nothing`, [ctx.person_id, callId, request, trace, now]);
        const original = (await sql.query(`select request=$3::jsonb as same,trace_id from app.approval_calls
          where person_id=$1 and call_id=$2`, [ctx.person_id, callId, request])).rows[0];
        if (!original?.same) throw new Error("INVALID_INPUT: callId reused with different input");
        if (method === "review") return signingReview(sql, ctx, input);
        if (method === "decline") return signingDecline(sql, ctx, input, original.trace_id);
        return signingSign(sql, ctx, { approvalId: input.approvalId, signature: input.signature! }, original.trace_id);
      });
      if (method !== "get" || !req.headers.accept?.split(",").some((v) => v.trim() === "text/event-stream")) {
        json(res, 200, await frame()); return true;
      }
      let previous = "";
      while (!stop.signal.aborted) {
        const value = JSON.stringify(await frame()); // Commit/release before socket IO or the next wait.
        if (stop.signal.aborted) break;
        if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
        if (value !== previous) {
          if (!res.write(`event: approval\ndata: ${value}\n\n`)) {
            // No unbounded frames for a slow client: reconnect reads authoritative current state.
            res.end(); break;
          }
          previous = value;
        } else if (!res.write(": heartbeat\n\n")) { res.end(); break; }
        await wait(1000, undefined, { signal: stop.signal });
      }
    } catch (error) {
      if (!stop.signal.aborted) {
        const e = failure(error);
        if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify(e)}\n\n`); res.end(); }
        else json(res, statuses[e.code] ?? 503, { error: e });
      }
    } finally { res.off("close", disconnected); }
    return true;
  };
}
