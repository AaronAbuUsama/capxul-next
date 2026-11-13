// The values the operations share: names, ids, times, money, approvals and the view of a world. Each is declared
// here once and imported wherever it is used. Nothing here reaches outside itself.
import * as Schema from "effect/Schema";

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

/** A world's name: lower case, 2 to 15 characters, a letter first. The same rule as `packages/world`. */
export const WorldName = pattern(/^[a-z][a-z0-9-]{0,13}[a-z0-9]$/);
/** A snapshot's name within its world. */
export const SnapshotName = pattern(/^[a-z0-9][a-z0-9-]{0,30}$/);
/** Who operates worlds on the platform: a person's or an agent's name, such as `ci` or `amp-7`. */
export const OperatorName = pattern(/^[a-z][a-z0-9-]{0,39}$/);
/** A person in a world, by the name the world's cast gives them, such as `dana`. */
export const PersonId = pattern(/^[a-z][a-z0-9-]{0,39}$/);

/** An instant as RFC 3339 in UTC, to the millisecond. World time or host time; each field says which. */
export const Instant = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
/** A position in a world's record. The first entry is 1. */
export const Seq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Address = pattern(/^0x[0-9a-fA-F]{40}$/);
export const Hash = pattern(/^0x[0-9a-f]{64}$/);
/** A 65-byte secp256k1 signature, as hex. */
export const Signature = pattern(/^0x[0-9a-f]{130}$/);

export const OrgId = pattern(/^org_[a-z0-9]{6,40}$/);
export const OrgHandle = pattern(/^[a-z][a-z0-9-]{1,30}$/);
export const ApprovalId = pattern(/^apr_[a-z0-9]{6,40}$/);
export const ProposalId = pattern(/^prp_[a-z0-9]{6,40}$/);
export const ChangeId = pattern(/^chg_[a-z0-9]{6,40}$/);
export const PaymentRequestId = pattern(/^req_[a-z0-9]{6,40}$/);

/** The assets a world's chain carries. */
export const Asset = Schema.Literals(["USDC"]);
/** An amount as a decimal string with at most 6 places, so that no amount is ever a binary fraction. */
export const Amount = pattern(/^(0|[1-9]\d*)(\.\d{1,6})?$/);
export const Money = Schema.Struct({ asset: Asset, amount: Amount });

export const Grade = Schema.Literals(["private", "shared", "real"]);
export const ClockMode = Schema.Literals(["frozen", "running"]);
export const Clock = Schema.Struct({ mode: ClockMode, /** World time. */ now: Instant });

/** Where a world made from a snapshot came from. */
export const Parent = Schema.Struct({ world: WorldName, snapshot: SnapshotName, recordSeq: Seq });

/** The permissions a member is granted. Each is an officer hat on the company's chain. */
export const Permission = Schema.Literals(["manage-books", "issue-invoices", "manage-people"]);

/**
 * One signature that is asked for. Its signer signs `digest` with their key and gives the signature to
 * `approval.sign`. Several approvals may share one digest (the Directors of one proposal).
 */
export const Approval = Schema.Struct({
  id: ApprovalId,
  signer: PersonId,
  /** The address the signature must recover. */
  signerAddress: Address,
  digest: Hash,
  /** World time. */
  expiresAt: Instant,
});

/** What an approval authorises, once enough of its kind are signed. */
export const Subject = Schema.Struct({
  kind: Schema.Literals(["org_setup", "officer_change", "payment"]),
  id: Schema.String,
});

/** A person of a world's cast, made with the world. Their key is the chain's well-known test key for `signer`. */
export const CastMember = Schema.Struct({
  person: PersonId,
  email: Schema.String,
  signer: Address,
  /** Their claimed personal Safe; null for a person who has not finished signing up. */
  safe: Schema.NullOr(Address),
});

export const Company = Schema.Struct({
  org: OrgId,
  handle: OrgHandle,
  name: Schema.String,
  site: Schema.Struct({ state: Schema.Literals(["creating", "ready", "stopped"]), url: Schema.NullOr(Schema.String) }),
});

/** What `world.create`, `world.show` and `world.snapshot.restore` answer: one world as it is now. */
export const WorldView = Schema.Struct({
  world: WorldName,
  owner: OperatorName,
  grade: Grade,
  /** "parked": kept after its run, its compute stopped until its expiry. */
  state: Schema.Literals(["running", "parked"]),
  /** Host time. The world and everything it made are deleted at this instant. */
  expiresAt: Instant,
  /** The world's door: every operation of a world, and its chain's JSON-RPC, are reached here. */
  door: Schema.String,
  chainId: Schema.Int,
  clock: Clock,
  recordHead: Seq,
  parent: Schema.NullOr(Parent),
  cast: Schema.Array(CastMember),
  companies: Schema.Array(Company),
});

/** Any JSON value, typed as such. Never a string to be parsed later. */
export const Json = Schema.Json;
/** Named JSON values: a document's fields, a report's filters, one row of a report. */
export const Fields = Schema.Record(Schema.String, Schema.Json);
