// Every target packages/generate writes, rendered in memory from the records of the blueprint under `root`. Each
// target is a path under some packages/<package>/src/generated/ and the whole file, header included.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBlueprint } from "../../blueprint-engine/src/index.ts";
import { renderFacts } from "./modules/facts/service.ts";
import { withHeader } from "./modules/writer/service.ts";

type AnyRecord = Record<string, unknown> & { readonly _kind: string; readonly id: string };
const keyOf = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const isRecord = (u: unknown): u is AnyRecord =>
  typeof u === "object" && u !== null && typeof (u as { _kind?: unknown })._kind === "string" && typeof (u as { id?: unknown }).id === "string";

/** A concept's module folders: blueprint/<concept>/ and each folder in it with its own index.ts, such as
 * blueprint/payments/agreements (cut.agreements-in-payments). */
const moduleDirs = (root: string, concept: string): string[] => [
  concept,
  ...readdirSync(join(root, "blueprint", concept), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, "blueprint", concept, d.name, "index.ts")))
    .map((d) => `${concept}/${d.name}`).sort(),
];

export const render = async (root: string): Promise<Map<string, string>> => {
  const open = async (path: string) => (await import(pathToFileURL(join(root, path)).href)) as Record<string, unknown>;
  const target = await open("blueprint/index.ts");
  const { recordsOf } = (await open("blueprint/shared/index.ts")) as { recordsOf: (m: readonly object[]) => unknown[] };
  const blueprint = buildBlueprint({ name: String(target["name"] ?? "target"), stage: "target", records: target["records"] as unknown[] });
  const records = [...blueprint.records.values()] as AnyRecord[];
  const conceptOf = new Map<string, string>();
  for (const c of records.filter((r) => r._kind === "concept")) {
    for (const dir of moduleDirs(root, c.id)) {
      const modules = (await open(`blueprint/${dir}/index.ts`))["modules"] as readonly object[];
      for (const r of recordsOf(modules)) if (isRecord(r)) conceptOf.set(keyOf(r), c.id);
    }
  }
  return new Map([["packages/lint/src/generated/facts.ts", withHeader(renderFacts({ records, conceptOf }))]]);
};
