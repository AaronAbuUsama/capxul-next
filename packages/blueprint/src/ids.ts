// The ids of the things a world holds, each with its prefix. Declared here, apart from values.ts, so that a domain's
// approval subjects (`src/<domain>/subjects.ts`) can use them while values.ts gathers those subjects. values.ts
// exports each; import them from there.
import * as Schema from "effect/Schema";

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

export const OrgId = pattern(/^org_[a-z0-9]{6,40}$/);
export const OrgHandle = pattern(/^[a-z][a-z0-9-]{1,30}$/);
export const ApprovalId = pattern(/^apr_[a-z0-9]{6,40}$/);
export const ProposalId = pattern(/^prp_[a-z0-9]{6,40}$/);
export const ChangeId = pattern(/^chg_[a-z0-9]{6,40}$/);
/** A change to a company's Board, its Directors or its threshold (`org.director.add`, `org.threshold.set`). */
export const BoardChangeId = pattern(/^bch_[a-z0-9]{6,40}$/);
export const PaymentRequestId = pattern(/^req_[a-z0-9]{6,40}$/);
