// The B1 targets that no hand-written code has to change for (tooling.generated-targets): the Spans catalogue, the
// backend's error classes and one Config per environment. Pure: each returns a file body, without its header.

import { spanConstants, spanNames } from "../facts/service.ts";

type AnyRecord = Record<string, unknown> & { readonly _kind: string; readonly id: string };
const byId = (a: AnyRecord, b: AnyRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));

/** One nested constant for the whole P6 tree, at the paths spanConstants gives: Spans.sdk.step.browserInstall is
 * "sdk.step.browser-install", and Spans.cli.bank.accounts._ is "cli.bank.accounts". */
export const renderSpans = (records: readonly AnyRecord[]): string => {
  type Node = { [k: string]: Node | string };
  const root: Node = {};
  for (const [name, constant] of spanConstants(spanNames(records))) {
    const path = constant.split(".").slice(1);
    let node = root;
    for (const seg of path.slice(0, -1)) node = (node[seg] ??= {}) as Node;
    node[path.at(-1)!] = name;
  }
  const write = (node: Node, indent: string): string => {
    const inner = `${indent}  `;
    const keys = Object.keys(node).sort();
    return `{\n${keys.map((k) => { const v = node[k]!; return `${inner}${key(k)}: ${typeof v === "string" ? JSON.stringify(v) : write(v, inner)},`; }).join("\n")}\n${indent}}`;
  };
  return `export const Spans = ${write(root, "")} as const;\n`;
};

/** NOT_AUTHENTICATED gives NotAuthenticated. */
export const errorClassName = (code: string): string =>
  code.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

/** One Schema.TaggedError per error record, with an optional cause and the record's facts as static fields. */
export const renderErrors = (records: readonly AnyRecord[]): string => {
  const errors = records.filter((r) => r._kind === "error").sort(byId);
  const seen = new Map<string, string>();
  const classes = errors.map((e) => {
    const name = errorClassName(e.id);
    const other = seen.get(name);
    if (other) throw new Error(`errors ${other} and ${e.id} would both be ${name}`);
    seen.set(name, e.id);
    const statics = (["class", "actor", "message", "retryable", "exit"] as const).map((f) => `  static readonly ${f} = ${JSON.stringify(e[f])};`);
    return [
      `export class ${name} extends Schema.TaggedError<${name}>()(${JSON.stringify(name)}, { cause: Schema.optional(Schema.Defect()) }) {`,
      `  static readonly code = ${JSON.stringify(e.id)};`,
      ...statics,
      "}",
    ].join("\n");
  });
  return [`import { Schema } from "effect";`, "", ...classes.flatMap((c) => [c, ""]),
    `export const Errors = { ${[...seen].map(([name, code]) => `${code}: ${name}`).join(", ")} } as const;`, ""].join("\n");
};

/** One Config module per environment record: every config entry a required non-empty string, every secret a required
 * Redacted. The path of each is config/<environment>.ts. */
export const renderConfigs = (records: readonly AnyRecord[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const env of records.filter((r) => r._kind === "environment").sort(byId)) {
    const config = [...new Set((env["config"] as string[] | undefined) ?? [])].sort();
    const secrets = [...new Set((env["secrets"] as string[] | undefined) ?? [])].sort();
    const both = config.filter((c) => secrets.includes(c));
    if (both.length) throw new Error(`environment ${env.id} lists ${both.join(", ")} as both config and secret`);
    const name = `${env.id.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("")}Config`;
    const entries = [
      ...config.map((c) => [c, `Config.NonEmptyString(${JSON.stringify(c)})`] as const),
      ...secrets.map((c) => [c, `Config.Redacted(${JSON.stringify(c)})`] as const),
    ].sort(([a], [b]) => (a < b ? -1 : 1));
    out.set(`config/${env.id}.ts`, [`import { Config } from "effect";`, "",
      `export const ${name} = Config.all({`, ...entries.map(([k, v]) => `  ${k}: ${v},`), "});", ""].join("\n"));
  }
  return out;
};
