/** GENERIC. The door module's door: `openDoor` in the process that plays a run, `knock` from any other. See types.ts. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { noteOf } from "./internal/read.ts";
import { TOKEN_HEADER, type Door, type DoorAt, type DoorDeps, type Note, type Said } from "./types.ts";

export type * from "./types.ts";
export { MAX_NOTE } from "./types.ts";

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Opens the door on a free port of this machine. The caller writes `at` where a sender will look for it. */
export const openDoor = async (deps: DoorDeps): Promise<Door> => {
  const token = randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    const answer = (status: number, said: Said): void => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(`${JSON.stringify(said)}\n`); };
    if (req.method !== "POST" || req.url !== "/note") return answer(404, { ok: false, said: "the door takes POST /note" });
    if (req.headers.origin !== undefined) return answer(403, { ok: false, said: "a web page cannot knock on a run's door" });
    if (!same(String(req.headers[TOKEN_HEADER] ?? ""), token)) return answer(403, { ok: false, said: "the token is not this run's" });
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString("utf8"); if (body.length > 64_000) req.destroy(); });
    req.on("end", () => {
      const n = noteOf(body);
      if (typeof n === "string") return answer(400, { ok: false, said: n });
      deps.note(n).then((said) => answer(200, said), (e: unknown) => answer(500, { ok: false, said: `the note was not sent: ${e instanceof Error ? e.message : String(e)}` }));
    });
  });
  await new Promise<void>((ready, failed) => { server.once("error", failed); server.listen(0, "127.0.0.1", () => ready()); });
  return { at: { port: (server.address() as { port: number }).port, token }, close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }) };
};

/** Hands a note through a run's door. A door that does not answer means the run is not being played now. */
export const knock = async (at: DoorAt, n: Note, timeoutMs = 15_000): Promise<Said> => {
  try {
    const r = await fetch(`http://127.0.0.1:${at.port}/note`, { method: "POST", headers: { "content-type": "application/json", [TOKEN_HEADER]: at.token }, body: JSON.stringify(n), signal: AbortSignal.timeout(timeoutMs) });
    const said = (await r.json()) as Partial<Said>;
    return { ok: said.ok === true, said: typeof said.said === "string" ? said.said : `the door answered ${r.status}` };
  } catch { return { ok: false, said: "the run's process did not answer: it is not being played now" }; }
};
