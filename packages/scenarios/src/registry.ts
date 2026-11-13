// Every scenario the runner runs, in order. A scenario is registered by adding it here: nothing is found by walking
// the disk, so a scenario that is not listed does not run, and the compiler sees every one.
//
// The thin line's scenarios (roadmap step 1.5), one per claim of claims.md, grouped as the blueprint groups the
// operations: the platform's four, then the world's eight.
import { worldCreate1 } from "./world-create/claim-1.ts";
import { worldCreate2 } from "./world-create/claim-2.ts";
import { worldCreate3 } from "./world-create/claim-3.ts";
import { worldCreate4 } from "./world-create/claim-4.ts";
import { worldCreate5 } from "./world-create/claim-5.ts";
import { worldCreate6 } from "./world-create/claim-6.ts";
import { worldShow1 } from "./world-show/claim-1.ts";
import { worldShow2 } from "./world-show/claim-2.ts";
import { worldShow3 } from "./world-show/claim-3.ts";
import { worldSnapshotSave1 } from "./world-snapshot-save/claim-1.ts";
import { worldSnapshotSave2 } from "./world-snapshot-save/claim-2.ts";
import { worldSnapshotSave3 } from "./world-snapshot-save/claim-3.ts";
import { worldSnapshotRestore1 } from "./world-snapshot-restore/claim-1.ts";
import { worldSnapshotRestore2 } from "./world-snapshot-restore/claim-2.ts";
import { worldSnapshotRestore3 } from "./world-snapshot-restore/claim-3.ts";
import { worldSnapshotRestore4 } from "./world-snapshot-restore/claim-4.ts";
import { worldSnapshotRestore5 } from "./world-snapshot-restore/claim-5.ts";
import { orgCreate1 } from "./org-create/claim-1.ts";
import { orgCreate2 } from "./org-create/claim-2.ts";
import { orgCreate3 } from "./org-create/claim-3.ts";
import { orgCreate4 } from "./org-create/claim-4.ts";
import { orgCreate5 } from "./org-create/claim-5.ts";
import { orgCreate6 } from "./org-create/claim-6.ts";
import { orgCreate7 } from "./org-create/claim-7.ts";
import { orgMemberGrant1 } from "./org-member-grant/claim-1.ts";
import { orgMemberGrant2 } from "./org-member-grant/claim-2.ts";
import { orgMemberGrant3 } from "./org-member-grant/claim-3.ts";
import { orgMemberGrant4 } from "./org-member-grant/claim-4.ts";
import { orgMemberGrant5 } from "./org-member-grant/claim-5.ts";
import { orgMemberGrant6 } from "./org-member-grant/claim-6.ts";
import { orgMemberGrant7 } from "./org-member-grant/claim-7.ts";
import { docCreate1 } from "./doc-create/claim-1.ts";
import { docCreate2 } from "./doc-create/claim-2.ts";
import { docCreate3 } from "./doc-create/claim-3.ts";
import { docCreate4 } from "./doc-create/claim-4.ts";
import { docSubmit1 } from "./doc-submit/claim-1.ts";
import { docSubmit2 } from "./doc-submit/claim-2.ts";
import { docSubmit3 } from "./doc-submit/claim-3.ts";
import { docSubmit4 } from "./doc-submit/claim-4.ts";
import { approvalSign1 } from "./approval-sign/claim-1.ts";
import { approvalSign2 } from "./approval-sign/claim-2.ts";
import { approvalSign3 } from "./approval-sign/claim-3.ts";
import { approvalSign4 } from "./approval-sign/claim-4.ts";
import { approvalSign5 } from "./approval-sign/claim-5.ts";
import { reportRun1 } from "./report-run/claim-1.ts";
import { reportRun2 } from "./report-run/claim-2.ts";
import { reportRun3 } from "./report-run/claim-3.ts";
import { worldClockWarp1 } from "./world-clock-warp/claim-1.ts";
import { worldClockWarp2 } from "./world-clock-warp/claim-2.ts";
import { recordExport1 } from "./record-export/claim-1.ts";
import { recordExport2 } from "./record-export/claim-2.ts";
import { recordExport3 } from "./record-export/claim-3.ts";
import { recordExport4 } from "./record-export/claim-4.ts";
import { recordExport } from "./examples/record-export.ts";
import type { Scenario } from "./scenario.ts";

export const scenarios: ReadonlyArray<Scenario> = [
  worldCreate1,
  worldCreate2,
  worldCreate3,
  worldCreate4,
  worldCreate5,
  worldCreate6,
  worldShow1,
  worldShow2,
  worldShow3,
  worldSnapshotSave1,
  worldSnapshotSave2,
  worldSnapshotSave3,
  worldSnapshotRestore1,
  worldSnapshotRestore2,
  worldSnapshotRestore3,
  worldSnapshotRestore4,
  worldSnapshotRestore5,
  orgCreate1,
  orgCreate2,
  orgCreate3,
  orgCreate4,
  orgCreate5,
  orgCreate6,
  orgCreate7,
  orgMemberGrant1,
  orgMemberGrant2,
  orgMemberGrant3,
  orgMemberGrant4,
  orgMemberGrant5,
  orgMemberGrant6,
  orgMemberGrant7,
  docCreate1,
  docCreate2,
  docCreate3,
  docCreate4,
  docSubmit1,
  docSubmit2,
  docSubmit3,
  docSubmit4,
  approvalSign1,
  approvalSign2,
  approvalSign3,
  approvalSign4,
  approvalSign5,
  reportRun1,
  reportRun2,
  reportRun3,
  worldClockWarp1,
  worldClockWarp2,
  recordExport1,
  recordExport2,
  recordExport3,
  recordExport4,
  recordExport,
];
