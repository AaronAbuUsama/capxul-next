// The facts target, packages/lint/src/generated/facts.ts: the few hundred names the lint rules read, derived from the
// records by the rules of docs/design/tooling.md section 3 as tooling.facts-derivation reads them. Pure.

type AnyRecord = Record<string, unknown> & { readonly _kind: string; readonly id: string };
const list = <T = AnyRecord>(u: unknown): T[] => (Array.isArray(u) ? (u as T[]) : []);
const idOf = (u: unknown): string | undefined => (typeof u === "object" && u !== null && typeof (u as { id?: unknown }).id === "string" ? (u as { id: string }).id : undefined);
/** Sorted by code unit, without duplicates, so two runs and two machines write the same bytes. */
const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

const camel = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (id: string): string => id.split(/[.-]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

/** A procedure's door export: the id's last segment in camelCase (parties.resolve-recipient gives resolveRecipient). */
export const doorName = (id: string): string => camel(id.split(".").at(-1)!);
/** A workflow's export: its id in PascalCase (payments.lifecycle.payment gives PaymentsLifecyclePayment). */
export const workflowName = pascal;
/** Each span name's constant in the generated Spans, which facts.ts and every spans.ts share: each segment in
 * camelCase (sdk.step.browser-install gives Spans.sdk.step.browserInstall), and a name that is also the prefix of
 * another is its node's `_` (cli.bank.accounts gives Spans.cli.bank.accounts._), since no segment is `_`. Throws when
 * two names would have one constant. */
export const spanConstants = (names: readonly string[]): Map<string, string> => {
  const path = (n: string) => n.split(".").map(camel).join(".");
  const paths = new Set(names.map(path));
  const out = new Map<string, string>();
  const byConstant = new Map<string, string>();
  for (const name of names) {
    const p = path(name);
    const constant = `Spans.${p}${[...paths].some((q) => q.startsWith(`${p}.`)) ? "._" : ""}`;
    const other = byConstant.get(constant);
    if (other !== undefined) throw new Error(`spans ${other} and ${name} would both be ${constant}`);
    byConstant.set(constant, name);
    out.set(name, constant);
  }
  return out;
};

/** Areas whose file would be the one concept-shape keeps for procedures (door.ts) or workflows (processes.ts), each
 * mapped to the file tooling.facts-derivation records for it. */
const RESERVED_AREAS: Readonly<Record<string, string>> = { "sites.door": "door-rpcs.ts" };
export const areaFile = (concept: string, area: string): string => {
  if (area !== "door" && area !== "processes") return `${area}.ts`;
  const file = RESERVED_AREAS[`${concept}.${area}`];
  if (!file) throw new Error(`${concept}'s rpcs have an area named ${area}, which would be its ${area}.ts; record the file it maps to in tooling.facts-derivation`);
  return file;
};

const SDK_STEP_KINDS = new Set(["sign", "build", "encrypt"]);

/** Every name of the P6 span tree the records give, and each rpc's and flow's declared spans. */
export const spanNames = (records: readonly AnyRecord[]): string[] => {
  const names = ["db.tx", "wait.person", "wait.chain"];
  for (const r of records) {
    if (r._kind === "rpc" || r._kind === "flow") names.push(...list<string>(r["spans"]).filter((s) => typeof s === "string"));
    if (r._kind === "rpc") names.push(`rpc.${r.id}`);
    if (r._kind === "flow") {
      names.push(`sdk.${r.id}`); // the flow's id, as its declared spans name it; its sdk field is the method path
      for (const s of list<{ name?: string; local?: string }>(r["steps"])) if (s.local && SDK_STEP_KINDS.has(s.local) && s.name) names.push(`sdk.step.${s.name}`);
    }
    if (r._kind === "operation" && typeof r["command"] === "string") names.push(`cli.${r["command"].trim().split(/\s+/).join(".")}`);
    if (r._kind === "integration") for (const call of Object.keys((r["calls"] ?? {}) as object)) names.push(`call.${r.id}.${call}`);
    if (r._kind === "workflow") {
      names.push(`workflow.${r.id}`);
      for (const s of list<{ name?: string }>(r["steps"])) if (s.name) names.push(`workflow.step.${s.name}`);
    }
  }
  return sorted(names);
};

export interface FactsInput {
  readonly records: readonly AnyRecord[];
  /** The concept whose blueprint/<concept>/ modules export each record, by `<kind>:<id>`. */
  readonly conceptOf: ReadonlyMap<string, string>;
}

/** The facts as a value, every list sorted and every map keyed in sorted order. Throws when two span names share one
 * constant (spanConstants), because the generated Spans could not hold both. */
export const factsOf = ({ records, conceptOf }: FactsInput) => {
  const of = (kind: string) => records.filter((r) => r._kind === kind);
  const conceptField = (r: AnyRecord) => idOf(r["concept"]);
  const concepts: Record<string, { dependsOn: string[]; door: string[]; backend: string[]; sdk: string[]; lines: number | undefined }> = {};
  for (const c of [...of("concept")].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const mine = (kind: string) => of(kind).filter((r) => conceptField(r) === c.id);
    const procedures = mine("procedure"), workflows = mine("workflow");
    // An rpc's area is every segment between its first and its last; a two-part id names no area.
    const areas = sorted(mine("rpc").map((r) => r.id.split(".").slice(1, -1).join(".")).filter(Boolean)).map((a) => areaFile(c.id, a));
    const flows = of("flow").filter((r) => conceptOf.get(`flow:${r.id}`) === c.id);
    concepts[c.id] = {
      dependsOn: sorted(list(c["dependsOn"]).map(idOf).filter((x): x is string => !!x)),
      door: sorted(procedures.map((p) => doorName(p.id))),
      backend: sorted([...areas, ...(procedures.length ? ["door.ts"] : []), ...(workflows.length ? ["processes.ts"] : [])]),
      sdk: flows.length ? ["flows.ts"] : [],
      lines: typeof c["lines"] === "number" ? c["lines"] : undefined,
    };
  }
  const workflows: Record<string, { concept: string; name: string; steps: string[]; waits: string[] }> = {};
  for (const w of [...of("workflow")].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    workflows[w.id] = {
      concept: conceptField(w) ?? "",
      name: workflowName(w.id),
      steps: sorted(list<{ name?: string }>(w["steps"]).flatMap((s) => (s.name ? [s.name] : []))),
      waits: sorted(list<{ name?: string }>(w["waits"]).flatMap((s) => (s.name ? [s.name] : []))),
    };
  }
  const spans = Object.fromEntries(spanConstants(spanNames(records)));
  return { concepts, workflows, spans };
};

/** A value as TypeScript source: keys in insertion order (already sorted), arrays on one line, undefined kept. */
const literal = (value: unknown, indent: string): string => {
  if (value === undefined) return "undefined";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => literal(v, indent)).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  const inner = `${indent}  `;
  const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));
  return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${literal(v, inner)},`).join("\n")}\n${indent}}`;
};

/** The body of facts.ts, without its header (the writer adds it). */
export const renderFacts = (input: FactsInput): string => `export const facts = ${literal(factsOf(input), "")} as const;\n`;
