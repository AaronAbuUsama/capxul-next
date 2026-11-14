// Core's migrations are named so that two slices adding tables at once cannot take the same file name (README,
// "Migrations"): after 0005, a file is `NNNN_<domain>.sql` or `NNNN_<domain>_<what>.sql`, its number the next after
// the highest on the branch it was cut from and its domain a blueprint domain (or `core`, for Core's own tables).
// Two domains may share a number: both migrators apply files in name order, and a migration depends only on lower
// numbers.
import { strict as assert } from "node:assert";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { domains } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { migrations } from "../src/door.ts";

/** The thin line's migrations, named before the rule. Never renamed: a world keeps the names it has applied. */
const BEFORE_THE_RULE = [
  "0001_telemetry.sql",
  "0002_site_ops.sql",
  "0003_world.sql",
  "0004_organizations.sql",
  "0005_approvals.sql",
];

test("every migration after 0005 is numbered and named after its domain", () => {
  const files = Arr.filter(readdirSync(fileURLToPath(migrations.href)), Str.endsWith(".sql"));
  const owners = [...Rec.keys(domains), "core"];
  for (const file of BEFORE_THE_RULE) assert.ok(files.includes(file), `${file} was renamed or removed`);
  for (const file of Arr.filter(files, (name) => !BEFORE_THE_RULE.includes(name))) {
    const named = /^(\d{4})_([a-z]+)(_[a-z0-9_]+)?\.sql$/.exec(file);
    assert.ok(named !== null, `${file} is not NNNN_<domain>.sql or NNNN_<domain>_<what>.sql`);
    assert.ok(Number(named[1]) > 5, `${file} takes a number of the thin line's`);
    assert.ok(owners.includes(named[2] ?? ""), `${file}: ${named[2]} is not a blueprint domain or core`);
  }
});
