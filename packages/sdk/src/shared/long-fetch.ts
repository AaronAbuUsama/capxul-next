/** Node-only (`@capxul/sdk/node`). Node's built-in fetch abandons a request when response headers take longer than
 * undici's 300 s `headersTimeout`, whatever its AbortSignal says. Site creation can take longer on a loaded bench, so
 * calls that wait for it use this request instead. Only the signal and the idle limit end it.
 * It is narrower than fetch: a URL string, a string body or none, and redirects are answered as they are, never followed. */
import { request as http } from "node:http";
import { request as https } from "node:https";

export type TextFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export function longFetch(idleMs: number): TextFetch {
  return (input, init) => new Promise<Response>((resolve, reject) => {
    if (init.body !== undefined && typeof init.body !== "string") return reject(new TypeError("longFetch sends only a string body"));
    const url = new URL(input);
    const req = (url.protocol === "https:" ? https : http)(url, { method: init.method, headers: init.headers ?? {}, timeout: idleMs,
      ...(init.signal ? { signal: init.signal } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        // Response refuses a status outside 200-599 or a body on 204/304; that is the peer's fault, never a crash.
        try {
          resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: res.statusCode ?? 502,
            headers: Object.entries(res.headers).flatMap(([k, v]) => v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string])) }));
        } catch (error) { reject(error); }
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error(`No activity for ${idleMs} ms`), { code: "IDLE_TIMEOUT" })));
    req.on("error", reject);
    req.end(init.body);
  });
}
