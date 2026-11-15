// A wait for a company's site ends at once when world.show lists it stopped: a site door that restarted while making
// it leaves it stopped for good, and a wait of ten minutes then only hides why (world run 43759314286, 15 November 2026).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { siteStopped, until } from "../src/worlds/company.ts";

const view = (state: string) => ({ companies: [{ org: "org-1", site: { state } }] });

test("a stopped site names why; a site being made or ready, or another company's, does not", () => {
  assert.ok(Option.isSome(siteStopped("org-1")(view("stopped"))));
  assert.ok(Option.isNone(siteStopped("org-1")(view("creating"))));
  assert.ok(Option.isNone(siteStopped("org-1")(view("ready"))));
  assert.ok(Option.isNone(siteStopped("org-2")(view("stopped"))));
});

test("a wait ends at the first poll that says stopped, failing with why", () => {
  const { error, polls } = Effect.runSync(
    Effect.gen(function* () {
      const count = yield* Ref.make(0);
      const poll = Effect.as(
        Ref.update(count, (n) => n + 1),
        view("stopped"),
      );
      const refused = yield* Effect.flip(
        until("the site", poll, (each) => each.companies[0]?.site.state === "ready", siteStopped("org-1")),
      );
      return { error: refused, polls: yield* Ref.get(count) };
    }),
  );
  assert.equal(polls, 1);
  assert.match(error.message, /^stopped waiting for the site: /);
});

test("a wait that is done succeeds", () => {
  const exit = until("the site", Effect.succeed(view("ready")), () => true, siteStopped("org-1")).pipe(
    Effect.exit,
    Effect.runSync,
  );
  assert.ok(Exit.isSuccess(exit));
});
