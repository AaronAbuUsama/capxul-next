// A readable table for a list of rows (the output without --json).
const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
};
export function table(rows: Record<string, unknown>[], cols?: string[]): string[] {
  if (!rows.length) return ["(none)"];
  const keys = cols ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const w = keys.map((k) => Math.max(k.length, ...rows.map((r) => cell(r[k]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(keys), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(keys.map((k) => cell(r[k]))))];
}
export function show(v: unknown): string[] {
  if (Array.isArray(v) && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) return table(v as Record<string, unknown>[]);
  return JSON.stringify(v, null, 2).split("\n");
}
