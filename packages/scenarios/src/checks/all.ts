// Every operation's checks, by name: one set each, written once. The compiler holds that every operation of the
// blueprint has its set.
import type { OperationName } from "@capxul/blueprint";
import { approvalSign } from "./approval-sign.ts";
import { docCreate } from "./doc-create.ts";
import { docSubmit } from "./doc-submit.ts";
import type { Checks } from "./format.ts";
import { orgCreate } from "./org-create.ts";
import { orgMemberGrant } from "./org-member-grant.ts";
import { recordExport } from "./record-export.ts";
import { reportRun } from "./report-run.ts";
import { worldClockWarp } from "./world-clock-warp.ts";
import { worldCreate } from "./world-create.ts";
import { worldShow } from "./world-show.ts";
import { worldSnapshotRestore } from "./world-snapshot-restore.ts";
import { worldSnapshotSave } from "./world-snapshot-save.ts";

export const operationChecks: { readonly [N in OperationName]: Checks<N> } = {
  "world.create": worldCreate,
  "world.show": worldShow,
  "world.snapshot.save": worldSnapshotSave,
  "world.snapshot.restore": worldSnapshotRestore,
  "world.clock.warp": worldClockWarp,
  "org.create": orgCreate,
  "org.member.grant": orgMemberGrant,
  "doc.create": docCreate,
  "doc.submit": docSubmit,
  "approval.sign": approvalSign,
  "report.run": reportRun,
  "record.export": recordExport,
};
