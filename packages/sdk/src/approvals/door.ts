import { CapxulError } from "../shared/protocol/errors/model.ts";
import type { ApprovalView, ApprovalCall } from "./types.ts";
export type { ApprovalView, ApprovalState, ApprovalCall } from "./types.ts";

const codes = ["NOT_AUTHENTICATED", "INVALID_INPUT", "WRONG_STATE", "FEATURE_NOT_AVAILABLE", "PROVIDER_ERROR"] as const;
function wireError(error: unknown): CapxulError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error && typeof error.message === "string") {
    const code = codes.find((value) => value === error.code);
    if (code) return new CapxulError(code, error.message);
  }
  return new CapxulError("PROVIDER_RESPONSE_INVALID", "Invalid signing response");
}
function view(value: unknown, approvalId: string): ApprovalView {
  if (typeof value !== "object" || value === null || !("approvalId" in value) || value.approvalId !== approvalId ||
      !("state" in value) || !["sponsoring", "pending", "signed", "sending", "sent", "landed", "reverted", "displaced", "expired", "declined", "refused", "withdrawn"].includes(String(value.state))) {
    throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Invalid approval identity or state");
  }
  return value as ApprovalView;
}

/** Typed wire only. Never signs a server digest or replaces independent SafeOp verification. */
export function createApprovalsClient(options: { coreUrl: string; bearer: () => Promise<string> }) {
  const origin = new URL(options.coreUrl).origin;
  const request = async (method: string, approvalId: string, call?: ApprovalCall, signature?: string, live = false, signal?: AbortSignal) => {
    const bearer = await options.bearer();
    if (!bearer || /\s/.test(bearer)) throw new CapxulError("NOT_AUTHENTICATED", "Bearer required");
    const headers: Record<string, string> = { authorization: `Bearer ${bearer}`, accept: live ? "text/event-stream" : "application/json" };
    if (call) { headers["x-capxul-trace"] = call.traceId; headers["x-capxul-call-id"] = call.callId; headers["content-type"] = "application/json"; }
    const url = `${origin}/approvals/signing/${method}${method === "get" ? `?approvalId=${encodeURIComponent(approvalId)}` : ""}`;
    let response: Response;
    try {
      response = await fetch(url, { method: method === "get" ? "GET" : "POST", headers,
        ...(method === "get" ? {} : { body: JSON.stringify({ approvalId, ...(signature === undefined ? {} : { signature }) }) }),
        ...(signal === undefined && call?.signal === undefined ? {} : { signal: signal ?? call!.signal! }), redirect: "error" });
    } catch {
      throw new CapxulError(signal?.aborted || call?.signal?.aborted ? "CANCELLED" : "PROVIDER_ERROR", "Signing request did not complete; retry mutations with the same callId");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw wireError(body?.error);
    }
    return response;
  };
  const snapshot = async (response: Response, approvalId: string) => {
    const value = await response.json().catch(() => { throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Invalid signing JSON"); });
    return view(value, approvalId);
  };
  const mutate = async (method: string, input: { approvalId: string; signature?: string }, call: ApprovalCall) =>
    snapshot(await request(method, input.approvalId, call, input.signature), input.approvalId);
  return {
    async get(input: { approvalId: string }, signal?: AbortSignal): Promise<ApprovalView> {
      return snapshot(await request("get", input.approvalId, undefined, undefined, false, signal), input.approvalId);
    },
    review: (input: { approvalId: string }, call: ApprovalCall) => mutate("review", input, call),
    sign: (input: { approvalId: string; signature: string }, call: ApprovalCall) => mutate("sign", input, call),
    decline: (input: { approvalId: string }, call: ApprovalCall) => mutate("decline", input, call),
    async *observe(input: { approvalId: string }, signal?: AbortSignal): AsyncGenerator<ApprovalView> {
      const response = await request("get", input.approvalId, undefined, undefined, true, signal);
      if (response.headers.get("content-type")?.split(";")[0] !== "text/event-stream" || !response.body) {
        await response.body?.cancel(); throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Live signing stream required");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let pending = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            if (signal?.aborted) return;
            throw new CapxulError("PROVIDER_ERROR", "Live signing stream ended; reconnect to read current state");
          }
          pending += decoder.decode(chunk.value, { stream: true });
          if (pending.length > 1_048_576) throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Live signing frame too large");
          let end: number;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, end); pending = pending.slice(end + 2);
            const kind = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
            const raw = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
            if (!raw) continue;
            let value: unknown;
            try { value = JSON.parse(raw); } catch { throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Invalid live signing frame"); }
            if (kind === "error") throw wireError(value);
            if (kind !== "approval") throw new CapxulError("PROVIDER_RESPONSE_INVALID", "Unknown live signing event");
            yield view(value, input.approvalId);
          }
        }
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof CapxulError) throw error;
        throw new CapxulError("PROVIDER_ERROR", "Live signing stream interrupted; reconnect to read current state");
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
}
