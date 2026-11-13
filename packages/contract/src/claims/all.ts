// Every operation's claims, in the journey's order. The type makes a missing operation a compile error.
import * as Approvals from "../approvals/claims.ts";
import * as Documents from "../documents/claims.ts";
import type { OperationName } from "../door.ts";
import * as Organizations from "../organizations/claims.ts";
import * as Record from "../record/claims.ts";
import * as Reports from "../reports/claims.ts";
import * as World from "../world/claims.ts";
import type { ClaimsOf } from "./claim.ts";

export const allClaims: { readonly [Name in OperationName]: ClaimsOf } = {
  "world.create": World.create,
  "org.create": Organizations.create,
  "org.member.grant": Organizations.memberGrant,
  "doc.create": Documents.create,
  "doc.submit": Documents.submit,
  "approval.sign": Approvals.sign,
  "report.run": Reports.run,
  "world.clock.warp": World.clockWarp,
  "record.export": Record.exportRecord,
  "world.snapshot.save": World.snapshotSave,
  "world.snapshot.restore": World.snapshotRestore,
  "world.show": World.show,
};
