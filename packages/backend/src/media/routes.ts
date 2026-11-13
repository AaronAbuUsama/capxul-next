import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { expire, get, upload, type MediaRuntime, type Purpose } from "./files.ts";

export type MediaServices = {
  authenticate(sql: Sql, bearer: string, now: number): Promise<unknown>;
  now(sql: Sql): Promise<number>;
};
export const mediaPaths = ["/media/files/upload", "/media/files/get"] as const;
export const mediaBodyLimit = 32_000_512;

/** The same source transaction contains storage and its real shared outbox transition. */
export function mediaRuntime(now: MediaServices["now"], trace = ""): MediaRuntime {
  return { now, transitioned: async (sql, props, at) => {
    await emit(sql, {
      id: `media:${props.file_id}:${props.transition}`, name: "file_transitioned", machine: "file", entity_id: props.file_id,
      owner_kind: "person", owner_id: props.person_id, actor: props.to === "expired" ? null : props.person_id,
      trace_id: trace, at, props,
    });
  } };
}

/** POST JSON hook in a drained tenant transaction, before diagnostic HMAC ingress.
 * Upload requires real Access.authenticate + worldNow injection; image get deliberately needs no bearer.
 * Transport body bounds must be enforced before parsing JSON. All errors roll back before rendering.
 */
export async function routeMedia(sql: Sql, path: string, input: Record<string, unknown>, bearer: string,
  services: MediaServices, trace = ""): Promise<{ status: number; body: unknown } | null> {
  if (path === mediaPaths[1]) {
    if (typeof input.file_id !== "string") throw new Error("INVALID_INPUT: file id");
    const image = await get(sql, input.file_id);
    return { status: 200, body: image && { file_id: image.file_id, content_type: image.content_type,
      size: image.size, bytesBase64: image.bytes.toString("base64") } };
  }
  if (path !== mediaPaths[0]) return null;
  await services.authenticate(sql, bearer, await services.now(sql));
  if (typeof input.bytesBase64 !== "string" || !input.bytesBase64.length || input.bytesBase64.length > 32_000_000 ||
      typeof input.content_type !== "string" || typeof input.purpose !== "string" || !["image", "id-image", "document"].includes(input.purpose))
    throw new Error("INVALID_INPUT: file input");
  const bytes = Buffer.from(input.bytesBase64, "base64");
  if (bytes.toString("base64") !== input.bytesBase64) throw new Error("INVALID_INPUT: file bytes");
  return { status: 200, body: await upload(sql, { purpose: input.purpose as Purpose, content_type: input.content_type, bytes }, mediaRuntime(services.now, trace)) };
}

/** Integrator calls inside one worker transaction; no public expiration route or second outbox. */
export async function tickMedia(sql: Sql, now: MediaServices["now"], trace = "") {
  return expire(sql, mediaRuntime(now, trace));
}
