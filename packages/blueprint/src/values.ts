// The values the operations share: names, ids, times, money, approvals and the view of a world. Each is declared
// here once (the ids in ids.ts, the approval subjects in their domains) and imported from here wherever it is used.
import * as Schema from "effect/Schema";
import * as Documents from "./documents/subjects.ts";
import { ApprovalId, OrgHandle, OrgId } from "./ids.ts";
import * as Organizations from "./organizations/subjects.ts";

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

/** A world's name: lower case, 2 to 15 characters, a letter first. The same rule as `packages/world`. */
export const WorldName = pattern(/^[a-z][a-z0-9-]{0,13}[a-z0-9]$/);
/** A snapshot's name within its world. */
export const SnapshotName = pattern(/^[a-z0-9][a-z0-9-]{0,30}$/);
/** Who operates worlds on the platform: a person's or an agent's name, such as `ci` or `amp-7`. */
export const OperatorName = pattern(/^[a-z][a-z0-9-]{0,39}$/);
/**
 * Which of the platform's two operators a call signs in as: the scenario's own (`first`) or the other one the
 * starting world `nothing` promises (`second`). Their names are facts of `nothing` (decisions.md, 37).
 */
export const OperatorRole = Schema.Literals(["first", "second"]);
/** A person in a world, by the name the world's cast gives them, such as `dana`. */
export const PersonId = pattern(/^[a-z][a-z0-9-]{0,39}$/);

/** An instant as RFC 3339 in UTC, to the millisecond. World time or host time; each field says which. */
export const Instant = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
/** A position in a world's record. The first entry is 1. */
export const Seq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Address = pattern(/^0x[0-9a-fA-F]{40}$/);
/** The trace id of one call: 32 lower-case hex digits, as `traceparent` carries it. */
export const TraceId = pattern(/^[0-9a-f]{32}$/);
/** A whole number of any size, such as a uint256 of the chain, as a decimal string. */
export const Uint = pattern(/^(0|[1-9]\d*)$/);
/** A hat of the Hats protocol, by its uint256 id. */
export const HatId = Uint;
export const Hash = pattern(/^0x[0-9a-f]{64}$/);
/** A 65-byte secp256k1 signature, as hex. */
export const Signature = pattern(/^0x[0-9a-f]{130}$/);

export { ApprovalId, ChangeId, OrgHandle, OrgId, PaymentRequestId, ProposalId } from "./ids.ts";

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
 * The officer hat of each permission, by the `details` its hat is created with when a company is founded. A hat is
 * known on the chain by these details (the Hats protocol's `viewHat`), so a claim can name it.
 */
export const OFFICER_HAT_DETAILS: { readonly [P in typeof Permission.Type]: string } = {
  "manage-books": "Books",
  "issue-invoices": "Invoices",
  "manage-people": "People",
};

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

/**
 * What an approval authorises, once enough of its kind are signed, named by the id the operation that asked for it
 * answered. Each domain whose operations ask for approvals declares its kinds in `src/<domain>/subjects.ts`: a
 * company's setup and an officer change (organizations), a held payment (documents).
 */
export const Subject = Schema.Union([...Organizations.subjects, ...Documents.subjects]);

/**
 * How a person of the cast signs (decisions.md, 42). Their keys are among the first `accounts` of the public test
 * mnemonic every Anvil chain starts with, each known by its address (`CastMember.signer`, `Approval.signerAddress`).
 * An approval's `digest` is signed as it is: raw secp256k1 over the 32 bytes, no message prefix, `v` 27 or 28.
 */
export const CAST_KEYS = {
  mnemonic: "test test test test test test test test test test test junk",
  accounts: 10,
  scheme: "secp256k1 over the digest, no prefix",
} as const;

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

/**
 * The contracts of a world's chain that the claims read, by their addresses on it: the world's deployment of
 * packages/contracts, the test USDC, the Hats protocol and the ERC-4337 entry point. Read through the door's chain
 * RPC with the chain reads (src/chain/reads.ts).
 */
export const ChainContracts = Schema.Struct({
  usdc: Address,
  hats: Address,
  payments: Address,
  entryPoint: Address,
  companySafeMinter: Address,
  /** The owner the minter derives every company Safe's address under (`companySafeAddressFor`'s `owner`). */
  companiesHouse: Address,
  /** The namespace the minter derives company Safes under (`companySafeAddressFor`'s `namespace`). */
  companyNamespace: Schema.String,
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
  /**
   * The world's door, as a base address: its operations answer at `WORLD_PATH` under it and its chain's JSON-RPC at
   * `CHAIN_PATH` (src/telemetry.ts). A call reaches another world by naming this door (`CallOptions.at`).
   */
  door: Schema.String,
  chainId: Schema.Int,
  contracts: ChainContracts,
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
