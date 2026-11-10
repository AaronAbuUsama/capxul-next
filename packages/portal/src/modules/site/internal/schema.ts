/**
 * Records and schemas as JSON: a record's fields with every link as its key and every schema as JSON Schema, and
 * the field rows a page shows for a schema. Canonical JSON (sorted keys) keeps two generations byte-identical.
 */
import { createHash } from "node:crypto";

import { Schema } from "effect";
import { keyOf } from "@capxul/blueprint-engine";

import type { FieldRow, Variant } from "../types.ts";
import { skeletonOf } from "./skeleton.ts";
import { entries, field, isObject, isRecord, list, text } from "./values.ts";

/** A record's own fields; a parent's child maps (`t`, `c`, `f`, `e`) repeat what its other fields say. */
const SKIPPED = new Set(["_kind", "t", "c", "f", "e"]);

/** A schema held as a value, as JSON Schema (draft 2020-12); null when it has no JSON form. */
export const jsonSchemaOf = (u: unknown): unknown => {
  if (!Schema.isSchema(u)) return null;
  try {
    return toJson(Schema.toJsonSchemaDocument(u).schema);
  } catch {
    return null;
  }
};

/** Any value a record holds, as JSON: a link becomes its key, a schema its JSON Schema. */
export const toJson = (u: unknown): unknown => {
  if (u === null || typeof u === "string" || typeof u === "number" || typeof u === "boolean") return u;
  if (Schema.isSchema(u)) return { jsonSchema: jsonSchemaOf(u) };
  if (isRecord(u)) return keyOf(u);
  if (Array.isArray(u)) return list(u).map((x) => toJson(x) ?? null);
  if (isObject(u)) return objectJson(entries(u));
  return undefined;
};

const objectJson = (fields: readonly (readonly [string, unknown])[]): unknown =>
  Object.fromEntries(fields.flatMap(([k, v]) => { const j = toJson(v); return j === undefined ? [] : [[k, j] as const]; }));

/** A record's fields as JSON: what its page shows, and what its hash covers. */
export const recordJson = (r: unknown): unknown => objectJson(entries(r).filter(([k]) => !SKIPPED.has(k)));

const sorted = (u: unknown): unknown => {
  if (Array.isArray(u)) return list(u).map(sorted);
  if (!isObject(u)) return u ?? null;
  return Object.fromEntries(Object.keys(u).toSorted().map((k) => [k, sorted(u[k])]));
};

/** JSON with sorted keys and a two-space indent: the same value always gives the same bytes. */
export const canonical = (u: unknown): string => `${JSON.stringify(sorted(u), null, 2)}\n`;

export const hashOf = (u: unknown): string => createHash("sha256").update(canonical(u)).digest("hex").slice(0, 16);

// ── a schema's fields, from its JSON Schema ─────────────────────────────────────────────────────

const SAFE = Number.MAX_SAFE_INTEGER;
const literal = (u: unknown): string =>
  typeof u === "string" ? `"${u}"` : typeof u === "number" || typeof u === "boolean" ? `${u}` : "null";

/** A JSON Schema's type in words: `string`, `"settled" | "failed"`, `integer[]`, `string | null`. */
export const typeText = (s: unknown): string => {
  const choices = list(field(s, "enum"));
  if (choices.length > 0) return choices.map(literal).join(" | ");
  if (field(s, "const") !== undefined) return literal(field(s, "const"));
  const members = [...list(field(s, "anyOf")), ...list(field(s, "oneOf"))];
  if (members.length > 0) return [...new Set(members.map(typeText))].join(" | ");
  const type = field(s, "type");
  if (type === "array") return `${typeText(field(s, "items"))}[]`;
  if (type === "object") return field(s, "properties") === undefined ? "record" : "object";
  return text(type) || "unknown";
};

const bound = (s: unknown, key: string, sign: string): readonly string[] => {
  const n = field(s, key);
  return typeof n === "number" && Math.abs(n) !== SAFE ? [`${sign} ${n}`] : [];
};

/** A JSON Schema's limits in words: `> 0`, `1 to 128 characters`. */
const noteOf = (s: unknown): string => {
  const min = field(s, "minLength");
  const max = field(s, "maxLength");
  const length = typeof min === "number" && typeof max === "number" ? [`${min} to ${max} characters`] : [];
  const own = [
    ...bound(s, "minimum", "≥"), ...bound(s, "exclusiveMinimum", ">"),
    ...bound(s, "maximum", "≤"), ...bound(s, "exclusiveMaximum", "<"), ...length,
  ];
  return [...new Set([...own, ...list(field(s, "anyOf")).map(noteOf).filter(Boolean)])].join("; ");
};

/** Every field of an object schema, nested ones as `transfer.state` and array items as `accounts[].id`. */
export const fieldsOf = (schema: unknown, prefix = ""): readonly FieldRow[] => {
  const required = new Set(list(field(schema, "required")).map(text));
  return entries(field(schema, "properties")).flatMap(([name, s]) => {
    const path = `${prefix}${name}`;
    const self: FieldRow = { path, type: typeText(s), required: required.has(name), note: noteOf(s) };
    const element = field(s, "items");
    const inner =
      field(s, "properties") !== undefined ? fieldsOf(s, `${path}.`)
      : field(element, "properties") !== undefined ? fieldsOf(element, `${path}[].`)
      : [];
    return [self, ...inner];
  });
};

/** What marks one variant of a union apart: its constant fields, as `kind "sent"`. */
const labelOf = (s: unknown, n: number): string => {
  const marks = entries(field(s, "properties")).flatMap(([name, p]) => {
    const only = field(p, "const") ?? (list(field(p, "enum")).length === 1 ? list(field(p, "enum"))[0] : undefined);
    return only === undefined ? [] : [`${name} ${literal(only)}`];
  });
  return marks.length > 0 ? marks.join(", ") : `shape ${n}`;
};

/** A schema held as a value, as the shapes it admits. A union of objects gives one variant per member. */
export const variantsOf = (u: unknown): readonly Variant[] => {
  const s = jsonSchemaOf(u);
  if (s === null) return [];
  const members = [...list(field(s, "anyOf")), ...list(field(s, "oneOf"))].filter((m) => field(m, "properties") !== undefined);
  if (members.length > 1) return members.map((m, i) => ({ label: labelOf(m, i + 1), rows: fieldsOf(m), skeleton: skeletonOf(m) }));
  const one = members[0] ?? (field(s, "type") === "array" ? field(s, "items") : s);
  const rows = fieldsOf(one, members.length === 0 && field(s, "type") === "array" ? "[]." : "");
  return [{
    label: "", rows: rows.length > 0 ? rows : [{ path: "(value)", type: typeText(s), required: true, note: noteOf(s) }],
    skeleton: skeletonOf(s),
  }];
};
