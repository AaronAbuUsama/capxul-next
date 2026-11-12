import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { isAddress, recoverMessageAddress, type Hex } from "viem";
import { DOCUMENT_PATH, documentMessage, validDocument, validHeldDocument, validReport, type DocumentInput } from "@capxul/sdk";
import { json, readBody, ServiceError } from "./http.ts";
import type { SitesStore } from "./store.ts";

type Row = Record<string, unknown>;
type Person = { orgId: string; site: string; user: string; traceId?: string };
type ProviderError = { code: string; message: string };
export type DocumentProvider = {
  doorCall(input: Person & (
    | { verb: "get"; doctype: string; name: string }
    | { verb: "create"; doctype: string; fields: Row; callId: string }
    | { verb: "submit"; doctype: string; name: string; callId: string }
  )): Effect.Effect<Row, ProviderError>;
  doorReport(input: Person & { report: string; filters?: Row | null }): Effect.Effect<{ columns: Row[]; rows: Row[] }, ProviderError>;
};
export type SiteRequestAnswer =
  | { status: "collecting" }
  | { status: "refused"; error: ProviderError }
  | { status: "answered"; approval_id: string; approval_url: string; requested_by: string; awaiting: string };
export type DocumentOptions = {
  publicOrigin: string; coreUrl: string; coreSecret: string; provider: DocumentProvider;
  store: Pick<SitesStore, "site" | "logCall">;
  requestAnswer(input: { org: string; request_id: string; requested_by: string }): Effect.Effect<SiteRequestAnswer, ProviderError>;
};
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const status: Record<string, number> = { INVALID_INPUT: 400, NOT_AUTHENTICATED: 401, ROLE_PERMISSION_DENIED: 403,
  FEATURE_NOT_AVAILABLE: 403, WRONG_STATE: 409, PROVIDER_ERROR: 503, PROVIDER_RESPONSE_INVALID: 502 };
const refused = (code: string, message: string) => new ServiceError(status[code] ?? 503,
  code in status ? code : "PROVIDER_ERROR", code in status ? message : "The site refused the document call");

/** Composed inside Core's pre-body pause/drain boundary, not a second HTTP listener. */
export function createDocumentHandler(options: DocumentOptions) {
  if (!options.coreSecret) throw new Error("Core signing secret is required");
  const core = async (path: string, body: unknown, trace: string): Promise<any> => {
    const raw = JSON.stringify(body);
    const response = await fetch(`${options.coreUrl}${path}`, { method: "POST", body: raw,
      signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json", "x-capxul-trace": trace,
        "x-capxul-signature": createHmac("sha256", options.coreSecret).update(raw).digest("hex") } });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw refused(response.status === 404 ? "INVALID_INPUT" : "PROVIDER_ERROR", "Core could not resolve the document caller or request");
    return result;
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.url !== DOCUMENT_PATH) return false;
    const trace = randomUUID();
    let input: DocumentInput | undefined, user: string | undefined;
    let callId: string = randomUUID();
    try {
      if (req.method !== "POST") throw refused("INVALID_INPUT", "POST required");
      const raw = await readBody(req);
      const body: unknown = JSON.parse(raw);
      const signature = req.headers["x-capxul-signature"];
      if (!object(body) || !isAddress(String(body.caller ?? "")) || !Number.isSafeInteger(body.expiresAt) ||
          Number(body.expiresAt) <= Date.now() || Number(body.expiresAt) > Date.now() + 60_000 || typeof signature !== "string")
        throw refused("NOT_AUTHENTICATED", "A signed request expiring within 60 seconds is required");
      let signer: string;
      try { signer = await recoverMessageAddress({ message: documentMessage(options.publicOrigin, raw), signature: signature as Hex }); }
      catch { throw refused("NOT_AUTHENTICATED", "Invalid document signature"); }
      if (signer.toLowerCase() !== String(body.caller).toLowerCase()) throw refused("NOT_AUTHENTICATED", "Request signature does not match caller");
      const keys = body.verb === "create" ? ["doctype", "fields", "callId"] : body.verb === "submit"
        ? ["doctype", "name", "callId"] : body.verb === "get" ? ["doctype", "name"] : body.verb === "report" ? ["report", "filters"] : [];
      if (!keys.length || !/^[a-z][a-z0-9-]{1,30}$/.test(String(body.orgId)) ||
          Object.keys(body).some((key) => !["verb", "orgId", "caller", "expiresAt", ...keys].includes(key)) ||
          keys.some((key) => key === "fields" ? !object(body[key]) : key === "filters" ? body[key] !== null && !object(body[key]) : !text(body[key])) ||
          (body.callId !== undefined && String(body.callId).length > 140)) throw refused("INVALID_INPUT", "Invalid document request");
      input = body as unknown as DocumentInput;
      if ("callId" in input) callId = input.callId;
      const info = await core("/admin/org-info", { org: input.orgId }, trace);
      const person = info?.people?.find((p: { address: string }) => p.address?.toLowerCase() === signer.toLowerCase());
      if (info?.slug !== input.orgId || !text(info.site) || !text(person?.email))
        throw refused("ROLE_PERMISSION_DENIED", "The caller has no person in this company");
      user = person.email;
      const site = await options.store.site(input.orgId);
      if (!site || site.host !== info.site || site.state !== "ready") throw refused("PROVIDER_ERROR", "The company's site is not ready");
      const identity = { orgId: input.orgId, site: site.host, user: user!, traceId: trace };
      const effect = input.verb === "report" ? options.provider.doorReport({ ...identity, report: input.report, filters: input.filters })
        : input.verb === "create" ? options.provider.doorCall({ ...identity, verb: "create", doctype: input.doctype, fields: input.fields, callId: input.callId })
        : input.verb === "submit" ? options.provider.doorCall({ ...identity, verb: "submit", doctype: input.doctype, name: input.name, callId: input.callId })
        : options.provider.doorCall({ ...identity, verb: "get", doctype: input.doctype, name: input.name });
      const answer = await Effect.runPromise(Effect.result(effect));
      if (answer._tag === "Failure") throw refused(answer.failure.code, answer.failure.message);
      let data: unknown = answer.success;
      if (validHeldDocument(data)) throw refused("PROVIDER_RESPONSE_INVALID", "A site response is not a committed approval answer");
      if (input.verb === "submit" && object(data) && data.safe === true) {
        if (data.status !== "Requesting" || data.approval_url !== null || !text(data.request))
          throw refused("PROVIDER_RESPONSE_INVALID", "The site returned an invalid pending request");
        const request = data.request;
        // The collector's saved answer is the only authority for approval identity. A site draft or approval row alone is not proof.
        const deadline = Date.now() + 30_000;
        do {
          const saved = await Effect.runPromise(Effect.result(options.requestAnswer({ org: input.orgId, request_id: request, requested_by: user! })));
          if (saved._tag === "Failure") throw refused(saved.failure.code, saved.failure.message);
          const result = saved.success;
          if (result.status === "refused") throw refused(result.error.code, result.error.message);
          if (result.status === "answered") {
            if (!text(result.approval_id) || result.requested_by !== user || !isAddress(result.awaiting))
              throw refused("PROVIDER_RESPONSE_INVALID", "The collector returned an invalid request answer");
            data = { held: true, requestId: request, approvalId: result.approval_id, awaiting: result.awaiting };
            break;
          }
          await delay(100);
        } while (Date.now() < deadline);
        if (!validHeldDocument(data)) throw refused("PROVIDER_ERROR", "Payment request is saved but not yet answered; retry the same call id");
      }
      const valid = input.verb === "report" ? validReport(data) : validDocument(data) && data.doctype === input.doctype &&
        (!("name" in input) || data.name === input.name) && (input.verb === "get" || data.docstatus === (input.verb === "create" ? 0 : 1)) ||
        input.verb === "submit" && validHeldDocument(data);
      if (!valid) throw refused("PROVIDER_RESPONSE_INVALID", "The site returned an invalid document result");
      await options.store.logCall({ org: input.orgId, callId, person: user!, verb: input.verb,
        doctype: "doctype" in input ? input.doctype : null, name: validDocument(data) ? data.name : "name" in input ? input.name : null,
        outcome: validHeldDocument(data) ? "held" : "ok", refusal: null, trace });
      json(res, 200, data);
    } catch (error) {
      const failure = error instanceof ServiceError ? error : error instanceof SyntaxError
        ? refused("INVALID_INPUT", "Invalid JSON") : refused("PROVIDER_ERROR", "Document service is unavailable; retry the same call id");
      if (input && user) {
        try { await options.store.logCall({ org: input.orgId, callId, person: user, verb: input.verb,
          doctype: "doctype" in input ? input.doctype : null, name: "name" in input ? input.name : null,
          outcome: failure.status >= 500 ? "failed" : "refused", refusal: failure.code, trace }); }
        catch { /* Do not turn an unavailable audit store into a successful document response. */ }
      }
      json(res, failure.status, { error: { code: failure.code, message: failure.message } });
    }
    return true;
  };
}
