/**
 * A JSON Schema as text a reader can copy: a JSON skeleton of placeholders, and a TypeScript type.
 * Both are generated from the schema. Neither is a recorded value, and a placeholder never looks like one.
 */
import { entries, field, isObject, list, text } from "./values.ts";

/** How deep a shape is followed before it is cut short. */
const DEPTH = 12;

const literalsOf = (s: unknown): readonly unknown[] => {
  const choices = list(field(s, "enum"));
  if (choices.length > 0) return choices;
  return isObject(s) && "const" in s ? [s["const"]] : [];
};
const membersOf = (s: unknown): readonly unknown[] => [...list(field(s, "anyOf")), ...list(field(s, "oneOf"))];
const isNull = (s: unknown): boolean => field(s, "type") === "null" || (literalsOf(s).length === 1 && literalsOf(s)[0] === null);
const refName = (s: unknown): string => text(field(s, "$ref")).split("/").pop() ?? "";
const isShape = (s: unknown): boolean => field(s, "type") === "object" || field(s, "properties") !== undefined;

/** A scalar's name inside a placeholder: `string`, `number`, or the name a `$ref` points at. */
const scalar = (s: unknown): string => refName(s) || text(field(s, "type")) || "unknown";

/**
 * The placeholder of a schema: a literal as itself (the first of several), an object with every field, an array of
 * one item, and any other value as `<type>`, with `| null` inside the brackets where null is allowed.
 */
export const placeholder = (s: unknown, depth = 0): unknown => {
  const literals = literalsOf(s);
  if (literals.length > 0) return literals[0] ?? null;
  const members = membersOf(s);
  if (members.length > 0) {
    const rest = members.filter((m) => !isNull(m));
    const [first] = rest;
    if (first === undefined) return null;
    const shown = placeholder(first, depth);
    const nullable = rest.length < members.length;
    const scalars = rest.every((m) => literalsOf(m).length === 0 && membersOf(m).length === 0 && !isShape(m) && field(m, "type") !== "array");
    return scalars ? `<${[...new Set(rest.map(scalar))].join(" | ")}${nullable ? " | null" : ""}>` : shown;
  }
  if (isShape(s)) {
    return depth >= DEPTH ? {} : Object.fromEntries(entries(field(s, "properties")).map(([k, v]) => [k, placeholder(v, depth + 1)]));
  }
  if (field(s, "type") === "array") return depth >= DEPTH ? [] : [placeholder(field(s, "items"), depth + 1)];
  if (field(s, "type") === "null") return null;
  return `<${scalar(s)}>`;
};

/** A schema's JSON skeleton, two spaces to a level, in the schema's own field order. */
export const skeletonOf = (s: unknown): string => JSON.stringify(placeholder(s), null, 2);

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TS: Readonly<Record<string, string>> = { string: "string", number: "number", integer: "number", boolean: "boolean", null: "null" };

/** A schema as a TypeScript type, nested fields indented under `pad`. */
export const typeScriptOf = (s: unknown, pad = "", depth = 0): string => {
  const literals = literalsOf(s);
  if (literals.length > 0) return literals.map((l) => JSON.stringify(l) ?? "unknown").join(" | ");
  const members = membersOf(s);
  if (members.length > 0) return [...new Set(members.map((m) => typeScriptOf(m, pad, depth)))].join(" | ");
  if (isShape(s)) {
    const fields = entries(field(s, "properties"));
    if (fields.length === 0 || depth >= DEPTH) return "Record<string, unknown>";
    const required = new Set(list(field(s, "required")).map(text));
    const lines = fields.map(([k, v]) =>
      `${pad}  ${NAME.test(k) ? k : JSON.stringify(k)}${required.has(k) ? "" : "?"}: ${typeScriptOf(v, `${pad}  `, depth + 1)};`);
    return `{\n${lines.join("\n")}\n${pad}}`;
  }
  if (field(s, "type") === "array") {
    const item = typeScriptOf(field(s, "items"), pad, depth + 1);
    return item.includes(" | ") ? `Array<${item}>` : `${item}[]`;
  }
  return refName(s) || TS[text(field(s, "type"))] || "unknown";
};
