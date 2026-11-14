// What the drift check forgives, and what it counts that Alchemy's own scan does not. Pure, so
// test/drift-policy.test.ts reads it; src/drift.ts applies it.
//
// 1. Fields a resource changes by itself. Alchemy's scan deep-equals a resource's live attributes with the ones its
//    last deploy recorded (alchemy src/Drift.ts), so a field that moves while nobody changes anything reads as drift.
//    SETTLES names, per resource type, a field and the values of it that are one and the same. Only those values are
//    forgiven: any other value of that field, and any other field, is still drift. An entry says where it was seen.
// 2. A deploy that did not finish. Alchemy skips a resource with a pending replacement or an unstable status and
//    leaves it to the next deploy; the scan then calls it neither drifted nor missing. Here it is drift: the stage is
//    not what the code says until that deploy has run (a replacement that failed on 14 November 2026 would have
//    passed the check).
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { isDeepStrictEqual } from "node:util";

export type Attributes = Readonly<Record<string, unknown>>;

/** Per resource type: a field, and the values of it that mean the same thing. */
export const SETTLES: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>> = {
  // An EBS volume is `available` until its attachment, another resource, attaches it, and `in-use` from then
  // (@alchemy.run/aws src/EC2/Volume.ts records `state`). The bench host's data disk, staging, 14 November 2026.
  "AWS.EC2.Volume": { state: ["available", "in-use"] },
};

const SAME = "(settles)";

/** The attributes with every value that settles replaced by one marker, so two of them compare equal. */
const settled = (resourceType: string, attributes: Attributes): Attributes => {
  const fields = SETTLES[resourceType] ?? {};
  return Rec.map(attributes, (value, field) =>
    typeof value === "string" && Arr.contains(fields[field] ?? [], value) ? SAME : value,
  );
};

/**
 * The fields in which a resource's live attributes differ from its recorded ones, values that settle aside: their
 * names only, as the report shows them (a value may be a secret). None means it has not drifted.
 */
export const differingFields = (
  resourceType: string,
  recorded: Attributes,
  live: Attributes,
): ReadonlyArray<string> => {
  const before = settled(resourceType, recorded);
  const after = settled(resourceType, live);
  const fields = Arr.dedupe([...Rec.keys(before), ...Rec.keys(after)]);
  return Arr.filter(fields, (field) => !isDeepStrictEqual(before[field], after[field]));
};

/** Whether Alchemy skipped a resource because a deploy did not finish (alchemy src/Drift.ts, its two reasons). */
export const unfinished = (reason: string | undefined): boolean =>
  reason !== undefined && (Str.includes("pending replacement")(reason) || Str.includes("is not stable")(reason));
