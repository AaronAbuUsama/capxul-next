import { createHmac, randomUUID } from "node:crypto";
import { Context, Effect, Layer, Schedule, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as C from "./site-contracts.ts";

export { FrappeSiteError } from "./site-contracts.ts";
export type { AccountInput, DoorInput, ReportInput, SiteInput } from "./site-contracts.ts";
type Result<A> = Effect.Effect<A, C.FrappeSiteError>;

export class FrappeSite extends Context.Service<FrappeSite, {
  applyEvent(input: C.EventInput): Result<C.SiteAck>;
  retryParkedEvent(input: C.SiteInput & { event_key: string }): Result<C.SiteAck>;
  collectPaymentRequests(input: C.SiteInput & { after: number; limit?: number }): Result<C.Collection>;
  answerPaymentRequest(input: C.AnswerInput): Result<typeof C.AnswerAck.Type>;
  paymentRequestListener(input: C.SiteInput): Result<typeof C.Listener.Type>;
  readSite(input: C.SiteInput): Result<typeof C.SiteInfo.Type>;
  mintViewLink(input: C.SiteInput & { user: string }): Result<typeof C.ViewLink.Type>;
  resolveAccount(input: C.AccountInput): Result<typeof C.Document.Type>;
  doorCall(input: C.DoorInput): Result<typeof C.DocumentResult.Type>;
  doorReport(input: C.ReportInput): Result<typeof C.Report.Type>;
}>()("@capxul/backend/plugs/FrappeSite") {}

/** The backend chooses the transport origin and secret; neither is a person's RPC argument. */
export function createFrappeSite(options: { baseUrl: string; secret: string }): FrappeSite["Service"] {
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/" || !options.secret)
    throw new Error("FrappeSite requires a configured HTTP(S) origin and secret");
  const mac = (raw: string) => createHmac("sha256", options.secret).update(raw).digest("hex");

  const request = Effect.fn("FrappeSite.request")(function*<A>(
    operation: string, method: string, input: C.SiteInput, body: Record<string, unknown>,
    schema: Schema.Codec<A, unknown>, user?: string,
  ): Effect.fn.Return<A, C.FrappeSiteError, HttpClient.HttpClient> {
    const raw = JSON.stringify({ ...body, org: input.orgId });
    const headers: Record<string, string> = {
      "x-capxul-signature": mac(raw), "x-frappe-site-name": input.site,
      ...(input.traceId ? { "x-capxul-trace": input.traceId } : {}),
    };
    if (user) {
      const assertion = JSON.stringify({ u: user, s: input.site, exp: Math.floor(Date.now() / 1000) + 60, nonce: randomUUID() });
      headers["x-capxul-assertion"] = Buffer.from(assertion).toString("base64url") + "." + mac(assertion);
    }
    const unavailable = (httpStatus?: number) => new C.FrappeSiteError({ code: "PROVIDER_ERROR", operation,
      message: "The site did not accept the request", ...(httpStatus === undefined ? {} : { httpStatus }) });
    const invalid = () => new C.FrappeSiteError({ code: "PROVIDER_RESPONSE_INVALID", operation,
      message: "The site answered an invalid response" });
    const client = yield* HttpClient.HttpClient;
    const response = yield* HttpClientRequest.post(new URL(`/api/method/${method}`, base).href).pipe(
      HttpClientRequest.setHeaders(headers), HttpClientRequest.bodyText(raw, "application/json"), client.execute,
      Effect.mapError(() => unavailable()),
    );
    if (response.status === 401 || response.status === 429 || response.status >= 500 || response.status >= 300 && response.status < 400)
      return yield* unavailable(response.status);
    const json = yield* response.json.pipe(Effect.mapError(() => response.status >= 400 ? unavailable(response.status) : invalid()));
    if (response.status === 409 && operation === "applyEvent") {
      const conflict = yield* Schema.decodeUnknownEffect(C.CursorConflict)(json).pipe(Effect.mapError(invalid));
      return yield* new C.FrappeSiteError({ code: "WRONG_STATE", operation, httpStatus: 409,
        message: "The site expects another sequence", expected: conflict.expected });
    }
    if (response.status >= 400 && Schema.is(C.NativeError)(json)) {
      const code = json.exc_type === "FeatureNotAvailable" ? "FEATURE_NOT_AVAILABLE"
        : operation === "readSite" && response.status === 417 ? "WRONG_STATE"
        : ["DoesNotExistError", "DataError", "MandatoryError"].includes(json.exc_type) ? "INVALID_INPUT"
        : ["PermissionError", "ValidationError", "WorkflowPermissionError"].includes(json.exc_type) ? "ROLE_PERMISSION_DENIED" : "PROVIDER_ERROR";
      return yield* new C.FrappeSiteError({ code, operation, httpStatus: response.status,
        message: code === "WRONG_STATE" ? "The site does not implement this Capxul contract" : "The site refused the request" });
    }
    const envelope = yield* Schema.decodeUnknownEffect(Schema.Struct({ message: Schema.Unknown }))(json).pipe(
      Effect.mapError(() => response.status >= 400 ? unavailable(response.status) : invalid()));
    if (operation === "doorCall" || operation === "doorReport" || operation === "resolveAccount") {
      const product = yield* Schema.decodeUnknownEffect(Schema.Union([
        C.Refusal, Schema.Struct({ ok: Schema.Literal(true), data: Schema.Unknown }),
      ]))(envelope.message).pipe(Effect.mapError(invalid));
      if (!product.ok) return yield* new C.FrappeSiteError({ ...product.error, operation, httpStatus: response.status });
      if (response.status >= 300) return yield* invalid();
      return yield* Schema.decodeUnknownEffect(schema)(product.data).pipe(Effect.mapError(invalid));
    }
    if (response.status < 200 || response.status >= 300) {
      if (operation === "mintViewLink" || operation === "readSite") {
        const parsed = yield* Schema.decodeUnknownEffect(C.Refusal)(envelope.message).pipe(Effect.mapError(() => unavailable(response.status)));
        return yield* new C.FrappeSiteError({ ...parsed.error, operation, httpStatus: response.status });
      }
      return yield* unavailable(response.status);
    }
    return yield* Schema.decodeUnknownEffect(schema)(envelope.message).pipe(Effect.mapError(invalid));
  });

  const call = <A>(operation: string, method: string, input: C.SiteInput,
    body: Record<string, unknown>, schema: Schema.Codec<A, unknown>, timeout = 10000, retries = 3, user?: string) =>
    request(operation, method, input, body, schema, user).pipe(
      Effect.timeout(timeout),
      Effect.catchTag("TimeoutError", () => new C.FrappeSiteError({ code: "PROVIDER_ERROR", operation, message: "The site request timed out" })),
      Effect.retry({ times: retries, schedule: Schedule.exponential(100),
        while: (error) => error.code === "PROVIDER_ERROR" && (error.httpStatus === undefined || error.httpStatus === 429 || error.httpStatus >= 500) }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    );

  return FrappeSite.of({
    applyEvent: (i) => call("applyEvent", "capxul.api.chain_event", i,
      { event_key: i.event_key, seq: i.seq, kind: i.kind, data: i.data }, C.SiteAck),
    retryParkedEvent: (i) => call("retryParkedEvent", "capxul.api.retry_parked_event", i, { event_key: i.event_key }, C.SiteAck),
    collectPaymentRequests: Effect.fn("FrappeSite.collectPaymentRequests")(function*(i) {
      const result = yield* call("collectPaymentRequests", "capxul.api.collect_payment_requests", i,
        { after: i.after, limit: i.limit ?? 100 }, C.Collection, 30000);
      let cursor = i.after;
      for (const row of result.requests) {
        if (row.org !== i.orgId || row.site !== i.site || row.cursor <= cursor || row.idempotency_key !== row.request_id)
          return yield* new C.FrappeSiteError({ code: "PROVIDER_RESPONSE_INVALID", operation: "collectPaymentRequests", message: "Invalid request scope or ordering" });
        cursor = row.cursor;
      }
      if (cursor !== result.cursor) return yield* new C.FrappeSiteError({ code: "PROVIDER_RESPONSE_INVALID", operation: "collectPaymentRequests", message: "Invalid collection cursor" });
      return result;
    }),
    answerPaymentRequest: Effect.fn("FrappeSite.answerPaymentRequest")(function*(i) {
      const { orgId, site, traceId, ...answer } = i;
      const ack = yield* call("answerPaymentRequest", "capxul.api.answer_payment_request", i, answer, C.AnswerAck);
      if (ack.request_id !== i.request_id) return yield* new C.FrappeSiteError({ code: "PROVIDER_RESPONSE_INVALID", operation: "answerPaymentRequest", message: "Answer acknowledged another request" });
      return ack;
    }),
    paymentRequestListener: Effect.fn("FrappeSite.paymentRequestListener")(function*(i) {
      const token = yield* call("paymentRequestListener", "capxul.api.payment_request_listener", i, {}, C.Listener);
      const now = Date.now() / 1000;
      if (token.namespace !== `/${i.site}` || !token.authorization.startsWith("CapxulListener ") || token.expires_at <= now || token.expires_at > now + 60)
        return yield* new C.FrappeSiteError({ code: "PROVIDER_RESPONSE_INVALID", operation: "paymentRequestListener", message: "Invalid listener scope or expiry" });
      return token;
    }),
    readSite: (i) => call("readSite", "capxul.service.read_site", i, {}, C.SiteInfo, 5000, 2),
    mintViewLink: (i) => call("mintViewLink", "capxul.service.mint_view_link", i, { user: i.user }, C.ViewLink, 10000, 2),
    resolveAccount: (i) => call("resolveAccount", "capxul.product_door.account", i, { reference: i.reference },
      C.Document.pipe(Schema.check(Schema.makeFilter((doc) => doc.doctype === "Account"))), 15000, 2, i.user),
    doorCall: (i) => call("doorCall", "capxul.product_door.run", i, { verb: i.verb, doctype: i.doctype,
      name: i.name, fields: i.fields, call_id: i.callId }, C.DocumentResult, 15000, 2, i.user),
    doorReport: (i) => call("doorReport", "capxul.product_door.report", i,
      { report: i.report, filters: i.filters }, C.Report, 30000, 1, i.user),
  });
}

export const frappeSiteLayer = (options: Parameters<typeof createFrappeSite>[0]) => Layer.succeed(FrappeSite, createFrappeSite(options));
