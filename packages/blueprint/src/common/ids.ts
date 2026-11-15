// The ids of the things a world holds, each with its prefix. Declared here, apart from values.ts, so that a thing's
// approval subjects (`subjects` in src/things/<thing>/values.ts) can use them. values.ts exports each; import them
// from there.
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
/** A proposed budget, by the id `org.budget.create` answered: the subject its Directors' approvals authorise. */
export const BudgetCreationId = pattern(/^bcr_[a-z0-9]{6,40}$/);
