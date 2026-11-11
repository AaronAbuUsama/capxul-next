// The comparison of the blueprint's DocType, role and feature records with the site app's code. Pure: main.ts reads the DocType
// JSON files, the Custom Fields and the hat map and passes them in, so every rule is tested on small fixtures.
//
// The blueprint and the code must say the same thing. Every difference is a failure, named from both sides; there is
// no allowance. A DocType the blueprint means to remove stays recorded as it is (with `retiredBy`) until the code drops it.

export interface RecordField {
  readonly name: string;
  readonly type: string;
  readonly link?: { readonly name: string };
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly readOnly?: boolean;
  readonly default?: string;
  readonly standard?: boolean;
}
export interface DoctypeRecord {
  readonly id: string;
  readonly name: string;
  readonly app: "capxul" | "frappe" | "erpnext";
  readonly single?: boolean;
  readonly child?: boolean;
  readonly naming?: string;
  readonly fields: readonly RecordField[];
  readonly permissions?: readonly { role: string; read: boolean; write: boolean; create: boolean; delete: boolean }[];
}
export interface RoleRecord {
  readonly id: string;
  readonly frappeRoles: readonly string[];
}

export interface FeatureRecord {
  readonly id: string;
  readonly label: string;
  readonly default: "on" | "off";
  readonly modules?: readonly string[];
  readonly apps?: readonly string[];
  readonly app?: string;
  readonly prefixes?: readonly string[];
  readonly paths?: readonly string[];
  readonly needs?: readonly { readonly id: string }[];
}

/** A DocType's JSON, as Frappe writes it (the keys this check reads). */
export interface DoctypeJson {
  readonly name: string;
  readonly issingle?: number;
  readonly istable?: number;
  readonly autoname?: string;
  readonly fields: readonly Record<string, unknown>[];
  readonly permissions?: readonly Record<string, unknown>[];
}
export interface Code {
  readonly doctypes: readonly DoctypeJson[];
  /** setup.py's CUSTOM_FIELDS: DocType name → the Custom Fields the app adds to it. */
  readonly customFields: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** setup.py's DEFAULT_HAT_ROLES: hat → Frappe roles. */
  readonly hatRoles: Readonly<Record<string, readonly string[]>>;
  /** features.py's CATALOG: switch → its label, default (1 on, 0 off), modules, apps, app, prefixes, paths and needs. */
  readonly features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export interface Report {
  readonly compared: { doctypes: number; fields: number; roles: number; features: number };
  readonly failures: readonly string[];
}

const flag = (u: unknown) => u === 1 || u === true;
const show = (u: unknown) => (u === undefined ? "nothing" : JSON.stringify(u));

/** The field as the code has it, in the record's terms. */
const fromCode = (f: Record<string, unknown>): Record<string, unknown> => {
  const type = String(f.fieldtype);
  const options = typeof f.options === "string" && f.options !== "" ? f.options : undefined;
  return {
    type,
    link: type === "Link" || type === "Table" ? options : undefined,
    options: type === "Link" || type === "Table" || options === undefined ? undefined : options.split("\n"),
    required: flag(f.reqd),
    unique: flag(f.unique),
    readOnly: flag(f.read_only),
    default: f.default === undefined ? undefined : String(f.default),
  };
};
const fromRecord = (f: RecordField): Record<string, unknown> => ({
  type: f.type,
  link: f.link?.name,
  options: f.options,
  required: f.required ?? false,
  unique: f.unique ?? false,
  readOnly: f.readOnly ?? false,
  default: f.default,
});

const compareFields = (where: string, record: readonly RecordField[], code: readonly Record<string, unknown>[], out: string[]) => {
  const names = (xs: readonly { name?: unknown; fieldname?: unknown }[]) => xs.map((x) => String(x.name ?? x.fieldname));
  const r = names(record), c = names(code);
  for (const n of c) if (!r.includes(n)) out.push(`${where}: the code has field ${n}; the blueprint does not`);
  for (const n of r) if (!c.includes(n)) out.push(`${where}: the blueprint has field ${n}; the code does not`);
  const common = r.filter((n) => c.includes(n));
  if (common.join() !== c.filter((n) => r.includes(n)).join()) out.push(`${where}: the fields are in another order (code: ${c.join(", ")})`);
  for (const n of common) {
    const a = fromRecord(record.find((f) => f.name === n)!), b = fromCode(code.find((f) => f.fieldname === n)!);
    for (const k of Object.keys(a))
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${where}.${n}: ${k} is ${show(a[k])} in the blueprint and ${show(b[k])} in the code`);
  }
};

export const compareSite = (
  records: { doctypes: readonly DoctypeRecord[]; roles: readonly RoleRecord[]; features: readonly FeatureRecord[] }, code: Code,
): Report => {
  const out: string[] = [];
  let fields = 0;
  const own = records.doctypes.filter((d) => d.app === "capxul");
  for (const j of code.doctypes)
    if (!own.some((d) => d.name === j.name)) out.push(`DocType ${j.name}: the code defines it; the blueprint has no record of it`);
  for (const d of own) {
    const j = code.doctypes.find((x) => x.name === d.name);
    const where = `DocType ${d.name}`;
    if (!j) { out.push(`${where}: the blueprint records it (doctype:${d.id}); the code does not define it`); continue; }
    fields += j.fields.length;
    if ((d.single ?? false) !== flag(j.issingle)) out.push(`${where}: single is ${d.single ?? false} in the blueprint and ${flag(j.issingle)} in the code`);
    if ((d.child ?? false) !== flag(j.istable)) out.push(`${where}: child is ${d.child ?? false} in the blueprint and ${flag(j.istable)} in the code`);
    if ((d.naming ?? "") !== (j.autoname ?? "")) out.push(`${where}: naming is ${show(d.naming)} in the blueprint and ${show(j.autoname)} in the code`);
    compareFields(where, d.fields, j.fields, out);
    const perm = (p: { role?: unknown; read?: unknown; write?: unknown; create?: unknown; delete?: unknown }) =>
      `${String(p.role)}:${["read", "write", "create", "delete"].filter((k) => flag(p[k as keyof typeof p])).join("+") || "none"}`;
    const rp = (d.permissions ?? []).map(perm).sort().join(", "), cp = (j.permissions ?? []).map(perm).sort().join(", ");
    if (rp !== cp) out.push(`${where}: permissions are [${rp}] in the blueprint and [${cp}] in the code`);
  }
  const theirs = records.doctypes.filter((d) => d.app !== "capxul");
  for (const [name, cf] of Object.entries(code.customFields)) {
    const d = theirs.find((x) => x.name === name);
    fields += cf.length;
    if (!d) out.push(`DocType ${name}: the code adds Custom Fields to it; the blueprint has no record of it`);
    else compareFields(`Custom Fields on ${name}`, d.fields.filter((x) => !x.standard), cf, out);
  }
  for (const d of theirs)
    if (d.fields.some((x) => !x.standard) && !(d.name in code.customFields)) out.push(`Custom Fields on ${d.name}: the blueprint records ${d.fields.filter((x) => !x.standard).length}; the code adds none`);
  for (const [hat, roles] of Object.entries(code.hatRoles)) {
    const r = records.roles.find((x) => x.id === hat);
    if (!r) { out.push(`hat ${hat}: the code's hat map has it; the blueprint has no role record`); continue; }
    for (const x of roles) if (!r.frappeRoles.includes(x)) out.push(`hat ${hat}: the code gives ${x}; the blueprint does not`);
    for (const x of r.frappeRoles) if (!roles.includes(x)) out.push(`hat ${hat}: the blueprint gives ${x}; the code does not`);
  }
  for (const r of records.roles) if (!(r.id in code.hatRoles)) out.push(`hat ${r.id}: the blueprint records it (role:${r.id}); the code's hat map does not`);
  for (const [id, c] of Object.entries(code.features)) {
    const f = records.features.find((x) => x.id === id);
    if (!f) { out.push(`feature ${id}: the code's catalog has it; the blueprint has no feature record`); continue; }
    const a: Record<string, unknown> = { label: f.label, default: f.default, modules: f.modules, apps: f.apps, app: f.app, prefixes: f.prefixes, paths: f.paths, needs: f.needs?.map((n) => n.id) };
    const b: Record<string, unknown> = { ...c, default: flag(c.default) ? "on" : "off" };
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`feature ${id}: ${k} is ${show(a[k])} in the blueprint and ${show(b[k])} in the code`);
  }
  for (const f of records.features) if (!(f.id in code.features)) out.push(`feature ${f.id}: the blueprint records it (feature:${f.id}); the code's catalog does not`);
  return {
    compared: { doctypes: own.length + Object.keys(code.customFields).length, fields, roles: records.roles.length, features: records.features.length },
    failures: out,
  };
};
