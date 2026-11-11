// Small helpers over node:http.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; body: string };

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(text);
}
export const html = (res: ServerResponse, status: number, body: string): void => send(res, status, body, "text/html");

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function page(title: string, inner: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#1b1f24}
 .standin{background:#fff4d6;border:1px solid #e0c36b;padding:.5rem .75rem;border-radius:6px;font-size:.85rem}
 dl{display:grid;grid-template-columns:8rem 1fr;gap:.35rem 1rem} dt{color:#59636e} dd{margin:0;word-break:break-all}
 button{font:inherit;padding:.6rem 1.4rem;border:0;border-radius:6px;background:#1f6feb;color:#fff;cursor:pointer}
 .person{display:block;width:100%;text-align:left;margin:.4rem 0;background:#f3f4f6;color:#1b1f24;border:1px solid #d0d7de}
 .ok{color:#116329} .bad{color:#b42318} code{font-size:.8rem}
</style>${inner}`;
}

export const parseForm = (body: string): Record<string, string> => Object.fromEntries(new URLSearchParams(body));
