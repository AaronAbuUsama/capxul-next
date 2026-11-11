/** A binding file as parsed JSON: its shape, and nothing about the blueprint or the script yet. */
import type { Binding, BindingFile, NearMiss, Result } from "../types.ts";

const isObject = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u);
const text = (u: unknown): u is string => typeof u === "string" && u.trim() !== "";
const texts = (u: unknown): u is readonly string[] => Array.isArray(u) && u.length > 0 && u.every(text);

export const parseFile = (source: string, json: unknown): Result<BindingFile> => {
  if (!isObject(json)) return { ok: false, errors: [`${source}: not an object`] };
  const errors: string[] = [];
  const at = (where: string, why: string) => errors.push(`${source}: ${where}: ${why}`);
  if (!text(json["area"])) at("area", "a name is needed");
  if (!text(json["script"])) at("script", "the path of the script is needed");
  if (!texts(json["worlds"])) at("worlds", "a list of the worlds the script runs against is needed");
  const secrets = json["secrets"] ?? [];
  if (!Array.isArray(secrets) || !secrets.every(text)) at("secrets", "a list of file paths is needed, or leave it out");
  const rows = (key: string, need: string): Record<string, unknown>[] => {
    const v = json[key] ?? [];
    if (!Array.isArray(v)) { at(key, "a list is needed"); return []; }
    return v.flatMap((row, i) => {
      if (!isObject(row)) { at(`${key}[${i}]`, "not an object"); return []; }
      if (!text(row["eval"])) at(`${key}[${i}]`, "eval: an eval id is needed");
      if (!texts(row["checks"])) at(`${key}[${i}]`, "checks: at least one check name is needed");
      if (!text(row[need])) at(`${key}[${i}] (${String(row["eval"])})`, `${need}: the reason in words is needed`);
      return [row];
    });
  };
  const bindings: Binding[] = rows("bindings", "why").map((r) => ({ eval: String(r["eval"]), checks: (r["checks"] as readonly string[]) ?? [], why: String(r["why"]) }));
  const near: NearMiss[] = rows("near", "missing").map((r) => ({ eval: String(r["eval"]), checks: (r["checks"] as readonly string[]) ?? [], missing: String(r["missing"]) }));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { source, area: String(json["area"]), script: String(json["script"]), worlds: json["worlds"] as readonly string[], secrets: secrets as readonly string[], bindings, near } };
};
