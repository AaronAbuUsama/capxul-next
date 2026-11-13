// A local Core's workerd configuration (src/local/workerd.ts): Core's modules embedded by a path relative to the file,
// every fact bound under the name a deploy uses, the database as a Hyperdrive binding to its bridge, the chain as a
// service of the forwarder, and every text quoted so no value can end its string.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CORE_ENV } from "@capxul/core";
import * as Redacted from "effect/Redacted";
import { configOf } from "../src/local/workerd.ts";
import { LOCAL_CORE_LABEL } from "../src/local/host.ts";
import { passedOr } from "../src/record.ts";

const config = configOf(
  {
    stage: "w-town",
    port: 41000,
    bundle: {
      directory: "/tmp/run/bundle",
      modules: ["worker.js", "Stream-abc.js"],
      compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] },
    },
    database: { port: 42000, database: "neondb", user: Redacted.make("owner"), password: Redacted.make('p"a\\ss') },
    chainPort: 43000,
    env: { [CORE_ENV.world]: "town", [CORE_ENV.doorToken]: Redacted.make("door-token") },
  },
  "bundle",
);

test("Core's modules are embedded relative to the configuration, the entry first", () => {
  assert.match(config, /\(name = "worker\.js", esModule = embed "bundle\/worker\.js"\),\n\s+\(name = "Stream-abc\.js"/);
  assert.ok(!config.includes("/tmp/run/bundle"));
});

test("the world's facts and secrets are bound as text under the names a deploy uses", () => {
  assert.ok(config.includes(`(name = "${CORE_ENV.world}", text = "town")`));
  assert.ok(config.includes(`(name = "${CORE_ENV.doorToken}", text = "door-token")`));
});

test("the database is a Hyperdrive binding to its bridge, and the chain a service of the forwarder", () => {
  assert.ok(config.includes(`(name = "database", external = (address = "127.0.0.1:42000", tcp = ()))`));
  assert.ok(config.includes(`(name = "chain", external = (address = "127.0.0.1:43000", http = ()))`));
  assert.ok(config.includes(`(name = "${CORE_ENV.chain}", service = "chain")`));
  assert.ok(config.includes(`hyperdrive = (designator = "database", database = "neondb", user = "owner"`));
  assert.ok(config.includes('password = "p\\"a\\\\ss"'), "a quote and a backslash are escaped");
  assert.ok(config.includes(`address = "127.0.0.1:41000"`));
});

test("a run with a local Core is at best rehearsed, never passed", () => {
  assert.equal(passedOr(undefined), "passed");
  assert.equal(passedOr(LOCAL_CORE_LABEL), "rehearsed");
  assert.match(LOCAL_CORE_LABEL, /Not the proof/);
});
