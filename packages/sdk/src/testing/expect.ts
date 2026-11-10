// A small `describe` / `it` / `expect` over node:test and node:assert, so the signing tests brought from the old
// repository (written for Vitest) run here as they were written, on the repository's one test runner.
// It covers only the matchers those tests use.

import assert from "node:assert/strict";
import { describe, it as nodeIt } from "node:test";

export { describe };

type Case = () => void | Promise<void>;
type Each = <T>(rows: readonly T[]) => (name: string, run: (row: T) => void | Promise<void>) => void;
export const it: typeof nodeIt & { each: Each } = Object.assign(
  (name: string, run: Case) => nodeIt(name, run),
  {
    each:
      <T>(rows: readonly T[]) =>
      (name: string, run: (row: T) => void | Promise<void>) => {
        for (const row of rows) nodeIt(name.replace("%s", String(row)), () => run(row));
      },
  },
) as typeof nodeIt & { each: Each };

function subset(actual: unknown, expected: unknown, path: string): void {
  if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${path} is not an object`);
    for (const [key, value] of Object.entries(expected)) {
      subset((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, path);
}

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: boolean, message: string) => assert.ok(negate ? !pass : pass, `${negate ? "not " : ""}${message}`);
  const own = (name: string) => actual !== null && typeof actual === "object" && Object.hasOwn(actual, name);
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `toBe ${String(expected)}, got ${String(actual)}`),
    toEqual: (expected: unknown) => {
      let pass = true;
      try {
        assert.deepStrictEqual(actual, expected);
      } catch {
        pass = false;
      }
      check(pass, `toEqual ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toMatch: (expected: RegExp) => check(expected.test(String(actual)), `toMatch ${expected}, got ${String(actual)}`),
    toHaveProperty: (name: string) => check(own(name), `toHaveProperty ${name}`),
    toMatchObject: (expected: unknown) => {
      let pass = true;
      try {
        subset(actual, expected, "value");
      } catch {
        pass = false;
      }
      check(pass, `toMatchObject ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toThrow: (expected?: RegExp) => {
      let thrown: unknown;
      try {
        (actual as () => unknown)();
      } catch (error) {
        thrown = error;
      }
      check(thrown !== undefined && (expected === undefined || expected.test(String((thrown as Error).message))), `toThrow ${expected ?? ""}`);
    },
  };
}

export function expect(actual: unknown) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    rejects: {
      toThrow: async (expected?: RegExp) => {
        if (expected === undefined) await assert.rejects(actual as Promise<unknown>);
        else await assert.rejects(actual as Promise<unknown>, (error: Error) => expected.test(error.message));
      },
    },
  };
}
