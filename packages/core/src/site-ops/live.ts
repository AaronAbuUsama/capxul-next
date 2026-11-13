// The five operations of this part of Core, and what they run on: in a deployed Core, the world's database, its
// site door, its chain and its cast; in a test, all of it in memory.
import * as Layer from "effect/Layer";
import { chainTimeFromEnv } from "./chain-time.ts";
import { SqlCast } from "./cast.ts";
import { SqlWorldClock } from "./clock.ts";
import { docCreate, docSubmit, reportRun } from "./documents.ts";
import { SqlDocumentHashes } from "./hashes.ts";
import { PaymentApprovalsLive } from "../organizations/handlers.ts";
import { SqlWorldRecord } from "./record.ts";
import { CompanySitesLive } from "./sites.ts";
import { clockWarp, recordExport } from "./world.ts";

/** The handlers, by operation: `handlers.ts` names each in its group. */
export const siteOps = {
  "doc.create": docCreate,
  "doc.submit": docSubmit,
  "report.run": reportRun,
  "world.clock.warp": clockWarp,
  "record.export": recordExport,
} as const;

/**
 * What they run on in a deployed Core, from its environment. Needs a `SiteDoor`, Postgres (`PgClient`) and the
 * world's `CoreIdentity`. Payment approvals are approval.sign's (payments.ts), and need what it needs (`ChainOps`).
 */
export const siteOpsLive = (env: Record<string, unknown>) =>
  SqlCast.pipe(
    Layer.merge(SqlDocumentHashes),
    Layer.merge(CompanySitesLive),
    Layer.merge(chainTimeFromEnv(env)),
    Layer.merge(PaymentApprovalsLive),
    Layer.provideMerge(SqlWorldRecord),
    Layer.provideMerge(SqlWorldClock),
  );
