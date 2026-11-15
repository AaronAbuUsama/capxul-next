// The ratchet the typed-once rules share (src/rules/ratchet.ts), through capxul/declared-steps: a listed file holds its
// count, and a finding excused by a line override with its reason is not counted.
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import { declaredSteps } from "../src/rules/declared-steps.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const cwd = "/repo";
const tester = new RuleTester({ cwd, languageOptions: { sourceType: "module" } });
const at = (path: string) => ({ filename: `${cwd}/${path}` });
const OURS = at("packages/core/src/a.ts");

tester.run("declared-steps: the ratchet", declaredSteps({ "packages/core/src/a.ts": 1 }), {
  valid: [{ code: `const f = Effect.fn("x")(function* () {});`, ...OURS }],
  invalid: [
    {
      code: `const f = Effect.fn("x")(function* () {}); const g = Effect.fn("y")(function* () {});`,
      ...OURS,
      errors: [{ message: /must not grow/ }, { message: /must not grow/ }],
    },
    { code: `const f = 1;`, ...OURS, errors: [{ message: /lower it to 0/, line: 1 }] },
  ],
});

// A finding excused by a line override with its reason is not counted, in a listed file or not; without a reason, it
// is. oxlint's RuleTester does not apply disable comments, so an excused finding shows here as reported with its own
// message, outside the count; in `pnpm lint`, oxlint applies the override to it and it passes.
const OVERRIDDEN = `const f = Effect.fn("x")(function* () {});
// oxlint-disable-next-line capxul/declared-steps -- a reason
const g = Effect.fn("y")(function* () {});`;
const UNREASONED = `const f = Effect.fn("x")(function* () {});
const g = Effect.fn("y")(function* () {}); // oxlint-disable-line capxul/declared-steps`;
const excused = { message: /^Effect\.fn is named by a string: [^.]*$/, line: 3 };
const grows = { message: /must not grow/ };

tester.run("declared-steps: overrides and the ratchet", declaredSteps({ "packages/core/src/a.ts": 1 }), {
  valid: [],
  invalid: [
    { code: OVERRIDDEN, ...OURS, errors: [excused] },
    { code: UNREASONED, ...OURS, errors: [grows, grows] },
    { code: OVERRIDDEN, ...at("packages/core/src/b.ts"), errors: [{ message: /named by a string/ }, excused] },
  ],
});
