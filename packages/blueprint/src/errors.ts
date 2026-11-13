// Every refusal of the contract, declared here once and imported by the operations that refuse with it. A refusal
// is a typed error that needs the world's state to decide; a payload of the wrong shape never reaches a handler
// (its schema rejects it). Each refusal carries what a caller needs to act on it, and nothing secret.
// The classes live in errors/, one file per part of the contract; this file gathers them.
import {
  NotSignedIn,
  NotWorldOwner,
  WorldNotFound,
  WorldExists,
  GradeNotOffered,
  WorldQuotaReached,
  ClockBeforeSeed,
  ClockBackwards,
  SnapshotExists,
  SnapshotNotFound,
  SnapshotIncompatible,
  ExpiryBeyondSource,
  ExportNotAllowed,
} from "./errors/worlds.ts";
import {
  PersonNotFound,
  OrgNotFound,
  FounderNotReady,
  HandleTaken,
  FoundingChanged,
  SetupUnfinished,
  NotADirector,
  NotAMember,
  AlreadyHeld,
  ChangeWaiting,
  MemberHasNoSafe,
  InsufficientBalance,
  NoSiteUser,
  SiteRefused,
  SiteUnavailable,
  NotADraft,
} from "./errors/companies.ts";
import {
  ApprovalNotFound,
  NotYourApproval,
  SignatureInvalid,
  ApprovalExpired,
  ApprovalClosed,
  TransactionReverted,
} from "./errors/approvals.ts";
import { NotImplemented } from "./errors/server.ts";

export * from "./errors/worlds.ts";
export * from "./errors/companies.ts";
export * from "./errors/approvals.ts";
export * from "./errors/server.ts";

/** Every refusal, by its tag. The tests read this to prove no tag is declared twice. */
export const refusals = {
  NotSignedIn,
  NotWorldOwner,
  WorldNotFound,
  WorldExists,
  GradeNotOffered,
  WorldQuotaReached,
  ClockBeforeSeed,
  ClockBackwards,
  SnapshotExists,
  SnapshotNotFound,
  SnapshotIncompatible,
  ExpiryBeyondSource,
  ExportNotAllowed,
  PersonNotFound,
  OrgNotFound,
  FounderNotReady,
  HandleTaken,
  FoundingChanged,
  SetupUnfinished,
  NotADirector,
  NotAMember,
  AlreadyHeld,
  ChangeWaiting,
  MemberHasNoSafe,
  InsufficientBalance,
  NoSiteUser,
  SiteRefused,
  SiteUnavailable,
  NotADraft,
  ApprovalNotFound,
  NotYourApproval,
  SignatureInvalid,
  ApprovalExpired,
  ApprovalClosed,
  TransactionReverted,
  NotImplemented,
} as const;

export type RefusalTag = keyof typeof refusals;

/**
 * The command line's exit code for each refusal: 2 the request cannot be done as asked, 3 not signed in, 4 not
 * allowed, 5 something outside failed, 6 a limit or a switch (`NotImplemented` is one: the operation is not switched on yet). Declared here so the CLI never invents one.
 */
export const exitCode: { readonly [Tag in RefusalTag]: 2 | 3 | 4 | 5 | 6 } = {
  NotSignedIn: 3,
  NotWorldOwner: 4,
  WorldNotFound: 2,
  WorldExists: 2,
  GradeNotOffered: 4,
  WorldQuotaReached: 6,
  ClockBeforeSeed: 2,
  ClockBackwards: 2,
  SnapshotExists: 2,
  SnapshotNotFound: 2,
  SnapshotIncompatible: 2,
  ExpiryBeyondSource: 2,
  ExportNotAllowed: 4,
  PersonNotFound: 2,
  OrgNotFound: 2,
  FounderNotReady: 2,
  HandleTaken: 2,
  FoundingChanged: 2,
  SetupUnfinished: 2,
  NotADirector: 4,
  NotAMember: 2,
  AlreadyHeld: 2,
  ChangeWaiting: 2,
  MemberHasNoSafe: 2,
  InsufficientBalance: 2,
  NoSiteUser: 4,
  SiteRefused: 2,
  SiteUnavailable: 5,
  NotADraft: 2,
  ApprovalNotFound: 2,
  NotYourApproval: 4,
  SignatureInvalid: 2,
  ApprovalExpired: 2,
  ApprovalClosed: 2,
  TransactionReverted: 5,
  NotImplemented: 6,
};
