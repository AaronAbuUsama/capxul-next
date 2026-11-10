// Helpers the plugs, sites and world records share (stage 3 of the cut). They only fill the fields a record would repeat
// (an rpc that touches nothing, an operation's one budget); every record still states its own text, its errors and its claims.
// kit.ts defines no record of its own and is not a module in index.ts.

import { Schema } from "effect";
import { budget, defineOperation, defineRpc, defineProcedure } from "../../../packages/book/src/index.ts";
import type { ErrorRecord } from "../../../packages/book/src/index.ts";

export const S = Schema.String;
export const N = Schema.Number;
export const B = Schema.Boolean;
export const Null = Schema.NullOr;
export const J = Schema.String; // a JSON document held as text

/** The coordinator's source line for a decision of stage 3, with the evidence it rests on. */
export const BY = (evidence: string) =>
  `The coordinator, 10 November 2026, on Aaron's delegation of the book (aaron.one-door, aaron.frappe-native); evidence: ${evidence}`;

/** Where the spike showed how Frappe behaves; a record that cites one of these states a measured fact. */
export const FIND = {
  roles: "spikes/skeleton/FINDINGS.md, Frappe half: Roles follow hats",
  paying: "spikes/skeleton/FINDINGS.md, Frappe half: Paying a document",
  canon: "spikes/skeleton/FINDINGS.md, Frappe half: Canonical JSON for document_hash (CANON v1)",
  core: "spikes/skeleton/FINDINGS.md, Core half: What a chain cannot tell Frappe, What the ordering guarantee really costs",
  e2e: "spikes/skeleton/FINDINGS.md, End to end: What broke when the halves met, What the design must now decide",
  crm: "spikes/skeleton/FINDINGS.md, CRM, WhatsApp and feature switches",
  features: "spikes/skeleton/FINDINGS.md, Feature switches: what off is, and what each candidate closed",
  names: "spikes/skeleton/FINDINGS.md, Names only: the site says Capxul",
  phone: "spikes/skeleton/FINDINGS.md, Follow-up: what phones home",
  cloud: "docs/mission/cloud.md",
  path: "docs/mission/critical-path.md",
} as const;

type RpcIn = Parameters<typeof defineRpc>[0];
type Rest<T> = Omit<T, "kind" | "reads" | "writes" | "drives" | "invokes" | "emits" | "calls" | "chain" | "spans" | "budget"> & Partial<RpcIn>;

/** An rpc: every list a record may leave empty defaults to empty, and the budget to the class its kind implies. */
export const rpc = <const T extends Rest<RpcIn>>(spec: T) =>
  defineRpc({
    kind: "query",
    reads: [], writes: [], drives: [], invokes: [], emits: [], calls: [], chain: [], spans: [],
    budget: budget(spec["kind"] === "mutation" || spec["kind"] === "action" ? "write" : "read"),
    ...spec,
  } as never as RpcIn) as ReturnType<typeof defineRpc> & T;

export const procedure = (spec: Omit<Parameters<typeof defineProcedure>[0], "reads" | "writes" | "drives" | "invokes" | "emits"> & Partial<Parameters<typeof defineProcedure>[0]>) =>
  defineProcedure({ reads: [], writes: [], drives: [], invokes: [], emits: [], ...spec } as never);

type OpIn = Parameters<typeof defineOperation>[0];
export interface Claim { readonly claim: string; readonly observes: string }
export interface Refusal { readonly error: ErrorRecord; readonly given: string; readonly when: string }

/** An operation of stage 3: a new capability booked under rules.new-operations, so its id is its command's words joined by dots. */
export const operation = (spec: Omit<OpIn, "id" | "acceptance" | "refusals"> & { id: string; acceptance: readonly Claim[]; refusals: readonly Refusal[] }) =>
  defineOperation({ budget: budget("write"), notes: [], ...spec } as never as OpIn);

/** The named worlds (devnet snapshots, each holding companies on one chain and clock) the stage 3 refusals are reached from. */
export const WORLD = {
  siteReady: "org-with-site",
  siteFeatures: "org-with-site-features",
  siteCreating: "org-with-site-creating",
  hatsOnSite: "org-with-hats-on-site",
  held: "org-with-held-payment",
  heldOther: "org-with-held-payment-other-signer",
  events: "org-with-site-events",
  poison: "org-with-unappliable-event",
  siteDown: "org-with-site-down",
  member: "org-with-member",
  signedOut: "signed-out",
} as const;
