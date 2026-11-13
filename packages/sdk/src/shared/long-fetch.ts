/** Node-only (`@capxul/sdk/node`). Node's built-in fetch abandons a request when response headers take longer than
 * undici's 300 s `headersTimeout`, whatever its AbortSignal says. Site creation can take longer on a loaded bench, so
 * calls that wait for it use this fetch-compatible request instead. Only the signal and the idle limit end it. */
import { request as http } from "node:http";
import { request as https } from "node:https";

export function longFetch(idleMs: number): typeof fetch {
  return (input, init = {}) => new Promise<Response>((resolve, reject) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const req = (url.protocol === "https:" ? https : http)(url, { method: init.method ?? "GET", headers, timeout: idleMs,
      ...(init.signal ? { signal: init.signal } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: res.statusCode ?? 502,
        headers: Object.entries(res.headers).flatMap(([k, v]) => v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string])) })));
    });
    req.on("timeout", () => req.destroy(new Error(`No activity for ${idleMs} ms`)));
    req.on("error", reject);
    req.end(init.body == null ? undefined : String(init.body));
  });
}
