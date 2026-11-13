// The facts each starting world hands a scenario (decisions.md, 38): what the steps that made it answered, which the
// scenario could not learn otherwise (an approval's digest, a document's hash, the call that made the world), the
// operators' names, and every call made in making it. A world's facts are its parent's and its own steps'. The
// maker of the world keeps them encoded, as JSON values, and a scenario decodes them with `given`. Each world has one
// example, built from the operations' own examples, which the tests decode with its schema.
import * as Schema from "effect/Schema";
import * as Approvals from "../approvals/operations.ts";
import { Collected, Sent } from "../approvals/operations.ts";
import * as Documents from "../documents/operations.ts";
import { Founded } from "../organizations/operations.ts";
import * as Organizations from "../organizations/operations.ts";
import { Json, OperatorName, OperatorRole, PersonId, TraceId, WorldName, WorldView } from "../values.ts";
import { exampleWorld } from "../world/example.ts";
import * as World from "../world/operations.ts";

/** One call through a door made in making a starting world, as its maker made and saw it. */
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
  grant: Organizations.memberGrant.rpc.successSchema,
  grantCollected: Collected,
  grantSent: Sent,
};
const created = Documents.create.rpc.successSchema;
const paymentDrafted = {
  ...officeHolder,
  supplier: created,
  invoice: created,
  invoicePosted: Documents.Posted,
  payment: created,
};
const paymentHeld = { ...paymentDrafted, held: Documents.Held };
const paid = { ...paymentHeld, paidSent: Sent };
const snapshot = World.snapshotSave.rpc.successSchema;
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

/** The success of an operation's example, by the example's place: the operations' own examples. */
const exampleOf = (operation: { readonly examples: ReadonlyArray<{ readonly success: unknown }> }, index: number) =>
  operation.examples[index]?.success ?? null;

const nothingExample = { operators: { first: "ci", second: "amp-7" }, calls: [] };
const freshExample = { ...nothingExample, world: exampleWorld };
const foundedExample = {
  ...freshExample,
  founded: exampleOf(Organizations.create, 0),
  setupCollected: exampleOf(Approvals.sign, 0),
  setupSent: exampleOf(Approvals.sign, 1),
};
const officeHolderExample = {
  ...foundedExample,
  grant: exampleOf(Organizations.memberGrant, 0),
  grantCollected: exampleOf(Approvals.sign, 0),
  grantSent: exampleOf(Approvals.sign, 1),
};
const document = exampleOf(Documents.create, 0);
const paymentDraftedExample = {
  ...officeHolderExample,
  supplier: document,
  invoice: document,
  invoicePosted: exampleOf(Documents.submit, 0),
  payment: document,
};
const paymentHeldExample = { ...paymentDraftedExample, held: exampleOf(Documents.submit, 1) };
const paidExample = { ...paymentHeldExample, paidSent: exampleOf(Approvals.sign, 1) };
const withSnapshotExample = {
  ...paidExample,
  m3: exampleOf(World.snapshotSave, 0),
  draft: exampleOf(World.snapshotSave, 0),
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
  restored: { ...withSnapshotExample, restored: exampleOf(World.snapshotRestore, 0) },
};
