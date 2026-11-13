import { Schema } from "effect";

export const Row = Schema.Record(Schema.String, Schema.Unknown);
const Text = Schema.String.check(Schema.isMinLength(1));
const Cursor = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Int.check(Schema.isGreaterThan(0));

export const SiteAck = Schema.Union([
  Schema.Struct({ applied: Schema.Literal(true), duplicate: Schema.Literal(false), parked: Schema.optionalKey(Schema.Literal(false)), last_seq: Cursor,
    map_version: Schema.optionalKey(Text) }),
  Schema.Struct({ applied: Schema.Literal(false), duplicate: Schema.Literal(true), parked: Schema.optionalKey(Schema.Literal(false)), last_seq: Cursor,
    map_version: Schema.optionalKey(Text) }),
  Schema.Struct({ applied: Schema.Literal(false), duplicate: Schema.Literal(false), parked: Schema.Literal(true),
    last_seq: Cursor, error: Text, map_version: Schema.optionalKey(Text) }),
]);
export type SiteAck = typeof SiteAck.Type;

export const RequestBody = Schema.Struct({
  request_id: Text, idempotency_key: Text, cursor: Positive, trace_id: Schema.String,
  org: Text, site: Text, doctype: Schema.Literal("Payment Entry"), name: Text,
  document_hash: Text, requested_by: Text, to_party: Text, to_address: Text,
  amount: Text, asset: Text, department: Schema.String,
});
export const Collection = Schema.Struct({ requests: Schema.Array(RequestBody), cursor: Cursor });
export type Collection = typeof Collection.Type;
export const AnswerAck = Schema.Struct({ request_id: Text, status: Schema.Literals([
  "Requesting", "Waiting for signature", "Sent", "Failed", "Mismatch", "Abandoned", "Reversed",
]), duplicate: Schema.Boolean });
export const Listener = Schema.Struct({ authorization: Text, namespace: Text,
  event: Schema.Literal("capxul_payment_request"), expires_at: Positive });

export const SiteInfo = Schema.Struct({
  version: Text, apps: Schema.Array(Text), company: Text,
  features: Schema.Record(Schema.String, Schema.Literals(["on", "off"])), map_version: Text,
  sign_in: Schema.Struct({ mode: Schema.Literal("assertion"), configured: Schema.Boolean, oauth: Schema.Boolean }),
});
// Release admission, not a copy of editable native rows or numeric chain-hat metadata.
export const HatMap = Schema.Struct({
  map_version: Schema.Literal("sha256:8187889ed3db0e6b878dd8e8db524030d61f61e2d716c16f53e28c2768e5b348"),
  hats: Schema.Record(Text, Schema.Array(Text)), available_roles: Schema.Array(Text),
});
export const ViewLink = Schema.Struct({ url: Text, expiresAt: Positive, readOnly: Schema.Literal(true) });
export const Report = Schema.Struct({ columns: Schema.Array(Row), rows: Schema.Array(Row) });
export const SafeRequest = Schema.Struct({ safe: Schema.Literal(true), status: Schema.Literal("Requesting"),
  approval_url: Schema.Null, request: Text });
export const Document = Schema.Struct({ doctype: Text, name: Text, docstatus: Schema.Literals([0, 1, 2]), fields: Row });
export const DocumentResult = Schema.Union([Document, SafeRequest]);

export interface SiteInput { orgId: string; site: string; traceId?: string }
export interface EventInput extends SiteInput {
  event_key: string; seq: number; kind: string; data: unknown;
}
export type DoorInput = SiteInput & { user: string; doctype: string; name?: string; fields?: Record<string, unknown> } & (
  { verb: "get"; callId?: never } | { verb: "create" | "submit"; callId: string }
);
export interface AccountInput extends SiteInput { user: string; reference: string }
export interface ReportInput extends SiteInput {
  user: string; report: string; filters: Record<string, unknown>;
}
export type AnswerInput = SiteInput & { request_id: string } & (
  { approval_id: string; approval_url: string; requested_by: string; awaiting?: string } |
  { error: { code: string; message: string } }
);

export const ErrorCode = Schema.Literals([
  "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID", "ROLE_PERMISSION_DENIED", "FEATURE_NOT_AVAILABLE", "INVALID_INPUT", "WRONG_STATE",
]);
export class FrappeSiteError extends Schema.TaggedError<FrappeSiteError>()("FrappeSiteError", {
  code: ErrorCode, operation: Schema.String, message: Schema.String,
  httpStatus: Schema.optionalKey(Schema.Int), expected: Schema.optionalKey(Positive),
}) {}

export const Refusal = Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: ErrorCode, message: Schema.String }) });
export const CursorConflict = Schema.Struct({ expected: Positive });
export const NativeError = Schema.Struct({ exc_type: Text });
