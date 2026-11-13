import type { Sql } from "../platform/db.ts";
import { newId } from "../platform/id.ts";

export type Purpose = "image" | "id-image" | "document";
export type Upload = { purpose: Purpose; content_type: string; bytes: Uint8Array };
export type FileTransition = { from: "held" | null; to: "kept" | "held" | "expired"; transition: "keep" | "hold" | "expire"; file_id: string; person_id: string; purpose: Purpose };
/** Composition injects worldNow and the shared transactional outbox, on this same Sql. */
export type MediaRuntime = {
  now(sql: Sql): Promise<number>;
  transitioned(sql: Sql, props: FileTransition, at: number): Promise<void>;
};

/** Dimensions come from the file, never from caller-supplied metadata. */
function dimensions(bytes: Buffer, type: string): [number, number] | undefined {
  if (type === "image/png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && bytes.toString("ascii", 12, 16) === "IHDR")
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (type === "image/jpeg" && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 3 < bytes.length) {
      if (bytes[at++] !== 255) return;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 217 || marker === 218) return;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) return;
      const length = bytes.readUInt16BE(at);
      if (length < 2 || at + length > bytes.length) return;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) return;
        return [bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 3)];
      }
      at += length;
    }
  }
}

export function admit(input: Upload): Buffer {
  const bytes = Buffer.from(input.bytes);
  const limits = { image: 5 * 1024 * 1024, "id-image": 15_000_000, document: 24_000_000 };
  const types = { image: ["image/jpeg", "image/png", "image/webp"], "id-image": ["image/jpeg", "image/png"], document: ["image/jpeg", "image/png", "application/pdf"] };
  if (!types[input.purpose]?.includes(input.content_type)) throw new Error("INVALID_INPUT: file type");
  if (!bytes.length || bytes.length > limits[input.purpose]) throw new Error("INVALID_INPUT: file size");
  const size = dimensions(bytes, input.content_type);
  const matches = size && size[0] > 0 && size[1] > 0 ||
    input.content_type === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ||
    input.content_type === "application/pdf" && /^%PDF-[12]\./.test(bytes.toString("ascii", 0, 8));
  if (!matches) throw new Error("INVALID_INPUT: file bytes do not match type");
  if (input.purpose === "id-image" && (!size || size[0] < 200 || size[1] < 200)) throw new Error("INVALID_INPUT: file pixels");
  return bytes;
}

export async function upload(sql: Sql, input: Upload, runtime: MediaRuntime) {
  const bytes = admit(input);
  const at = await runtime.now(sql);
  const id = newId("file", at);
  const row = (await sql.query(`select * from app.media_upload($1,$2,$3,$4,$5)`, [id, input.purpose, input.content_type, bytes, at])).rows[0]!;
  await runtime.transitioned(sql, { from: null, to: row.state, transition: row.state === "kept" ? "keep" : "hold", file_id: id, person_id: row.person_id, purpose: row.purpose }, at);
  return { file_id: row.file_id, purpose: row.purpose, content_type: row.content_type, size: Number(row.size), expires_at: row.expires_at === null ? null : Number(row.expires_at) };
}

/** Public image serving is deliberately narrower than the uploader's own table read. */
export async function get(sql: Sql, id: string) {
  if (!/^file_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) throw new Error("INVALID_INPUT: file id");
  const row = (await sql.query("select file_id,content_type,size,bytes from app.files where file_id=$1 and purpose='image' and state='kept'", [id])).rows[0];
  return row ? { ...row, size: Number(row.size) } as { file_id: string; content_type: string; size: number; bytes: Buffer } : null;
}

/** Binding admission, not public serving: uploader comes only from verified Access context.
 * Purpose, signatures, dimensions and size were admitted at immutable upload; do not re-decode bytes.
 */
export async function requireImage(sql: Sql, id: string): Promise<{ file_id: string; content_type: string; size: number }> {
  if (!/^file_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) throw new Error("INVALID_INPUT: image file");
  const row = (await sql.query("select * from app.media_require_image($1)", [id])).rows[0];
  if (!row) throw new Error("INVALID_INPUT: image file");
  return { file_id: row.file_id, content_type: row.content_type, size: Number(row.size) };
}

/** Each held row is its durable timer; the conditional transition survives worker restart. */
export async function expire(sql: Sql, runtime: MediaRuntime) {
  const at = await runtime.now(sql);
  const events = (await sql.query("select * from app.media_expire($1)", [at])).rows.map((r) => r.media_expire as FileTransition);
  for (const props of events) await runtime.transitioned(sql, props, at);
  return events;
}
