// What the package exports, named: the proof that moving the blueprint into its things (docs/design/blueprint.md,
// part 13, stage 2a) changed no name. Each list was read from the package before the move (15 November 2026) and
// may change only with a declaration: a new verb, event or refusal adds its name here in the same pull request, and a
// rename runs side by side by its ratchet. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Blueprint from "../src/index.ts";

const sorted = (items: Iterable<string>): Array<string> => Arr.sort(items, Order.String);

/** The names in a block of text, one word each. */
const named = (text: string): ReadonlyArray<string> => Arr.filter(Str.split(text, /\s+/), (word) => word !== "");

/** Every name the door exports. */
const TOP = named(`
  Approvals Board Budgets CHAIN_PATH CHAIN_READ_METHODS CREDENTIAL_HEADER Caller Cast Chain CurrentCall CurrentCaller
  CurrentOperator Documents Errors Machine MadeCall Organizations PERSON_HEADER PLATFORM_PATH People PlatformRpcs
  PlatformSignIn Record Reports Site TRACE_HEADER Telemetry Values WORLD_PATH World WorldRpcs WorldSignIn allClaims
  declaredNames domains eventNamesOf glossary holdsFactsOf isRefusal machines operations outcome
  ratchets refusalsOf roles servedBy startingWorlds undecided unmigrated verb
  Conventions Datasets Envelope Metrics Pipeline Producers StepKinds Watch
`);

/** Every name each namespace the door exports holds. */
const NAMESPACES: { readonly [namespace: string]: ReadonlyArray<string> } = {
  Approvals: named(`
    AlreadySent ApprovalLanded ApprovalSigned Collected Sent claims machines operations platformRpcs sign stateless
    worldRpcs
  `),
  Board: named(`
    BoardAction BoardChange BoardChangeProposed Director Seats claims directorAdd directorList machines operations
    platformRpcs stateless thresholdSet worldRpcs
  `),
  Budgets: named(`
    Allowance Budget BudgetId BudgetName BudgetProposed Period claims create list machines operations platformRpcs
    show stateless worldRpcs
  `),
  Chain: named(`
    BudgetCreated CompanySafeMinted FUNCTIONS HatMaxSupplyChanged LOG_EVENTS Log LogName OtherLog PaymentSent
    Transfer TransferSingle UserOperationEvent eventOf reads
  `),
  Documents: named(`
    DocCreated DocSubmitted Held PaymentHeld Posted claims create machines operations platformRpcs stateless submit
    worldRpcs
  `),
  Errors: named(`
    AlreadyADirector AlreadyAMember AlreadyHeld AlreadyInvited ApprovalClosed ApprovalExpired ApprovalNotFound
    BoardChangeWaiting BudgetNotFound CannotChangeBoard CannotManagePeople ChangeWaiting ClockBackwards
    ClockBeforeSeed ExceedsParent ExpiryBeyondSource ExportNotAllowed FounderNotReady FoundingChanged GradeNotOffered
    HandleTaken InsufficientBalance InvitationClosed InvitationNotFound MemberHasNoSafe NoSiteUser NotADirector
    NotADraft NotAMember NotImplemented NotSignedIn NotWorldOwner NotYourApproval NotYourInvitation OrgNotFound
    PayloadRejected PersonNotFound SetupUnfinished SignatureInvalid SiteRefused SiteUnavailable SnapshotExists
    SnapshotInUse SnapshotNotFound ThresholdTooHigh ThresholdUnchanged TransactionReverted WorldExists WorldNotFound
    WorldQuotaReached exitCode refusals
  `),
  Machine: named(`
    madeBy make named
  `),
  Organizations: named(`
    Founded OfficerChangeProposed OrgFounded ProposalOpened Resumed claims create machines memberGrant operations
    platformRpcs stateless worldRpcs
  `),
  People: named(`
    Accepted AlreadyAccepted ClosedState Email Invitation InvitationAccepted InvitationDeclined InvitationId
    InvitationState InvitedRole Member MemberInvited MemberRefusalRule MemberRole RefusalRule claims invitationAccept
    invitationDecline invitationList invitationSend machines memberList operations platformRpcs stateless worldRpcs
  `),
  Record: named(`
    Entry claims exportRecord machines operations platformRpcs stateless worldRpcs
  `),
  Pipeline: named(`
    CallCheck CheckLayer CheckName ClusterRefusal ItemCount JourneyName JourneyStep LeftBehind MakeFallback Measure NotCounted
    PointStep PreparePart RatchetName Rung RunId RunPart Shard ShardCount SiteOrigin StageName StartingPointName TakeRefusal
    Trusted checkCall checkConfirm checkGate checkIsolation checkWatch clusterDown clusterShow clusterUp journeyRun ratchetCount
    runPrepare runStart runTeardown runVerdict siteMake siteReset siteSave siteTake startingPointMake work worldDestroy
    worldRenew worldReset worldSweep
  `),
  Reports: named(`
    claims machines operations platformRpcs run stateless worldRpcs
  `),
  Site: named(`
    BRIGHTSIDE DAILY_JOB DOCTYPES FILTERS INVOICE_AMOUNT PAYEE_ADDRESS REPORTS ROW_FIELDS SAFE_ACCOUNT_PREFIX
    SUPPLIER_FIELDS invoiceFields paymentFields supplierFields
  `),
  Values: named(`
    Address Amount Approval ApprovalId Asset BoardChangeId BudgetCreationId CAST_KEYS CastMember ChainContracts
    ChangeId Clock ClockMode Company Fields Grade Hash HatId Instant Json Money OFFICER_HAT_DETAILS OperatorName
    OperatorRole OrgHandle OrgId Parent PaymentRequestId Permission PersonId ProposalId Seq Signature SmallUint
    SnapshotName SolidityBool SolidityString SolidityValues Subject TraceId Uint WorldName WorldView roles
  `),
  World: named(`
    ClockWarped ListedSnapshot ListedWorld Snapshot SnapshotDeleted SnapshotSaved WORLD_LIMITS WorldCreated claims
    clockWarp create list machines operations platformRpcs show snapshotDelete snapshotList snapshotRestore
    snapshotSave stateless worldRpcs
  `),
};

/** Every operation, in the order of `operations`. */
const OPERATIONS = named(`
  org.create org.member.grant invitation.send invitation.list invitation.accept invitation.decline member.list
  org.director.list org.director.add org.threshold.set org.budget.create org.budget.show org.budget.list doc.create
  doc.submit approval.sign report.run world.create world.clock.warp world.snapshot.save world.snapshot.restore
  world.show world.list world.snapshot.list world.snapshot.delete record.export
`);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

test("the door exports exactly the names it exported before the move", () => {
  assert.deepEqual(sorted(Rec.keys(Blueprint)), sorted(TOP));
});

test("each namespace holds exactly the names it held before the move", () => {
  const door: Readonly<Record<string, unknown>> = Blueprint;
  for (const [name, names] of Rec.toEntries(NAMESPACES)) {
    const namespace = door[name];
    assert.ok(isRecord(namespace), `${name} is no namespace`);
    assert.deepEqual(sorted(Rec.keys(namespace)), sorted(names), name);
  }
});

test("the operations are the same, in the same order", () => {
  assert.deepEqual(Rec.keys(Blueprint.operations), OPERATIONS);
});
