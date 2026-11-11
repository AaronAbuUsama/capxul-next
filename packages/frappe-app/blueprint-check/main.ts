// node --experimental-strip-types packages/frappe-app/blueprint-check/main.ts          → compares the blueprint with the site app
// node --experimental-strip-types packages/frappe-app/blueprint-check/main.ts --json   → the same as one JSON document
//
// Reads every DocType JSON under capxul/capxul/doctype, and setup.py's CUSTOM_FIELDS and DEFAULT_HAT_ROLES (through
// read_setup.py, which reads the source and never imports Frappe), and the blueprint's `doctype` and `role` records.
// Exits 1 on any difference: the blueprint and the code must agree before a merge.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { records } from "../../../blueprint/index.ts";
import { compareSite, type Code, type DoctypeJson, type DoctypeRecord, type RoleRecord } from "./compare.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "../capxul");
const json = process.argv.includes("--json");

const stop = (message: string): never => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`frappe:check-blueprint: ${message}`);
  process.exit(1);
};

const dir = join(APP, "capxul/doctype");
const doctypes = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
  .map((e) => JSON.parse(readFileSync(join(dir, e.name, `${e.name}.json`), "utf8")) as DoctypeJson);

const py = spawnSync("python3", [join(HERE, "read_setup.py"), join(APP, "setup.py")], { encoding: "utf8" });
if (py.status !== 0) stop(`could not read setup.py: ${py.error?.message ?? py.stderr}`);
const setup = JSON.parse(py.stdout) as { DEFAULT_HAT_ROLES?: Code["hatRoles"]; CUSTOM_FIELDS?: Code["customFields"] };
if (!setup.DEFAULT_HAT_ROLES || !setup.CUSTOM_FIELDS) stop("setup.py no longer defines DEFAULT_HAT_ROLES and CUSTOM_FIELDS as literals");

type Rec = { _kind: string };
const all = records as unknown as Rec[];
const report = compareSite(
  {
    doctypes: all.filter((r) => r._kind === "doctype") as unknown as DoctypeRecord[],
    roles: all.filter((r) => r._kind === "role") as unknown as RoleRecord[],
  },
  { doctypes, customFields: setup.CUSTOM_FIELDS!, hatRoles: setup.DEFAULT_HAT_ROLES! },
);
const ok = report.failures.length === 0;
if (json) console.log(JSON.stringify({ ok, ...report }, null, 2));
else {
  const c = report.compared;
  console.log(`frappe:check-blueprint: compared ${c.doctypes} DocTypes (${c.fields} fields) and ${c.roles} hats of the site app with the blueprint's records`);
  if (ok) console.log("0 differences.");
  else {
    console.log(`\n${report.failures.length} difference${report.failures.length === 1 ? "" : "s"}:`);
    for (const f of report.failures) console.log(`  - ${f}`);
    console.log("\nThe blueprint changes first: change the record (with a decision when it is a judgment), then the code, until they agree.");
  }
}
process.exit(ok ? 0 : 1);
