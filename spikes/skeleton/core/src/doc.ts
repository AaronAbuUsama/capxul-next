// The door's commands: documents, calls, reports, and signing an approval with a person's own key. Everything is `--as <email>`.
import { readFileSync } from "node:fs";
import { parseArgs } from "./args.ts";
import { approvalId } from "./sign-helpers.ts";
import { core, person } from "./cli.ts";
import { sendPayment, toUnits } from "./chain.ts";
import { config } from "./config.ts";
import { doorError, frappe, noteDoc } from "./door.ts";
import { CliError, refuse } from "./errors.ts";
import { touched } from "./trace.ts";
import { show } from "./render.ts";
import type { Address, Hex } from "viem";

export type Out = string[] | { data: unknown; lines?: string[] };
const enc = encodeURIComponent;
const jsonArg = (v: string | true | undefined, what: string, dflt?: unknown): any => {
  if (v === undefined || v === true) { if (dflt !== undefined) return dflt; throw refuse("USAGE", `${what} is required`); }
  try { return JSON.parse(v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v); } catch { throw refuse("USAGE", `${what} is not valid JSON`); }
};
function ctx(args: string[], n: number, usage: string) {
  const { pos, flags } = parseArgs(args);
  if (pos.length < n) throw refuse("USAGE", `usage: ${usage}`);
  if (typeof flags.as !== "string") throw refuse("NEEDS_PERSON", "pass --as <email>: the door acts as a person, never as Administrator");
  person(flags.as); touched.actor = flags.as;
  return { pos, flags, slug: pos[0]!, as: flags.as };
}
const res = (data: unknown, lines?: string[]): Out => ({ data, lines: lines ?? show(data) });

export async function docTypes(args: string[]): Promise<Out> {
  const { flags, slug, as } = ctx(args, 1, "doc types <slug> --as <email> [--feature <name>]");
  const j = await frappe(slug, as, "GET", "/api/method/capxul.door.types", { query: { feature: typeof flags.feature === "string" ? flags.feature : undefined } });
  const m = j.message;
  return res(m, [`${m.count} document types ${as} can read on ${slug}`, ...show(m.types.map((t: any) => ({ doctype: t.doctype, feature: t.feature, module: t.module, kind: t.child ? "child" : t.single ? "single" : t.submittable ? "submittable" : "doc",
    may: ["create", "write", "delete", "submit"].filter((k) => t[k]).join(",") }))) ]);
}
export async function docSchema(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 2, "doc schema <slug> <DocType> --as <email>");
  const m = (await frappe(slug, as, "GET", "/api/method/capxul.door.schema", { query: { doctype: pos[1] } })).message;
  return res(m, [`${m.doctype} (${m.module}, feature ${m.feature}${m.submittable ? ", submittable" : ""}${m.child ? ", child table" : ""}); you may: ${Object.keys(m.you_may).filter((k) => m.you_may[k]).join(", ")}`,
    ...show(m.fields.map((f: any) => ({ field: f.fieldname, type: f.type, options: f.options, req: f.required ? "yes" : "" }))),
    ...Object.entries<any>(m.child_tables).map(([k, v]) => `child table ${k}: ${v.doctype} (${v.fields.map((f: any) => f.fieldname).join(", ")})`)]);
}
export async function docList(args: string[]): Promise<Out> {
  const { slug, as, pos, flags } = ctx(args, 2, "doc list <slug> <DocType> --as <email> [--filters <json>] [--fields a,b] [--limit 20] [--page 1] [--order-by 'x desc']");
  const limit = Number(flags.limit ?? 20), page = Number(flags.page ?? 1);
  const fields = typeof flags.fields === "string" ? (flags.fields.startsWith("[") ? flags.fields : JSON.stringify(flags.fields.split(","))) : '["name"]';
  const j = await frappe(slug, as, "GET", `/api/resource/${enc(pos[1]!)}`, { query: { filters: typeof flags.filters === "string" ? flags.filters : undefined, fields,
    limit_page_length: String(limit), limit_start: String((page - 1) * limit), order_by: typeof flags["order-by"] === "string" ? flags["order-by"] : undefined } });
  return res({ doctype: pos[1], page, count: j.data.length, rows: j.data }, [`${pos[1]}: ${j.data.length} rows (page ${page}, ${limit} per page)`, ...show(j.data)]);
}
export async function docGet(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc get <slug> <DocType> <name> --as <email>");
  return res((await frappe(slug, as, "GET", `/api/resource/${enc(pos[1]!)}/${enc(pos[2]!)}`)).data);
}
export async function docCreate(args: string[]): Promise<Out> {
  const { slug, as, pos, flags } = ctx(args, 2, "doc create <slug> <DocType> --as <email> --data <json|@file>");
  const d = (await frappe(slug, as, "POST", `/api/resource/${enc(pos[1]!)}`, { body: jsonArg(flags.data, "--data") })).data;
  noteDoc(slug, pos[1]!, d.name, "create");
  return res(d, [`created ${pos[1]} ${d.name}`]);
}
export async function docUpdate(args: string[]): Promise<Out> {
  const { slug, as, pos, flags } = ctx(args, 3, "doc update <slug> <DocType> <name> --as <email> --data <json|@file>");
  const d = (await frappe(slug, as, "PUT", `/api/resource/${enc(pos[1]!)}/${enc(pos[2]!)}`, { body: jsonArg(flags.data, "--data") })).data;
  noteDoc(slug, pos[1]!, pos[2]!, "update");
  return res(d, [`updated ${pos[1]} ${pos[2]}`]);
}
export async function docDelete(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc delete <slug> <DocType> <name> --as <email>");
  await frappe(slug, as, "DELETE", `/api/resource/${enc(pos[1]!)}/${enc(pos[2]!)}`);
  noteDoc(slug, pos[1]!, pos[2]!, "delete");
  return res({ deleted: pos[2] }, [`deleted ${pos[1]} ${pos[2]}`]);
}
// Submit does what the form's Submit does: a Payment Entry first asks Capxul (capxul.api.request_payment); a Safe-backed one comes back
// "Waiting for signature" with an approval to sign (`approval sign`), anything else is submitted straight away.
export async function docSubmit(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc submit <slug> <DocType> <name> --as <email>");
  const [, dt, name] = pos as [string, string, string];
  if (dt === "Payment Entry") {
    const r = (await frappe(slug, as, "POST", "/api/method/capxul.api.request_payment", { body: { name } })).message;
    if (r.safe) {
      const id = approvalId(r.approval_url);
      noteDoc(slug, dt, name, "requested-signature");
      touched.extra.approval = id;
      const a: any = await fetch(`${config.coreUrl}/approve/${id}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).then((x) => x.json(), () => ({}));
      const awaiting = a.requested_by ?? null;   // the signer Core will accept: the person who asked (Core's approval names them)
      return res({ doctype: dt, name, status: r.status, held: true, approval: id, awaiting, approval_url: r.approval_url }, [`${dt} ${name}: ${r.status}, held for ${awaiting}'s signature. Sign with: approval sign ${slug} ${id} --as ${awaiting}`]);
    }
  }
  const d = (await frappe(slug, as, "PUT", `/api/resource/${enc(dt)}/${enc(name)}`, { body: { docstatus: 1 } })).data;
  noteDoc(slug, dt, name, "submit");
  return res({ doctype: dt, name, docstatus: d.docstatus }, [`submitted ${dt} ${name}`]);
}
export async function docCancel(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc cancel <slug> <DocType> <name> --as <email>");
  const d = (await frappe(slug, as, "PUT", `/api/resource/${enc(pos[1]!)}/${enc(pos[2]!)}`, { body: { docstatus: 2 } })).data;
  noteDoc(slug, pos[1]!, pos[2]!, "cancel");
  return res({ doctype: pos[1], name: pos[2], docstatus: d.docstatus }, [`cancelled ${pos[1]} ${pos[2]}`]);
}
const DROP = new Set(["name", "docstatus", "creation", "modified", "modified_by", "owner", "idx", "parent", "parentfield", "parenttype", "amended_from"]);
const clean = (v: any): any => Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, clean(x)])) : v;
export async function docAmend(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc amend <slug> <DocType> <name> --as <email>");
  const old = (await frappe(slug, as, "GET", `/api/resource/${enc(pos[1]!)}/${enc(pos[2]!)}`)).data;
  if (old.docstatus !== 2) throw refuse("INVALID", `only a cancelled document can be amended; ${pos[2]} has docstatus ${old.docstatus}`);
  const d = (await frappe(slug, as, "POST", `/api/resource/${enc(pos[1]!)}`, { body: { ...clean(old), doctype: pos[1], amended_from: pos[2] } })).data;
  noteDoc(slug, pos[1]!, d.name, "amend");
  return res(d, [`amended ${pos[2]} as ${d.name}`]);
}
export async function docCall(args: string[]): Promise<Out> {
  const { slug, as, pos, flags } = ctx(args, 2, "doc call <slug> <method> --as <email> [--args <json>]");
  const a = jsonArg(flags.args, "--args", {});
  let j: any;
  try { j = await frappe(slug, as, "POST", `/api/method/${pos[1]}`, { body: a }); }
  catch (e) {
    if (e instanceof CliError && (e.detail as any)?.http === 405) j = await frappe(slug, as, "GET", `/api/method/${pos[1]}`, { query: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])) });
    else throw e;
  }
  return res(j.message ?? j);
}
export async function docNext(args: string[]): Promise<Out> {
  const { slug, as, pos } = ctx(args, 3, "doc next <slug> <DocType> <name> --as <email>");
  const m = (await frappe(slug, as, "GET", "/api/method/capxul.door.next_documents", { query: { doctype: pos[1], name: pos[2] } })).message;
  return res(m, [`${pos[1]} ${pos[2]}: ${m.connections.length} follow-on types, ${m.makers.length} make-methods`, ...show(m.connections), ...show(m.makers.map((x: any) => ({ builds: x.builds, method: x.method, params: x.params.join(",") }))), m.note]);
}
export async function reportList(args: string[]): Promise<Out> {
  const { slug, as } = ctx(args, 1, "report list <slug> --as <email>");
  const m = (await frappe(slug, as, "GET", "/api/method/capxul.door.reports")).message;
  return res(m, [`${m.count} reports ${as} may run on ${slug}`, ...show(m.reports)]);
}
export async function reportRun(args: string[]): Promise<Out> {
  const { slug, as, pos, flags } = ctx(args, 2, "report run <slug> <name> --as <email> [--filters <json>]");
  const m = (await frappe(slug, as, "GET", "/api/method/frappe.desk.query_report.run", { query: { report_name: pos[1], filters: JSON.stringify(jsonArg(flags.filters, "--filters", {})), ignore_prepared_report: "true" } })).message;
  const cols = (m.columns ?? []).map((c: any) => (typeof c === "string" ? { fieldname: c.split(":")[0], label: c.split(":")[0] } : c));
  const rows = (m.result ?? []).filter((r: any) => r && !Array.isArray(r) || Array.isArray(r));
  const data = { report: pos[1], columns: cols.map((c: any) => c.fieldname), count: rows.length, rows, message: m.message ?? null };
  const lines = show(rows.slice(0, 60).map((r: any) => Array.isArray(r) ? Object.fromEntries(cols.map((c: any, i: number) => [c.fieldname, r[i]])) : Object.fromEntries(cols.map((c: any) => [c.fieldname, r[c.fieldname]]))));
  return { data, lines: [`${pos[1]}: ${rows.length} rows`, ...lines] };
}

// A signature by the person's own key, no pop-up. The CLI sends the transaction itself, then tells Core the outcome.
export async function approvalSign(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (pos.length < 2 || typeof flags.as !== "string") throw refuse("USAGE", "usage: approval sign <slug> <approval id> --as <email> [--no-wait]");
  const [slug, id] = pos as [string, string];
  const who = person(flags.as); touched.actor = who.email;
  const r = await fetch(`${config.coreUrl}/approve/${id}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw refuse("NOT_FOUND", `no approval ${id}`);
  const a: any = await r.json();
  if (a.org !== slug) throw refuse("INVALID", `approval ${id} belongs to ${a.org}, not ${slug}`);
  if (a.status !== "pending") throw refuse("INVALID", `approval ${id} is ${a.status}, not pending`);
  const s = await sendPayment({ org: slug, to: a.to_address as Address, amount: toUnits(a.amount), documentHash: a.document_hash as Hex, privateKey: who.privateKey });
  await core(`/approve/${id}/external`, s.ok ? { signer: who.email, txHash: s.txHash } : { signer: who.email, reason: s.reason, detail: s.detail });
  if (!s.ok) throw refuse("CHAIN_REFUSED", `the chain refused the payment: ${s.reason} (${s.detail})`, { reason: s.reason });
  let pending = -1;
  if (!flags["no-wait"]) {   // wait until the site has the event (or 30 s), so a script can look at the books straight after
    for (let i = 0; i < 100; i++) { pending = (await core("/admin/status", { slug })).pending.length; if (!pending) break; await new Promise((r) => setTimeout(r, 300)); }
  }
  return res({ approval: id, signer: who.email, txHash: s.txHash, userOpHash: s.userOpHash, paymentId: s.paymentId, document: `${a.doctype} ${a.name}`, amount: a.amount, to: a.to_party, outboxPending: pending },
    [`signed ${id} as ${who.email}: ${a.amount} ${a.asset} to ${a.to_party}, tx ${s.txHash}${pending === 0 ? ", the site has it" : ""}`]);
}
// `payment list <slug> [--id <payment id>]`: the company's payments as the chain made them (PaymentSent), with whether the
// site has posted each one (settled).
export async function paymentList(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: payment list <slug> [--id <payment id>]");
  const all = ((await core("/admin/status", { slug: pos[0] }))?.payments ?? []) as { payment_id: string; amount: string; to: string; tx_hash: string; status: string }[];
  const rows = typeof flags.id === "string" ? all.filter((p) => p.payment_id.toLowerCase() === (flags.id as string).toLowerCase()) : all;
  return res(rows, rows.map((p) => `${p.payment_id} ${p.amount} USDC to ${p.to}: ${p.status} (tx ${p.tx_hash})`));
}
export { doorError };
