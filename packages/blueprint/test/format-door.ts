// What the 3.10 checks read of the toolkit's door and the blueprint's door that is not there yet (docs/roadmap.md,
// item 3.10; docs/design/blueprint.md, part 13's amendment). Each is read by name at run time, not imported, so the
// checks compile today and fail with the name they need instead of failing the package's types. Once the builder has
// added a name, a check may import it directly. Not a test of its own: the *.test.ts files beside it use it.
import { strict as assert } from "node:assert";
import * as Tools from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Blueprint from "../src/index.ts";

/** The toolkit's door, as a record of names. */
export const toolkit: { readonly [name: string]: unknown } = { ...Tools };

/** The blueprint's door, as a record of names. */
export const blueprint: { readonly [name: string]: unknown } = { ...Blueprint };

/** The value the toolkit's door exports as `name`, failing with `why` when it exports none. */
export const fromToolkit = (name: string, why: string): unknown => {
  assert.ok(name in toolkit, `@capxul/blueprint-tools exports no \`${name}\`: ${why}`);
  return toolkit[name];
};

/** The function the toolkit's door exports as `name`, failing with `why` when it exports none. */
export const functionFromToolkit = (name: string, why: string): ((...args: ReadonlyArray<unknown>) => unknown) => {
  const found = fromToolkit(name, why);
  assert.ok(Predicate.isFunction(found), `@capxul/blueprint-tools exports \`${name}\`, but not as a function`);
  return (...args) => Reflect.apply(found, undefined, args);
};

/** What the toolkit says a declaration is (`kindOf`): "verb", "refusal", "event", or null for anything else. */
export const kindOf = (value: unknown): unknown =>
  functionFromToolkit(
    "kindOf",
    "the constructors verb(...), refusal(...) and event(...) each brand what they make, and kindOf(value) reads the brand: " +
      '"verb", "refusal", "event", or null (docs/design/blueprint.md, part 13, amendment, point 2)',
  )(value);

/** The field `field` of `value`, or undefined. */
export const field = (value: unknown, name: string): unknown =>
  Predicate.hasProperty(value, name) ? value[name] : undefined;

/** The items of `value` when it is an array; fails naming `what` otherwise. */
export const arrayOf = (value: unknown, what: string): ReadonlyArray<unknown> => {
  assert.ok(Arr.isArray(value), `${what} is not an array`);
  return value;
};

/** `value` as a record of names; fails naming `what` when it is not an object. */
export const recordOf = (value: unknown, what: string): { readonly [name: string]: unknown } => {
  assert.ok(Predicate.isObject(value) && !Arr.isArray(value), `${what} is not a record`);
  return { ...value };
};
