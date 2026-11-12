import { createHash } from "node:crypto";

/** A collection member's identity, never its position. Object keys are canonical; array order is meaningful. */
export const evalKey = (identity: unknown, key?: string): string => {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  return key ?? `c-${createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex").slice(0, 16)}`;
};
