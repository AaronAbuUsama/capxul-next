// Every domain in each hub it needs (docs/roadmap.md, "Facts typed twice", the hubs; step 3.3). A domain is a folder
// under src/; the hubs that gather the domains are written by hand (src/domains.ts, src/errors.ts, src/values.ts),
// so this test reads the folders themselves and fails when a hub misses one. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { domains, Errors, Values } from "../src/door.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** The folders under src/ that hold `file`, by name. */
const foldersWith = (file: string): ReadonlyArray<string> =>
  Arr.filter(
    Arr.map(
      Arr.filter(readdirSync(SRC, { withFileTypes: true }), (entry) => entry.isDirectory()),
      (entry) => entry.name,
    ),
    (name) => existsSync(join(SRC, name, file)),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Arr.isArray(value);

/** Loads src/<folder>/<file> as a module, the same module the hubs import. */
const load = async (folder: string, file: string): Promise<Readonly<Record<string, unknown>>> => {
  const loaded: unknown = await import(new URL(`../src/${folder}/${file}`, import.meta.url).href);
  assert.ok(isRecord(loaded), `src/${folder}/${file} did not load as a module`);
  return loaded;
};

test("the folders are read: the domains this test knows of today are among them", () => {
  const found = foldersWith("domain.ts");
  for (const name of ["organizations", "people", "board", "budgets", "documents", "approvals", "world", "record"])
    assert.ok(Arr.contains(found, name), `src/${name}/domain.ts was not found`);
});

test("every folder with a domain.ts is that domain's entry in `domains`, by its folder's name", async () => {
  const hub: Readonly<Record<string, unknown>> = domains;
  for (const folder of foldersWith("domain.ts")) {
    assert.ok(Rec.has(hub, folder), `src/${folder}/domain.ts is not in src/domains.ts's \`domains\``);
    assert.equal(hub[folder], await load(folder, "domain.ts"), `domains.${folder} is not src/${folder}/domain.ts`);
  }
});

test("every folder with a refusals.ts has each of its refusals in `Errors.refusals`", async () => {
  const hub: Readonly<Record<string, unknown>> = Errors.refusals;
  for (const folder of foldersWith("refusals.ts")) {
    const own = (await load(folder, "refusals.ts"))["refusals"];
    assert.ok(isRecord(own), `src/${folder}/refusals.ts exports no \`refusals\` record`);
    assert.ok(Rec.size(own) > 0, `src/${folder}/refusals.ts's \`refusals\` is empty`);
    for (const [tag, refusal] of Rec.toEntries(own))
      assert.equal(hub[tag], refusal, `${tag} of src/${folder}/refusals.ts is not in src/errors.ts's \`refusals\``);
  }
});

test("every folder with a subjects.ts has each of its subjects among the members of `Values.Subject`", async () => {
  const members: ReadonlyArray<unknown> = Values.Subject.members;
  for (const folder of foldersWith("subjects.ts")) {
    const own = (await load(folder, "subjects.ts"))["subjects"];
    assert.ok(Arr.isArray(own), `src/${folder}/subjects.ts exports no \`subjects\` list`);
    assert.ok(own.length > 0, `src/${folder}/subjects.ts's \`subjects\` is empty`);
    for (const [index, subject] of own.entries())
      assert.ok(
        Arr.some(members, (member) => member === subject),
        `subject ${index} of src/${folder}/subjects.ts is not in src/values.ts's \`Subject\``,
      );
  }
});
