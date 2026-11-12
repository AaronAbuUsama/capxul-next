// What Capxul talks to outside itself: vendor and chain integrations, and on-chain contracts.

import { Schema } from "effect";
import { Common, Id, Line, make, Ms, Prose, Ref, Retry } from "./base.ts";

// ── integration: an outside system behind an Effect service ─────────────────────────────────

const CallSpec = Schema.Struct({
  about: Line,
  timeoutMs: Ms,
  retries: Retry,
  p95Ms: Schema.optionalKey(Ms),
  /** Every way it fails, each mapped to the error a caller sees. */
  failures: Schema.Array(Schema.Struct({ key: Schema.optionalKey(Id), when: Line, error: Ref("error") })),
});

export const IntegrationSpec = Schema.Struct({
  ...Common,
  /** The component that hosts the service. */
  component: Ref("component"),
  /** The outside system: `alchemy`, `bridge`, `resend`, `openfort`, `posthog`, `ponder`. */
  system: Schema.String,
  /** The Effect service tag. */
  service: Schema.String,
  calls: Schema.Record(Schema.String, CallSpec),
  /** The double the devnet uses, and what it can and cannot imitate. */
  fake: Prose,
  /** Secret names only. */
  secrets: Schema.Array(Schema.String),
});

export interface CallRef extends Ref<"call"> {
  readonly integration: string;
  readonly name: string;
}

const integration = make("integration")(IntegrationSpec);

/** `bridge.c.createTransfer` is what an operation or workflow names in `calls`. */
export const defineIntegration = <const T extends typeof IntegrationSpec.Type>(spec: T) => {
  const record = integration(spec);
  const c = Object.fromEntries(
    Object.keys(spec.calls).map((name) => [
      name,
      { _kind: "call", id: `${spec.id}.${name}`, integration: spec.id, name } satisfies CallRef,
    ]),
  ) as { readonly [N in keyof T["calls"] & string]: CallRef };
  return { ...record, c };
};
export type Integration = ReturnType<typeof defineIntegration>;

// ── contract: on-chain code ─────────────────────────────────────────────────────────────────

export const ContractSpec = Schema.Struct({
  ...Common,
  /**
   * Where the contract's code is (`packages/contracts/abi-check/main.ts` requires it of every record): `built` is in
   * `packages/contracts` and compared with its compiled ABI, `designed` is designed and not built, `third-party` is
   * someone else's code, deployed by the install and not compared.
   */
  code: Schema.optionalKey(Schema.Literals(["built", "designed", "third-party"])),
  /** For a `built` contract: its Solidity name in `packages/contracts/src`, the name of its compiled artifact. */
  artifact: Schema.optionalKey(Schema.String),
  /**
   * Deployed addresses by environment, for a contract at one fixed address on a real network. A devnet address is not kept
   * here: it comes from the deployment file the deploy tool writes (`packages/contracts/deployments/devnet.json`).
   */
  addresses: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  functions: Schema.Record(Schema.String, Schema.Struct({ signature: Schema.String, about: Line })),
  events: Schema.Record(Schema.String, Schema.Struct({ signature: Schema.String, about: Line })),
  /** The custom errors the contract reverts with: the refusals an operation depends on. */
  errors: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ signature: Schema.String, about: Line }))),
});

export interface FunctionRef extends Ref<"function"> {
  readonly contract: string;
  readonly name: string;
}
export interface ChainEventRef extends Ref<"chainEvent"> {
  readonly contract: string;
  readonly name: string;
}

const contract = make("contract")(ContractSpec);

/** `payments.f.send` goes in an operation's `chain`; `payments.e.Sent` in a workflow's trigger. */
export const defineContract = <const T extends typeof ContractSpec.Type>(spec: T) => {
  const record = contract(spec);
  const f = Object.fromEntries(
    Object.keys(spec.functions).map((name) => [
      name,
      { _kind: "function", id: `${spec.id}.${name}`, contract: spec.id, name } satisfies FunctionRef,
    ]),
  ) as { readonly [N in keyof T["functions"] & string]: FunctionRef };
  const e = Object.fromEntries(
    Object.keys(spec.events).map((name) => [
      name,
      { _kind: "chainEvent", id: `${spec.id}.${name}`, contract: spec.id, name } satisfies ChainEventRef,
    ]),
  ) as { readonly [N in keyof T["events"] & string]: ChainEventRef };
  return { ...record, f, e };
};
export type Contract = ReturnType<typeof defineContract>;
