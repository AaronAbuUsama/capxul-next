// The writes area: following one write to its end. Every write flow (flows.ts) prepares its write,
// has its approval signed, then subscribes here until the process that owns the write decides it.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_org_members } from "../organizations/data.ts";
import {
  table_equity_grants,
  table_equity_installs,
  table_equity_writes,
  table_fundraise_investments,
  table_fundraise_rounds,
  table_share_sales,
  table_votes,
} from "./data.ts";
import { OLD } from "./guards.ts";
import { Write, WriteRef } from "./shapes.ts";
import { Schema } from "effect";

export const rpc_equity_writes_watch = defineRpc({
  id: "equity.writes.watch",
  title: "Follow one write and its object until the chain decides it",
  about:
    "A live query over one write and the object it changes (the install, grant, round and investor, sale or vote, as " +
    "equity holds it): it pushes each change until the write is landed, failed or abandoned and its object has moved, " +
    "then ends. A landed write carries its transaction and, for one that paid, its PaymentSent id. An unknown write is " +
    "INVALID_INPUT; one the caller neither prepared nor may read (a member of the company, or the holder whose Safe " +
    "signs it) is ROLE_PERMISSION_DENIED. It serves `client.me.votes.ballot` and `client.org(orgId).votes.execution` too.",
  was: [`${OLD}/votes/operations/ballot.ts`, `${OLD}/votes/operations/execution.ts`, `${OLD}/equity/operations/transfer.ts`],
  concept: concept_equity,
  kind: "live",
  who: "Whoever prepared the write; a member of the company; the holder whose Safe signs it.",
  input: WriteRef,
  output: Schema.Struct({ write: Write, subject: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [
    table_principals,
    table_org_members,
    table_equity_writes,
    table_equity_installs,
    table_equity_grants,
    table_fundraise_rounds,
    table_fundraise_investments,
    table_share_sales,
    table_votes,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
});
