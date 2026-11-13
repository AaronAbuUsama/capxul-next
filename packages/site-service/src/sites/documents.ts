import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { isAddress } from "viem";
import { DOCUMENT_PATH, validDocument, validHeldDocument, validReport, type DocumentInput } from "@capxul/sdk";
import { json, logCause, readBody, requestTrace, ServiceError } from "./http.ts";
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
export type DocumentPrincipal = {
  personId: string; kind: "person" | "agent"; email: string | null; safeAddress: string; signerAddress: string | null;
};
export type DocumentOptions = {
  provider: DocumentProvider;
  /** Core must authenticate and require the active Seat on the same Sql/now before returning this principal. */
  authorize(input: { orgId: string; bearer: string; traceId: string }): Effect.Effect<DocumentPrincipal, ProviderError>;
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
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.url !== DOCUMENT_PATH) return false;
    const trace = requestTrace(req);
    let input: DocumentInput | undefined, user: string | undefined, personId: string | undefined;
    let callId: string = randomUUID();
    try {
      if (req.method !== "POST") throw refused("INVALID_INPUT", "POST required");
      const authorization = req.headers.authorization;
      const bearer = typeof authorization === "string" ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : undefined;
      if (!bearer) throw refused("NOT_AUTHENTICATED", "An Access Bearer session is required");
      const raw = await readBody(req);
      const body: unknown = JSON.parse(raw);
      if (!object(body)) throw refused("INVALID_INPUT", "Invalid document request");
      const keys = body.verb === "create" ? ["doctype", "fields", "callId"] : body.verb === "submit"
        ? ["doctype", "name", "callId"] : body.verb === "get" ? ["doctype", "name"] : body.verb === "report" ? ["report", "filters"] : [];
      if (!keys.length || !/^[a-z][a-z0-9-]{1,30}$/.test(String(body.orgId)) ||
          Object.keys(body).some((key) => !["verb", "orgId", ...keys].includes(key)) ||
          keys.some((key) => key === "fields" ? !object(body[key]) : key === "filters" ? body[key] !== null && !object(body[key]) : !text(body[key])) ||
          (body.callId !== undefined && String(body.callId).length > 140)) throw refused("INVALID_INPUT", "Invalid document request");
      input = body as unknown as DocumentInput;
      const admitted = await Effect.runPromise(Effect.result(options.authorize({ orgId: input.orgId, bearer, traceId: trace })));
      if (admitted._tag === "Failure") throw refused(admitted.failure.code, admitted.failure.message);
      const principal = admitted.success;
      if (principal.kind !== "person" || !text(principal.email) || !text(principal.personId))
        throw refused("ROLE_PERMISSION_DENIED", "This principal has no delegated native person capability");
      user = principal.email; personId = principal.personId;
      if ("callId" in input) callId = createHash("sha256").update(JSON.stringify([personId, input.callId])).digest("hex");
      const site = await options.store.site(input.orgId);
      if (!site || site.state !== "ready") throw refused("PROVIDER_ERROR", "The company's site is not ready");
      const identity = { orgId: input.orgId, site: site.host, user: user!, traceId: trace };
      const effect = input.verb === "report" ? options.provider.doorReport({ ...identity, report: input.report, filters: input.filters })
        : input.verb === "create" ? options.provider.doorCall({ ...identity, verb: "create", doctype: input.doctype, fields: input.fields, callId })
        : input.verb === "submit" ? options.provider.doorCall({ ...identity, verb: "submit", doctype: input.doctype, name: input.name, callId })
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
      await options.store.logCall({ org: input.orgId, callId, person: personId, verb: input.verb,
        doctype: "doctype" in input ? input.doctype : null, name: validDocument(data) ? data.name : "name" in input ? input.name : null,
        outcome: validHeldDocument(data) ? "held" : "ok", refusal: null, trace });
      json(res, 200, data);
    } catch (error) {
      logCause("document", trace, error);
      const failure = error instanceof ServiceError ? error : error instanceof SyntaxError
        ? refused("INVALID_INPUT", "Invalid JSON") : refused("PROVIDER_ERROR", "Document service is unavailable; retry the same call id");
      if (input && personId) {
        try { await options.store.logCall({ org: input.orgId, callId, person: personId, verb: input.verb,
          doctype: "doctype" in input ? input.doctype : null, name: "name" in input ? input.name : null,
          outcome: failure.status >= 500 ? "failed" : "refused", refusal: failure.code, trace }); }
        catch { /* Do not turn an unavailable audit store into a successful document response. */ }
      }
      json(res, failure.status, { error: { code: failure.code, message: failure.message } });
    }
    return true;
  };
}
