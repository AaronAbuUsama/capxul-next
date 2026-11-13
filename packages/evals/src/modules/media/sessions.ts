import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asActor, post, readActors, refused, type Actor } from "../storage/actors.ts";
import type { SelectedWorld, SessionCheck } from "../storage/service.ts";

// Additive rows in the run's live world, uploaded only through the public route with Runtime's real bearers.
function png() {
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(17, 16); bytes.writeUInt32BE(31, 20);
  return bytes;
}
async function send(world: SelectedWorld, actor: Actor, purpose: "image" | "document", bytes: Buffer) {
  const content_type = purpose === "image" ? "image/png" : "application/pdf";
  const r = await post(world, "/media/files/upload", { purpose, content_type, bytesBase64: bytes.toString("base64") }, actor);
  assert.equal(r.status, 200); assert.equal(typeof r.body.file_id, "string");
  return r.body.file_id as string;
}
const pdf = (who: string) => Buffer.from(`%PDF-1.7\ncapxul eval ${who} ${randomBytes(8).toString("hex")}`);
const visible = (world: SelectedWorld, actor: Actor | null, ids: string[]) => asActor(world, actor, async (sql) =>
  (await sql.query("select file_id from app.files where file_id=any($1)", [ids])).rows.map((r) => r.file_id as string).sort());
function evidence(world: SelectedWorld, name: string, value: unknown) {
  mkdirSync(join(world.dir, "media"), { recursive: true });
  writeFileSync(join(world.dir, "media", name), JSON.stringify(value) + "\n");
}

export const mediaSessions: SessionCheck[] = [
  {
    name: "MEDIA.tenancy",
    async run(world) {
      const { actors } = readActors(world);
      const mine = await send(world, actors.person, "document", pdf("person"));
      const theirs = await send(world, actors.outsider, "document", pdf("outsider"));
      const ids = [mine, theirs];
      const seen = {
        person: await visible(world, actors.person, ids), outsider: await visible(world, actors.outsider, ids),
        anonymous: await visible(world, null, ids),
      };
      assert.deepEqual(seen, { person: [mine], outsider: [theirs], anonymous: [] });
      for (const actor of [actors.person, actors.outsider]) await asActor(world, actor, async (sql) => {
        await refused(sql, "update app.files set state='held' where file_id=any($1)", [ids]);
        await refused(sql, "delete from app.files where file_id=any($1)", [ids]);
        await refused(sql, "insert into app.files select * from app.files where file_id=any($1)", [ids]);
      });
      // A held file is never served, even to its uploader's counterpart by id.
      const served = await post(world, "/media/files/get", { file_id: mine }, actors.outsider);
      assert.deepEqual(served, { status: 200, body: null });
      const unsigned = await post(world, "/media/files/upload", { purpose: "document", content_type: "application/pdf", bytesBase64: pdf("anonymous").toString("base64") }, null);
      assert.deepEqual(unsigned, { status: 401, body: { error: "NOT_AUTHENTICATED" } });
      evidence(world, "tenancy.json", { files: { person: mine, outsider: theirs }, seen, unsignedUploadStatus: unsigned.status });
    },
  },
  {
    name: "MEDIA.admits",
    async run(world) {
      const { actors } = readActors(world);
      const bytes = png();
      const image = await send(world, actors.person, "image", bytes);
      const held = await send(world, actors.person, "document", pdf("person-held"));
      const ids = [image, held];
      const seen = {
        person: await visible(world, actors.person, ids), outsider: await visible(world, actors.outsider, ids),
        anonymous: await visible(world, null, ids),
      };
      assert.deepEqual(seen, { person: [image, held].sort(), outsider: [image], anonymous: [image] });
      for (const actor of [actors.outsider, null]) {
        const served = await post(world, "/media/files/get", { file_id: image }, actor);
        assert.equal(served.status, 200);
        assert.deepEqual(served.body, { file_id: image, content_type: "image/png", size: bytes.length, bytesBase64: bytes.toString("base64") });
      }
      for (const actor of [actors.outsider, null]) await asActor(world, actor, async (sql) => {
        await refused(sql, "update app.files set bytes=null where file_id=$1", [image]);
        await refused(sql, "delete from app.files where file_id=$1", [image]);
      });
      evidence(world, "admits.json", { files: { image, held }, seen });
    },
  },
];
