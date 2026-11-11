// The bottom layers: the system, its components and concepts, and the vocabulary of errors
// and events that everything above them uses.

import { Schema } from "effect";
import { AnySchema, Code, Common, Id, Line, make, Prose, Ref, Title } from "./base.ts";

// ── system ──────────────────────────────────────────────────────────────────────────────────

export const SystemSpec = Schema.Struct({
  ...Common,
  actors: Schema.Array(
    Schema.Struct({ id: Id, kind: Schema.Literals(["person", "agent", "system"]), about: Line }),
  ),
  surfaces: Schema.Array(Schema.Literals(["cli", "sdk", "react", "mcp", "http"])),
});
/** The boundary: who is outside, which surfaces they use. One per book. */
export const defineSystem = make("system")(SystemSpec);

// ── component: a running piece ──────────────────────────────────────────────────────────────

export const ComponentSpec = Schema.Struct({
  ...Common,
  /** Where it runs: `node`, `browser`, `ponder`, `anvil`, `postgres`. */
  runtime: Schema.String,
  exposes: Schema.Array(Schema.Literals(["rpc", "http", "ws", "cli", "sql", "none"])),
  dependsOn: Schema.Array(Ref("component")),
  budgets: Schema.optionalKey(
    Schema.Struct({
      startMs: Schema.optionalKey(Schema.Int),
      memoryMb: Schema.optionalKey(Schema.Int),
      lines: Schema.optionalKey(Schema.Int),
    }),
  ),
});
export const defineComponent = make("component")(ComponentSpec);
export type Component = ReturnType<typeof defineComponent>;

// ── concept: a domain module (ADR-0031) ─────────────────────────────────────────────────────

export const ConceptSpec = Schema.Struct({
  ...Common,
  component: Ref("component"),
  /** The only concepts whose tables it may read and whose operations it may compose. */
  dependsOn: Schema.Array(Ref("concept")),
  /** Non-test, non-generated lines. */
  lines: Schema.optionalKey(Schema.Int),
});
export const defineConcept = make("concept")(ConceptSpec);
export type Concept = ReturnType<typeof defineConcept>;

// ── error: one code ─────────────────────────────────────────────────────────────────────────

export const ErrorSpec = Schema.Struct({
  id: Code,
  title: Title,
  /** Derived class (ADR-0039): what happened. */
  class: Schema.Literals([
    "input",
    "auth",
    "permission",
    "state",
    "provider-unavailable",
    "provider-refused",
    "provider-answer",
    "defect",
  ]),
  /** Who must act next. */
  actor: Schema.Literals(["caller", "person", "operator", "system"]),
  /** The text a person reads, with `{field}` placeholders from the error's details. */
  message: Line,
  retryable: Schema.Boolean,
  /** The CLI's exit code for it. */
  exit: Schema.Int,
  was: Schema.optionalKey(Schema.Array(Schema.String)),
});
export const defineError = make("error")(ErrorSpec);
export type ErrorRecord = ReturnType<typeof defineError>;

// ── event: one product event ────────────────────────────────────────────────────────────────

export const EventSpec = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/))),
  about: Prose,
  /** Its properties, beyond the envelope (trace_id, actor, organization, environment). */
  props: AnySchema,
  was: Schema.optionalKey(Schema.Array(Schema.String)),
});
export const defineEvent = make("event")(EventSpec);
export type EventRecord = ReturnType<typeof defineEvent>;
