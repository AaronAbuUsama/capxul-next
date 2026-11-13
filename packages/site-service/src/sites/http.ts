import type { IncomingMessage, ServerResponse } from "node:http";

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new ServiceError(413, "INVALID_INPUT", "Request body too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

export function failure(res: ServerResponse, error: unknown): void {
  const e = error instanceof ServiceError ? error : new ServiceError(503, "PROVIDER_ERROR", "Provisioning could not finish; retry the same company");
  json(res, e.status, { error: { code: e.code, message: e.message } });
}

/** Core's log of a failure its caller sees only as PROVIDER_ERROR: the error's class and its cause's code, never a message,
 * URL or header, so no secret reaches the log. `trace` is the request's, so the line joins its span and operation row. */
export function logCause(route: string, trace: string, error: unknown): void {
  if (error instanceof ServiceError || error instanceof SyntaxError) return;
  const e = error as { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } } | null | undefined;
  const cause = e?.cause?.code ?? e?.code ?? e?.cause?.name;
  console.error(`Sites ${route} ${trace}: ${String(e?.name ?? typeof error)}${cause === undefined ? "" : ` ${String(cause)}`}`);
}
