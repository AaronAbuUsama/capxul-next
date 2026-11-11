/**
 * The index of one kind of record: every table, every state machine, every rpc and so on, grouped by concept, each
 * row linked to the record's page. A kind adds the one or two columns that tell its records apart.
 */
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { Cell, TableSection } from "../types.ts";
import { isWaiting, membersOf, titleOf, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { code, row, tableOf, to, words } from "./table.ts";
import { count, entries, field, list, plural, text } from "./values.ts";

export interface KindCatalogue {
  readonly name: string; readonly kind: string; readonly title: string; readonly one: string; readonly lists: string;
  /** The columns this kind adds between "What it is" and "Evals". */
  readonly heads: readonly string[];
  readonly cells: (ctx: Ctx, r: AnyRecord) => readonly Cell[];
}

const size = (u: unknown): Cell => words(count(Array.isArray(u) ? u.length : entries(u).length));
const none: KindCatalogue["cells"] = () => [];
/** What starts a workflow: the one key of its trigger. */
const trigger = (r: AnyRecord): string => entries(r["trigger"])[0]?.[0] ?? "";

export const KIND_CATALOGUES: readonly KindCatalogue[] = [
  { name: "tables", kind: "table", title: "Tables", one: "table", lists: "Every table, with whose rows it holds apart.",
    heads: ["Tenancy"], cells: (_, r) => [words(text(r["tenancy"]))] },
  { name: "machines", kind: "machine", title: "State machines", one: "state machine", lists: "Every state machine: the statuses a record can have and the moves between them.",
    heads: ["States", "Transitions"], cells: (_, r) => [size(r["states"]), size(r["transitions"])] },
  { name: "rpcs", kind: "rpc", title: "RPCs", one: "rpc", lists: "Every server endpoint, with whether it reads, changes or calls outside.",
    heads: ["Kind"], cells: (_, r) => [words(text(r["kind"]))] },
  { name: "flows", kind: "flow", title: "Flows", one: "flow", lists: "Every Core SDK composition, with the method it is called by.",
    heads: ["SDK method", "Steps"], cells: (_, r) => [code(text(r["sdk"])), size(r["steps"])] },
  { name: "procedures", kind: "procedure", title: "Procedures", one: "procedure", lists: "Every in-transaction entry point one concept offers another.",
    heads: [], cells: none },
  { name: "workflows", kind: "workflow", title: "Workflows", one: "workflow", lists: "Every durable background process, with what starts it.",
    heads: ["Started by", "Steps"], cells: (_, r) => [words(trigger(r)), size(r["steps"])] },
  { name: "contracts", kind: "contract", title: "Contracts", one: "contract", lists: "Every on-chain contract, with its functions and chain events.",
    heads: ["Functions", "Chain events"], cells: (_, r) => [size(r["functions"]), size(r["events"])] },
  { name: "integrations", kind: "integration", title: "Integrations", one: "integration", lists: "Every outside system Capxul talks to, and the calls it makes.",
    heads: ["Outside system", "Calls"], cells: (_, r) => [words(text(r["system"])), size(r["calls"])] },
  { name: "journeys", kind: "journey", title: "Journeys", one: "journey", lists: "Every journey a person or an agent takes through the operations.",
    heads: ["Steps"], cells: (_, r) => [size(r["steps"])] },
  { name: "invariants", kind: "invariant", title: "Invariants", one: "invariant", lists: "What must always hold, and how each is checked.",
    heads: ["Checked by"], cells: (_, r) => [words(text(r["check"]))] },
  { name: "components", kind: "component", title: "Components", one: "component", lists: "Every running piece, and where it runs.",
    heads: ["Runs on", "Depends on"], cells: (_, r) => [words(text(r["runtime"])), size(r["dependsOn"])] },
  { name: "environments", kind: "environment", title: "Environments", one: "environment", lists: "Every environment, and how many components run in it.",
    heads: ["Components"], cells: (_, r) => [size(r["runs"])] },
  { name: "doctypes", kind: "doctype", title: "DocTypes", one: "DocType", lists: "Every Frappe DocType the product uses, the app that owns it, and its fields.",
    heads: ["Name", "App", "Fields"], cells: (_, r) => [words(text(r["name"])), words(text(r["app"])), size(r["fields"])] },
  { name: "hats", kind: "role", title: "Hats", one: "hat", lists: "Every hat a person can wear in a company, and the Frappe roles it grants.",
    heads: ["Frappe roles"], cells: (_, r) => [words(list(r["frappeRoles"]).map(text).join(", "))] },
  { name: "features", kind: "feature", title: "Features", one: "feature", lists: "Every feature a company can turn on, and whether it starts on.",
    heads: ["Label", "Starts"], cells: (_, r) => [words(text(r["label"])), words(text(r["default"]))] },
  { name: "screens", kind: "screen", title: "Screens", one: "screen", lists: "Every screen a person sees, where it is drawn, and what it shows.",
    heads: ["Surface", "Kind", "Who"], cells: (_, r) => [words(text(r["surface"])), words(text(r["kind"])), size(r["who"])] },
  { name: "logs", kind: "log", title: "Logs", one: "log", lists: "Every log row the system writes, at what level and how often.",
    heads: ["Level", "One per"], cells: (_, r) => [words(text(r["level"])), words(text(r["per"]))] },
  { name: "metrics", kind: "metric", title: "Metrics", one: "metric", lists: "Every metric the system records, and its unit.",
    heads: ["Instrument", "Unit"], cells: (_, r) => [words(text(r["instrument"])), words(text(r["unit"]))] },
  { name: "insights", kind: "insight", title: "Insights", one: "insight", lists: "Every saved question asked of the events, logs and metrics.",
    heads: ["Display", "Reads"], cells: (_, r) => [words(text(r["display"])), size(r["reads"])] },
  { name: "alerts", kind: "alert", title: "Alerts", one: "alert", lists: "Every alert: what fires it, how loud it is and who hears it.",
    heads: ["Fires when", "Severity"], cells: (_, r) => [words(text(r["condition"])), words(text(r["severity"]))] },
  { name: "dashboards", kind: "dashboard", title: "Dashboards", one: "dashboard", lists: "Every dashboard, who it is for and where it lives.",
    heads: ["For", "Where", "Tiles"], cells: (_, r) => [words(text(r["audience"])), words(text(r["where"])), size(r["tiles"])] },
  { name: "decisions", kind: "decision", title: "Decisions", one: "decision", lists: "Every decision in the blueprint: what was chosen, and whether it waits for an answer.",
    heads: ["Chosen", "Status"], cells: (ctx, r) => [code(text(r["chosen"])), words(isWaiting(ctx, r) ? "waits for you" : "made")] },
];

/** The table of one kind: the concepts in the blueprint's order, then the records no concept owns. */
export const kindSection = (ctx: Ctx, k: KindCatalogue): TableSection => {
  const groups = [...ctx.input.concepts, ""].flatMap((id) => {
    const held = membersOf(ctx, id, k.kind).toSorted((a, b) => a.id.localeCompare(b.id, "en"));
    const concept = ctx.input.blueprint.records.get(`concept:${id}`);
    return held.map((r) => ({ r, group: concept ? titleOf(concept) : "Shared" }));
  });
  const withEvals = groups.some(({ r }) => (ctx.evals.get(keyOf(r)) ?? []).length > 0);
  return tableOf(k.name, k.title, ["Record", "What it is", ...k.heads, ...(withEvals ? ["Evals"] : [])], groups.map(({ r, group }) =>
    row([
      to(refOf(r)), words(text(r["title"]) || text(field(r, "statement")) || text(r["about"])), ...k.cells(ctx, r),
      ...(withEvals ? [words(count((ctx.evals.get(keyOf(r)) ?? []).length))] : []),
    ], group)),
  { caption: `${plural(groups.length, k.one)}, grouped by concept. Each links to its page.`,
    empty: `The blueprint holds no ${k.one}.` });
};
