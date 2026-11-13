// Every refusal of the contract, declared here once and imported by the operations that refuse with it. A refusal
// is a typed error that needs the world's state to decide; a payload of the wrong shape never reaches a handler
// (its schema rejects it). Each refusal carries what a caller needs to act on it, and nothing secret.
import * as Schema from "effect/Schema";
import {
  Address, Amount, ApprovalId, Asset, ChangeId, Grade, Hash, Instant, OperatorName, OrgHandle, OrgId, Permission, PersonId,
  SnapshotName, WorldName,
} from "./values.ts";

// Who is calling.

/** No caller could be established: no credential, or one this world or the platform does not know. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", {
  reason: Schema.Literals(["no_credential", "unknown_caller"]),
}) {}

/** Only the world's owner may do this; the caller is someone else (another operator, or a person of the world). */
export class NotWorldOwner extends Schema.TaggedError<NotWorldOwner>()("NotWorldOwner", { world: WorldName, owner: OperatorName }) {}

// Worlds and snapshots.

export class WorldNotFound extends Schema.TaggedError<WorldNotFound>()("WorldNotFound", { world: WorldName }) {}

/** The name is taken by a live world. Nothing about that world changes. */
export class WorldExists extends Schema.TaggedError<WorldExists>()("WorldExists", {
  world: WorldName,
  owner: OperatorName,
  expiresAt: Instant,
}) {}

/** This operation does not make a world of this grade. A real world is made only by the platform's own deploy. */
export class GradeNotOffered extends Schema.TaggedError<GradeNotOffered>()("GradeNotOffered", { grade: Grade }) {}

/** The owner already has as many live worlds as one owner may have. */
export class WorldQuotaReached extends Schema.TaggedError<WorldQuotaReached>()("WorldQuotaReached", {
  owner: OperatorName,
  live: Schema.Int,
  limit: Schema.Int,
}) {}

/** A world's clock cannot start before its seeded chain's last block. */
export class ClockBeforeSeed extends Schema.TaggedError<ClockBeforeSeed>()("ClockBeforeSeed", { asked: Instant, earliest: Instant }) {}

/** A world's clock only moves forward. */
export class ClockBackwards extends Schema.TaggedError<ClockBackwards>()("ClockBackwards", { now: Instant, asked: Instant }) {}

export class SnapshotExists extends Schema.TaggedError<SnapshotExists>()("SnapshotExists", { world: WorldName, snapshot: SnapshotName }) {}

export class SnapshotNotFound extends Schema.TaggedError<SnapshotNotFound>()("SnapshotNotFound", { world: WorldName, snapshot: SnapshotName }) {}

/** The snapshot's database was migrated by code whose migrations are not a prefix of the running code's. */
export class SnapshotIncompatible extends Schema.TaggedError<SnapshotIncompatible>()("SnapshotIncompatible", {
  snapshot: SnapshotName,
  saved: Schema.String,
  running: Schema.String,
}) {}

/** A world made from a snapshot cannot outlive the world the snapshot belongs to. */
export class ExpiryBeyondSource extends Schema.TaggedError<ExpiryBeyondSource>()("ExpiryBeyondSource", {
  source: WorldName,
  asked: Instant,
  latest: Instant,
}) {}

/** A real world's record is not exported until a rule for its owners' consent exists. */
export class ExportNotAllowed extends Schema.TaggedError<ExportNotAllowed>()("ExportNotAllowed", { grade: Grade }) {}

// People and companies.

export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()("PersonNotFound", { person: PersonId }) {}

export class OrgNotFound extends Schema.TaggedError<OrgNotFound>()("OrgNotFound", { org: OrgId }) {}

/** The founder has no claimed personal Safe, so no company Safe can be minted for them. */
export class FounderNotReady extends Schema.TaggedError<FounderNotReady>()("FounderNotReady", { person: PersonId }) {}

/** Another founder holds this handle. */
export class HandleTaken extends Schema.TaggedError<HandleTaken>()("HandleTaken", { handle: OrgHandle }) {}

/** The same founder began this handle with a different name, profile, board, members or capital. */
export class FoundingChanged extends Schema.TaggedError<FoundingChanged>()("FoundingChanged", { handle: OrgHandle, org: OrgId }) {}

/** The founder's earlier founding of another handle is not finished. */
export class SetupUnfinished extends Schema.TaggedError<SetupUnfinished>()("SetupUnfinished", { org: OrgId, handle: OrgHandle }) {}

export class NotADirector extends Schema.TaggedError<NotADirector>()("NotADirector", { org: OrgId, person: PersonId }) {}

export class NotAMember extends Schema.TaggedError<NotAMember>()("NotAMember", { org: OrgId, person: PersonId }) {}

/** The member's Safe already wears this permission's hat. */
export class AlreadyHeld extends Schema.TaggedError<AlreadyHeld>()("AlreadyHeld", { org: OrgId, person: PersonId, permission: Permission }) {}

/** A change to this member's permissions is still waiting for the Directors. */
export class ChangeWaiting extends Schema.TaggedError<ChangeWaiting>()("ChangeWaiting", { org: OrgId, person: PersonId, change: ChangeId }) {}

/** The member has no claimed personal Safe, so there is nothing to give a hat to. */
export class MemberHasNoSafe extends Schema.TaggedError<MemberHasNoSafe>()("MemberHasNoSafe", { org: OrgId, person: PersonId }) {}

export class InsufficientBalance extends Schema.TaggedError<InsufficientBalance>()("InsufficientBalance", {
  safe: Address,
  asset: Asset,
  balance: Amount,
  amount: Amount,
}) {}

// A company's site.

/** The caller has no user on the company's site: no hat of theirs made one. No call is ever run as another user. */
export class NoSiteUser extends Schema.TaggedError<NoSiteUser>()("NoSiteUser", { org: OrgId, person: PersonId }) {}

/** The site refused the call by its own rules. `target` is the doctype or the report. Nothing changed. */
export class SiteRefused extends Schema.TaggedError<SiteRefused>()("SiteRefused", {
  org: OrgId,
  target: Schema.String,
  reason: Schema.Literals(["permission", "validation", "not_found", "part_off"]),
  message: Schema.String,
}) {}

/** The company's site cannot take calls now. */
export class SiteUnavailable extends Schema.TaggedError<SiteUnavailable>()("SiteUnavailable", {
  org: OrgId,
  state: Schema.Literals(["creating", "stopped", "unreachable"]),
}) {}

export class NotADraft extends Schema.TaggedError<NotADraft>()("NotADraft", { doctype: Schema.String, name: Schema.String, docstatus: Schema.Int }) {}

// Approvals.

export class ApprovalNotFound extends Schema.TaggedError<ApprovalNotFound>()("ApprovalNotFound", { approval: ApprovalId }) {}

/** The approval asks another person to sign. */
export class NotYourApproval extends Schema.TaggedError<NotYourApproval>()("NotYourApproval", { approval: ApprovalId, signer: PersonId }) {}

/** The signature does not recover the approval's signer. Both addresses are named. */
export class SignatureInvalid extends Schema.TaggedError<SignatureInvalid>()("SignatureInvalid", {
  approval: ApprovalId,
  expected: Address,
  recovered: Address,
}) {}

export class ApprovalExpired extends Schema.TaggedError<ApprovalExpired>()("ApprovalExpired", { approval: ApprovalId, expiredAt: Instant }) {}

/** The approval ended without being sent. */
export class ApprovalClosed extends Schema.TaggedError<ApprovalClosed>()("ApprovalClosed", {
  approval: ApprovalId,
  state: Schema.Literals(["declined", "withdrawn", "displaced"]),
}) {}

/** The transaction was sent and the chain reverted it. Nothing moved. */
export class TransactionReverted extends Schema.TaggedError<TransactionReverted>()("TransactionReverted", {
  approval: ApprovalId,
  transaction: Hash,
  reason: Schema.String,
}) {}

/** Every refusal, by its tag. The tests read this to prove no tag is declared twice. */
export const refusals = {
  NotSignedIn, NotWorldOwner, WorldNotFound, WorldExists, GradeNotOffered, WorldQuotaReached, ClockBeforeSeed, ClockBackwards,
  SnapshotExists, SnapshotNotFound, SnapshotIncompatible, ExpiryBeyondSource, ExportNotAllowed, PersonNotFound, OrgNotFound,
  FounderNotReady, HandleTaken, FoundingChanged, SetupUnfinished, NotADirector, NotAMember, AlreadyHeld, ChangeWaiting,
  MemberHasNoSafe, InsufficientBalance, NoSiteUser, SiteRefused, SiteUnavailable, NotADraft, ApprovalNotFound, NotYourApproval,
  SignatureInvalid, ApprovalExpired, ApprovalClosed, TransactionReverted,
} as const;

export type RefusalTag = keyof typeof refusals;

/**
 * The command line's exit code for each refusal: 2 the request cannot be done as asked, 3 not signed in, 4 not
 * allowed, 5 something outside failed, 6 a limit or a switch. Declared here so the CLI never invents one.
 */
export const exitCode: { readonly [Tag in RefusalTag]: 2 | 3 | 4 | 5 | 6 } = {
  NotSignedIn: 3, NotWorldOwner: 4, WorldNotFound: 2, WorldExists: 2, GradeNotOffered: 4, WorldQuotaReached: 6,
  ClockBeforeSeed: 2, ClockBackwards: 2, SnapshotExists: 2, SnapshotNotFound: 2, SnapshotIncompatible: 2,
  ExpiryBeyondSource: 2, ExportNotAllowed: 4, PersonNotFound: 2, OrgNotFound: 2, FounderNotReady: 2, HandleTaken: 2,
  FoundingChanged: 2, SetupUnfinished: 2, NotADirector: 4, NotAMember: 2, AlreadyHeld: 2, ChangeWaiting: 2,
  MemberHasNoSafe: 2, InsufficientBalance: 2, NoSiteUser: 4, SiteRefused: 2, SiteUnavailable: 5, NotADraft: 2,
  ApprovalNotFound: 2, NotYourApproval: 4, SignatureInvalid: 2, ApprovalExpired: 2, ApprovalClosed: 2,
  TransactionReverted: 5,
};
