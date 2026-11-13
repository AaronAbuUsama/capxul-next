import { ProvisioningError } from "./door.ts";
import { checkTraceparent, traceHeaders } from "../shared/trace.ts";

export const DOCUMENT_PATH = "/org/site/document";

export type Document = { doctype: string; name: string; docstatus: number; fields: Record<string, unknown> };
export type HeldDocument = { held: true; requestId: string; approvalId: string; awaiting: string };
export type Report = { columns: Record<string, unknown>[]; rows: Record<string, unknown>[] };
export type DocumentInput =
  | { verb: "create"; orgId: string; doctype: string; fields: Record<string, unknown>; callId: string }
  | { verb: "get"; orgId: string; doctype: string; name: string }
  | { verb: "submit"; orgId: string; doctype: string; name: string; callId: string }
  | { verb: "report"; orgId: string; report: string; filters: Record<string, unknown> | null };

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(",") === keys.sort().join(",");
export function validDocument(v: unknown): v is Document {
  return object(v) && exact(v, ["doctype", "name", "docstatus", "fields"]) && typeof v.doctype === "string" && !!v.doctype &&
    typeof v.name === "string" && !!v.name && Number.isInteger(v.docstatus) && [0, 1, 2].includes(v.docstatus as number) && object(v.fields);
}
export function validHeldDocument(v: unknown): v is HeldDocument {
  return object(v) && exact(v, ["held", "requestId", "approvalId", "awaiting"]) && v.held === true &&
    [v.requestId, v.approvalId, v.awaiting].every((s) => typeof s === "string" && s.length > 0);
}
export function validReport(v: unknown): v is Report {
  return object(v) && exact(v, ["columns", "rows"]) && Array.isArray(v.columns) && v.columns.every(object) && Array.isArray(v.rows) && v.rows.every(object);
}

/** Every call obtains the current opaque Access session; no wallet key or impersonated email is accepted. */
export function createDocumentClient(options: { coreUrl: string; bearer(): string | Promise<string>; traceparent?: string | undefined }) {
  const origin = new URL(options.coreUrl).origin;
  const traceparent = checkTraceparent(options.traceparent, () => new ProvisioningError("INVALID_INPUT", "Invalid traceparent"));
  const send = async (input: DocumentInput): Promise<unknown> => {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(input.orgId)) throw new ProvisioningError("INVALID_INPUT", "Invalid company slug");
    const bearer = await options.bearer();
    if (!bearer || /\s/.test(bearer)) throw new ProvisioningError("NOT_AUTHENTICATED", "An Access Bearer session is required");
    const raw = JSON.stringify(input);
    let response: Response;
    try {
      response = await fetch(`${origin}${DOCUMENT_PATH}`, { method: "POST", body: raw,
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, ...traceHeaders(traceparent) }, signal: AbortSignal.timeout(120_000) });
    } catch { throw new ProvisioningError("PROVIDER_ERROR", "Document service is unreachable; retain the same call id when retrying"); }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = object(result) && object(result.error) ? result.error : {};
      throw new ProvisioningError(typeof error.code === "string" ? error.code : "PROVIDER_ERROR",
        typeof error.message === "string" ? error.message : "Document call failed");
    }
    return result;
  };
  const document = async (input: DocumentInput): Promise<Document> => {
    const result = await send(input);
    if (!validDocument(result) || !("doctype" in input) || result.doctype !== input.doctype ||
        ("name" in input && result.name !== input.name) || (input.verb === "create" && result.docstatus !== 0))
      throw new ProvisioningError("PROVIDER_RESPONSE_INVALID", "Document service returned an invalid document");
    return result;
  };
  return {
    create: (input: Omit<Extract<DocumentInput, { verb: "create" }>, "verb">) => document({ ...input, verb: "create" }),
    get: (input: Omit<Extract<DocumentInput, { verb: "get" }>, "verb">) => document({ ...input, verb: "get" }),
    async submit(input: Omit<Extract<DocumentInput, { verb: "submit" }>, "verb">): Promise<Document | HeldDocument> {
      const result = await send({ ...input, verb: "submit" });
      if (validHeldDocument(result) || validDocument(result) && result.doctype === input.doctype && result.name === input.name && result.docstatus === 1) return result;
      throw new ProvisioningError("PROVIDER_RESPONSE_INVALID", "Document service returned an invalid submission");
    },
    async report(input: Omit<Extract<DocumentInput, { verb: "report" }>, "verb">): Promise<Report> {
      const result = await send({ ...input, verb: "report" });
      if (!validReport(result)) throw new ProvisioningError("PROVIDER_RESPONSE_INVALID", "Document service returned an invalid report");
      return result;
    },
  };
}
