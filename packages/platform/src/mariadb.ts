// How the bench's MariaDB is started: its character set, and caches sized for many sites instead of MariaDB's
// defaults. Measured on the stand-in bench (records/site-speed, "Findings on the way"): a site of Frappe, ERPNext, HRMS
// and capxul has 926 tables, while MariaDB 11.8 keeps 400 table definitions and 421 open tables by default, so
// with a few sites the caches churn (Opened_table_definitions stood at 212,838 after the spike), every query of a
// site that was idle for a minute opens its tables' definitions again, and a table's UPDATE_TIME, which a reset in
// place would read to find what changed, is lost each time its definition leaves the cache.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { MACHINES, STAGING_BENCH } from "./machines.ts";

/** Tables of one site, measured (records/site-speed, Q2), with room for the apps' next migrations. */
export const TABLES_PER_SITE = 1000;

/** How many sites' tables stay defined at once: the sites a bench of the planned size serves busily together. */
export const SITES_KEPT = 20;

/** The bench host's memory, from its machine (machines.ts). */
export const HOST_MEMORY_MIB = MACHINES[STAGING_BENCH.host].memoryGib.value * 1024;

export const MARIADB_SETTINGS = {
  // Frappe's character set; the client's own choice is ignored so every connection writes utf8mb4.
  "character-set-server": "utf8mb4",
  "collation-server": "utf8mb4_unicode_ci",
  // Every table of SITES_KEPT sites. A definition is shared by every connection, and is a few KB each, so 20,000 is
  // tens of MB, not hundreds.
  "table-definition-cache": String(TABLES_PER_SITE * SITES_KEPT),
  // Open tables are per connection's use; Frappe's requests touch tens of tables each, and the scheduler's jobs of
  // every site a few hundred, so half the definitions is ample. MariaDB lowers it itself if the container's open
  // files limit is lower, and InnoDB's own open files follow it.
  "table-open-cache": String((TABLES_PER_SITE * SITES_KEPT) / 2),
  // 1 GiB of the host's 8 for InnoDB's pages, against the default 128 MiB: about ten sites' data (110 MiB each on
  // disk) stays in memory; with the bench's other processes at about 1 GiB at 30 sites (records/site-speed, Q6) the
  // host keeps more than 5 GiB free.
  "innodb-buffer-pool-size": "1G",
} as const;

/** MariaDB's command line: each setting as a flag, then the one switch that takes no value. */
export const MARIADB_COMMAND: ReadonlyArray<string> = [
  ...Arr.map(Rec.toEntries(MARIADB_SETTINGS), ([name, value]) => `--${name}=${value}`),
  "--skip-character-set-client-handshake",
];
