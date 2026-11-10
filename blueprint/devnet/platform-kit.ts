// What the worlds platform's operations share: one helper that builds an operation, the rpc that implements it and its examples from one spec, so a spec reads as a page of the design,
// and the view shapes several operations return. Defines no record of its own and is not a module in index.ts (the records it builds are exported by the files that call it).

import { Schema } from "effect";
import { budget, defineOperation, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import type { ErrorRecord } from "../../packages/blueprint-engine/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { error_CLI_USAGE, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import type { ExampleRow } from "../shared/examples.ts";
import { ClockMode, WorldProfile } from "./world-data.ts";
import { GrantRole, RunState, SeatKind } from "./platform-data.ts";

export const S = Schema.String;
export const N = Schema.Number;
export const B = Schema.Boolean;
export const Null = Schema.NullOr;
export const DOC = "docs/design/worlds-platform.md";

export const ms = (iso: string) => Date.parse(iso);
export const BASE = "worlds.capxul.com";
export const SIGNED_OUT = "signed-out";

type Cls = "read" | "write" | "background";
type Claim = { readonly claim: string; readonly observes: string };
type Refusal = { readonly error: ErrorRecord; readonly given: string; readonly when: string };

export interface Spec {
  readonly id: string; readonly command: string; readonly title: string; readonly about: string; readonly who: string; readonly changes: string;
  readonly kind: "query" | "mutation" | "action"; readonly rpc: string; readonly priority?: "critical" | "normal"; readonly cls?: Cls;
  readonly input: Schema.Struct<Schema.Struct.Fields>; readonly output: Schema.Struct<Schema.Struct.Fields>;
  readonly reads?: readonly unknown[]; readonly writes?: readonly unknown[]; readonly drives?: readonly unknown[]; readonly calls?: readonly unknown[];
  readonly claims: readonly Claim[]; readonly refusals: readonly Refusal[]; readonly examples: readonly ExampleRow[]; readonly rpcAbout?: string; readonly p95Ms?: number;
}

/** The operation and its rpc, from one spec. Every refusal's error is declared by the rpc, as the build requires. */
export const make = (s: Spec) => {
  const errors = [...new Map([error_NOT_AUTHENTICATED, ...s.refusals.map((r) => r.error)].map((e) => [e.id, e])).values()];
  const cls: Cls = s.cls ?? (s.kind === "query" ? "read" : "write");
  const rpc = defineRpc({
    id: s.rpc, title: s.title, about: s.rpcAbout ?? s.about, concept: concept_devnet, kind: s.kind, who: s.who, input: s.input, output: s.output, errors,
    reads: s.reads ?? [], writes: s.writes ?? [], drives: s.drives ?? [], invokes: [], emits: [], calls: s.calls ?? [], chain: [], spans: [`rpc.${s.rpc}`],
    budget: s.p95Ms ? { class: cls, p50Ms: Math.round(s.p95Ms / 3), p95Ms: s.p95Ms, why: "An estimate from the spike's measured times (docs/design/worlds-platform.md, Numbers); the first hosted-world eval measures it." } : budget(cls),
    was: [DOC],
  } as never);
  const op = defineOperation({
    id: s.id, title: s.title, area: "devnet", command: s.command, priority: s.priority ?? "normal", implementedBy: rpc as never, examples: s.examples as never, about: s.about, who: s.who, changes: s.changes,
    acceptance: s.claims, returns: s.output, errors: [error_CLI_USAGE], refusals: s.refusals, budget: budget(cls), notes: [],
  } as never);
  return { rpc, op };
};

// ── view shapes ─────────────────────────────────────────────────────────────────────────────

export const Site = Schema.Struct({ company: S, url: S });
export const SeatView = Schema.Struct({ seat: S, company: S, hat: S, kind: Null(SeatKind), holder: Null(S), agentModel: Null(S), state: Schema.Literals(["open", "filled", "dropped"]) });
export const ConnectionView = Schema.Struct({ worldId: S, address: S, siteSuffix: S, keyAddress: S, role: GrantRole, seat: Null(S), expiresAt: N });
export const GrantView = Schema.Struct({ worldId: S, keyAddress: S, role: GrantRole, seat: Null(S), via: S, expiresAt: Null(N), revoked: B });
export const InvitationView = Schema.Struct({ invitationId: S, worldId: S, role: GrantRole, seat: Null(S), boundAddress: Null(S), uses: N, maxUses: N, expiresAt: N, revoked: B });
export const RunView = Schema.Struct({
  runId: S, scenario: S, state: RunState, profile: WorldProfile, cohortId: Null(S), seed: N, clockMode: ClockMode, worldNow: N, address: S, seats: Schema.Array(SeatView), sites: Schema.Array(Site), recordHead: N,
});
export const ScenarioView = Schema.Struct({ scenario: S, name: S, version: N, profile: WorldProfile, template: S, companies: N, seats: N, manifestHash: S, publishedAt: N });
export const CheckLine = Schema.Struct({ id: S, passed: B, detail: S });

/** A person-sized well-formed address and a hash, for examples. */
export const ADDR = {
  organiser: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", tester1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", tester2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  safe1: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", stranger: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
} as const;
export const addressOf = (world: string) => `https://core-${world}.${BASE}`;
export const siteOf = (company: string, world: string) => `https://${company}-${world}.${BASE}`;
