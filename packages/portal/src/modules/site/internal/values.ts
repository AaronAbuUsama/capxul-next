/** Narrowing and tidying of the unknown values a record holds. */
import type { AnyRecord } from "@capxul/book";

export type Fields = Readonly<Record<string, unknown>>;

export const isObject = (u: unknown): u is Fields => typeof u === "object" && u !== null && !Array.isArray(u);

/** A record, wherever it is held: a link is the linked record itself. */
export const isRecord = (u: unknown): u is AnyRecord =>
  isObject(u) && typeof u["_kind"] === "string" && typeof u["id"] === "string";

/** Any value as one line of text: whitespace collapsed, nothing for null. */
export const text = (u: unknown): string =>
  (typeof u === "string" ? u : typeof u === "number" || typeof u === "boolean" ? String(u) : "").replace(/\s+/g, " ").trim();

export const list = (u: unknown): readonly unknown[] => (Array.isArray(u) ? (u as readonly unknown[]) : []);
export const objects = (u: unknown): readonly Fields[] => list(u).filter(isObject);
export const records = (u: unknown): readonly AnyRecord[] => list(u).filter(isRecord);
export const entries = (u: unknown): readonly (readonly [string, unknown])[] => (isObject(u) ? Object.entries(u) : []);
export const field = (u: unknown, key: string): unknown => (isObject(u) ? u[key] : undefined);

/** Items grouped by a key, in first-seen order. */
export const group = <T>(items: readonly T[], keyOf: (item: T) => string): ReadonlyMap<string, readonly T[]> => {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const held = out.get(key);
    if (held) held.push(item);
    else out.set(key, [item]);
  }
  return out;
};

/** `1,234`: a count as the pages print it. */
export const count = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;
