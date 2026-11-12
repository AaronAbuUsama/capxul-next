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
