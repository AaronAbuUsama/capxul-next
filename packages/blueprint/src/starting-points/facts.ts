// The facts each starting world hands a scenario: what the steps that made it answered, which
// the scenario could not learn otherwise (an approval's digest, a document's hash, the call that made the world), the
// operators' names, and every call made in making it. A world's facts are its parent's and its own steps'. The
// maker of the world keeps them encoded, as JSON values, and a scenario decodes them with `given`. Each world has one
// example, built from the examples the verbs use, which the tests decode with its schema.
//
// It imports the things' values and examples, never their verbs: a verb's promises name the starting points, so a
// verb imported here would be a cycle. What a verb answers that a starting point keeps is declared in its thing's
// values.ts, and its example in the thing's examples.ts, which the verb's own examples use.
import * as Schema from "effect/Schema";
import { Json, OperatorName, OperatorRole, PersonId, TraceId, WorldName, WorldView } from "../common/values.ts";
import { booksCollected, paymentSent } from "../things/approval/examples.ts";
import { Collected, Sent } from "../things/approval/values.ts";
import { approval, northwindFounded } from "../things/company/examples.ts";
import { Founded } from "../things/company/values.ts";
import { heldPayment, postedInvoice, supplierCreated } from "../things/document/examples.ts";
import { Created, Held, Posted } from "../things/document/values.ts";
import { GrantProposed } from "../things/member/values.ts";
import { restoredWorld, saved } from "../things/snapshot/examples.ts";
import { Snapshot } from "../things/snapshot/values.ts";
import { exampleWorld } from "../things/world/examples.ts";

/** One call through a door made in making a starting world, as its maker made and saw it. */
/** sam's Manage books, as `org.member.grant`'s first example proposes it, and as the starting points record it. */
export const samBooksGrant: typeof GrantProposed.Type = {
  change: { id: "chg_books1", member: "sam", permission: "manage-books", state: "proposed" },
  proposal: { id: "prp_books1", nonce: 1, threshold: 2 },
  approvals: [approval("apr_books1", "dana", 1), approval("apr_books2", "eli", 2)],
};

export const MadeCall = Schema.Struct({
  operation: Schema.String,
  /** The world whose door it went through, or for a platform operation the world it named. */
  world: WorldName,
  operator: OperatorRole,
  as: Schema.NullOr(PersonId),
  /** The trace it was sent under: the record holds its events under this id. */
  trace: TraceId,
  payload: Json,
  outcome: Schema.Literals(["success", "refusal"]),
  /** The success or the refusal, encoded. */
  answer: Json,
});

const nothing = {
  /** The names the platform gives the two operators' credentials. The scenario calls as `first` unless it asks. */
  operators: Schema.Struct({ first: OperatorName, second: OperatorName }),
  /** Every call made in making the world, in order, the ancestors' first. Empty for `nothing`. */
  calls: Schema.Array(MadeCall),
};
const quotaFull = { ...nothing, filled: Schema.Array(WorldView) };
/**
 * `world`: the world the steps ran in, as the call that made it answered: `world.create`'s, or for a world restored
 * from its template, `world.snapshot.restore`'s.
 */
const fresh = { ...nothing, world: WorldView };
const founded = { ...fresh, founded: Founded, setupCollected: Collected, setupSent: Sent };
const officeHolder = {
  ...founded,
  grant: GrantProposed,
  grantCollected: Collected,
  grantSent: Sent,
};
const created = Created;
const paymentDrafted = {
  ...officeHolder,
  supplier: created,
  invoice: created,
  invoicePosted: Posted,
  payment: created,
};
const paymentHeld = { ...paymentDrafted, held: Held };
const paid = { ...paymentHeld, paidSent: Sent };
const snapshot = Snapshot;
const withSnapshot = { ...paid, m3: snapshot, draft: snapshot };
/** `restored`: the second world, which the scenario runs in; `world` is still the first. */
const restored = { ...withSnapshot, restored: WorldView };

/** Each starting world's facts, by the name its declaration uses. */
export const facts = {
  nothing: Schema.Struct(nothing),
  quotaFull: Schema.Struct(quotaFull),
  fresh: Schema.Struct(fresh),
  founded: Schema.Struct(founded),
  officeHolder: Schema.Struct(officeHolder),
  paymentDrafted: Schema.Struct(paymentDrafted),
  paymentHeld: Schema.Struct(paymentHeld),
  paid: Schema.Struct(paid),
  withSnapshot: Schema.Struct(withSnapshot),
  restored: Schema.Struct(restored),
} as const;

const nothingExample = { operators: { first: "ci", second: "amp-7" }, calls: [] };
const freshExample = { ...nothingExample, world: exampleWorld };
const foundedExample = {
  ...freshExample,
  founded: northwindFounded,
  setupCollected: booksCollected,
  setupSent: paymentSent,
};
const officeHolderExample = {
  ...foundedExample,
  grant: samBooksGrant,
  grantCollected: booksCollected,
  grantSent: paymentSent,
};
const document = supplierCreated;
const paymentDraftedExample = {
  ...officeHolderExample,
  supplier: document,
  invoice: document,
  invoicePosted: postedInvoice,
  payment: document,
};
const paymentHeldExample = { ...paymentDraftedExample, held: heldPayment };
const paidExample = { ...paymentHeldExample, paidSent: paymentSent };
const withSnapshotExample = {
  ...paidExample,
  m3: saved,
  draft: saved,
};

/** One example of each starting world's facts, as a scenario is handed them, by the same names as `facts`. */
export const examples: { readonly [Name in keyof typeof facts]: unknown } = {
  nothing: nothingExample,
  quotaFull: { ...nothingExample, filled: [exampleWorld] },
  fresh: freshExample,
  founded: foundedExample,
  officeHolder: officeHolderExample,
  paymentDrafted: paymentDraftedExample,
  paymentHeld: paymentHeldExample,
  paid: paidExample,
  withSnapshot: withSnapshotExample,
  restored: { ...withSnapshotExample, restored: restoredWorld },
};
