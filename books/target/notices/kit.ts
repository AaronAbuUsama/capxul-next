// What every outbox notice workflow of this concept shares, so each area file says only what is its
// own: the transition it follows, what it reads and who it tells. Not records: a helper that builds
// workflow records, and the three steps every notice ends with (decision notices.first-attempt).
//
// This module is not in ./index.ts's `modules`: it defines no record of its own.

import { budget, defineWorkflow, type FunctionRef, type Ref, type TransitionRef } from "../../../packages/book/src/index.ts";
import { concept_notices } from "../shared/foundation.ts";
import { integration_chain_rpc, integration_mail } from "../shared/external.ts";
import { machine_notice, table_notices } from "./data.ts";

const n = machine_notice.t;

/** The steps every notice ends with, after it has read its subject and chosen its recipients. */
export const SEND_STEPS = [
  {
    name: "skip-recorded",
    about: "Drops each recipient whose row for this notice id exists already, so a redelivered transition sends nothing twice.",
  },
  {
    name: "send",
    about:
      "One `mail.send` per recipient: the template rendered from its facts, the notice id and recipient as the provider's idempotency key.",
  },
  {
    name: "record",
    about:
      "Each recipient's delivery record is born: `send` when taken, `hold` on PROVIDER_ERROR or RATE_LIMITED (the retry " +
      "process takes over), `refuse` on INVALID_INPUT.",
  },
] as const;

/** How an Organization is told, wherever a notice goes to one (decision notices.recipients). */
export const DIRECTORS =
  "An Organization is told through its Directors: the company Safe's owners now (`Safe.getOwners` through chain-rpc), " +
  "each to the principal at that Safe and its email (a Director is always a person: board.no-agent-directors).";

/** Who is told about a budget's money besides the Directors (notices.recipients; docs/design/authority.md, contradiction 11). */
export const WEARERS =
  "A notice about a budget's money also goes to whoever wears that budget's hat now, read from indexing's hat-wearers " +
  "when it is sent, each by their Seat's principal; the person who acted is told only while they still wear it.";

/** How a person is told, wherever a notice goes to one by their principal (decision notices.recipients). */
export const PERSON =
  "A person named by their principal is told at that principal's email; an agent has none and is told nothing.";

/** Per recipient, the notices row's key; the provider's idempotency key covers a send whose record was lost. */
export const IDEMPOTENCY =
  "Per recipient, `<template>:<the transition's outbox id>`, the key of its notices row: a rerun skips every recipient " +
  "already recorded, and a send lost before its record is repeated under the same provider idempotency key, taken once.";

/** One attempt per recipient at the class default; reads and the record retry on their own. */
const RETRIES = { max: 5, backoff: "exponential" } as const;

export interface NoticeSpec {
  readonly id: string;
  readonly title: string;
  readonly about: string;
  /** `normal` unless it follows a low-priority concept (equity: CONVENTIONS rule 4). */
  readonly priority?: "normal" | "low";
  readonly trigger: { readonly transition: TransitionRef };
  /** The source concept's tables and the directory reads that find the recipients and fill the facts. */
  readonly reads: readonly Ref<"table">[];
  /** The notice's own steps before SEND_STEPS: read the subject, choose the recipients, gather the facts. */
  readonly steps: readonly { readonly name: string; readonly about: string }[];
  /** Live chain state the facts need, read through chain-rpc (decision notices.chain-reads). */
  readonly chain?: readonly FunctionRef[];
  /** When some notice ids are not the transition's outbox id (a payer's, keyed by the command). */
  readonly idempotency?: string;
  readonly was: readonly string[];
}

/**
 * An outbox workflow that sends one kind of notice when its transition commits: it reads the subject,
 * picks the recipients, makes the first attempt for each and records it. A held notice's retries are
 * the retry process's (processes.ts).
 */
export const noticeWorkflow = (spec: NoticeSpec) =>
  defineWorkflow({
    id: spec.id,
    title: spec.title,
    about: spec.about,
    concept: concept_notices,
    priority: spec.priority ?? "normal",
    trigger: spec.trigger,
    steps: [...spec.steps, ...SEND_STEPS],
    reads: [...spec.reads, table_notices],
    writes: [table_notices],
    drives: [n.send, n.hold, n.refuse],
    invokes: [],
    emits: [],
    calls: [integration_mail.c.send, ...(spec.chain?.length ? [integration_chain_rpc.c.readContract] : [])],
    chain: [...(spec.chain ?? [])],
    idempotency: spec.idempotency ?? IDEMPOTENCY,
    timeoutMs: 300_000,
    retries: RETRIES,
    budget: budget("background"),
    was: [...spec.was],
  });
