// The bench's MariaDB settings (src/mariadb.ts): the table caches hold every table of the sites a bench serves
// together, against MariaDB's 400 definitions and 421 open tables for a site of 926 (spikes/site-speed).
import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as Str from "effect/String";
import { HOST_MEMORY_MIB, MARIADB_COMMAND, MARIADB_SETTINGS, SITES_KEPT, TABLES_PER_SITE } from "../src/mariadb.ts";

const MEASURED_TABLES = 926;
const MARIADB_DEFAULT_DEFINITIONS = 400;

test("the table caches hold every table of the sites kept, not MariaDB's 400", () => {
  assert.ok(TABLES_PER_SITE >= MEASURED_TABLES);
  const definitions = Number(MARIADB_SETTINGS["table-definition-cache"]);
  assert.ok(definitions >= MEASURED_TABLES * SITES_KEPT);
  assert.ok(definitions > MARIADB_DEFAULT_DEFINITIONS * 10);
  assert.ok(Number(MARIADB_SETTINGS["table-open-cache"]) >= MEASURED_TABLES * 5);
});

test("the buffer pool leaves most of the host's memory to the bench", () => {
  const pool = MARIADB_SETTINGS["innodb-buffer-pool-size"];
  assert.match(pool, /^\d+G$/);
  assert.ok(Number(Str.slice(0, -1)(pool)) * 1024 <= HOST_MEMORY_MIB / 4);
});

test("MariaDB is started with every setting, and Frappe's character set", () => {
  assert.deepEqual(MARIADB_COMMAND, [
    "--character-set-server=utf8mb4",
    "--collation-server=utf8mb4_unicode_ci",
    "--table-definition-cache=20000",
    "--table-open-cache=10000",
    "--innodb-buffer-pool-size=1G",
    "--skip-character-set-client-handshake",
  ]);
});
