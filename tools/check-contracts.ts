// node --experimental-strip-types tools/check-contracts.ts           → compares the book's contract records with the code
// node --experimental-strip-types tools/check-contracts.ts --json    → the same as one JSON document (exits 1 on a failure too)
//
// The code is the truth for what exists. This reads the ABI of every contract in `packages/contracts` from the committed
// export (`packages/contracts/abi/abi.json`, made from a build by `pnpm contracts:export-abi`, so the check needs no 100 s
// build) and the book's records of kind `contract`, and fails with a list when, for a contract the book records as built:
//
// - a function, event or error in the code is not in the book, or one in the book is not in the code;
// - a signature differs: the name, the argument types and their order, the return types, the mutability, an event's
//   indexed arguments;
// - the book records a contract as built that the code does not have, or the code deploys one the book does not record.
//
// A difference may stand only where the book carries a decision that names it (`CONTRACT_ALLOWANCES`,
// books/target/shared/contracts.ts); those are printed too, so they stay visible. The export carries the hash of the contract
// source it was built from: when the source has moved on, the check fails and says to export again. Third-party contracts
// (Safe, Roles, Hats, ...) are not in this repository's code and are listed, not compared.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { records } from "../books/target/index.ts";
import { CONTRACT_ALLOWANCES } from "../books/target/shared/contracts.ts";
import { compareContracts, type BookContract, type CodeContract, type Report } from "./check-contracts/compare.ts";
import { sourceHash } from "./check-contracts/source-hash.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "packages/contracts");
const json = process.argv.includes("--json");

/** Contracts that no manifest line deploys because another contract creates them, and the creator (which the manifest deploys). */
const CREATED_BY: Readonly<Record<string, string>> = { Escrow: "EscrowFactory", EquityInstaller: "Installer" };

type Rec = { _kind: string; id: string; [k: string]: unknown };
const all = records as unknown as Rec[];

const stop = (message: string): never => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`check-contracts: ${message}`);
  process.exit(1);
};

const exportFile = join(PKG, "abi/abi.json");
if (!existsSync(exportFile)) stop("packages/contracts/abi/abi.json is missing: run `pnpm contracts:export-abi`");
const exported = JSON.parse(readFileSync(exportFile, "utf8")) as {
  sourceHash: string;
  contracts: Record<string, { kind: "contract" | "library"; abi: CodeContract["abi"] }>;
};
const nowHash = sourceHash(PKG);
if (exported.sourceHash !== nowHash)
  stop(
    "the contract source in packages/contracts has changed since packages/contracts/abi/abi.json was exported " +
      `(export ${exported.sourceHash.slice(0, 12)}, source ${nowHash.slice(0, 12)}): run \`pnpm contracts:export-abi\` and commit it`,
  );

const manifest = (JSON.parse(readFileSync(join(PKG, "deploy/manifest.json"), "utf8")) as { contracts: { name: string }[] }).contracts.map((c) => c.name);
for (const [made, maker] of Object.entries(CREATED_BY)) if (!manifest.includes(maker)) stop(`CREATED_BY says ${made} is created by ${maker}, which the manifest does not deploy`);
const deployed = [...manifest, ...Object.keys(CREATED_BY)];

const code: CodeContract[] = Object.entries(exported.contracts).map(([name, c]) => ({ name, kind: c.kind, abi: c.abi }));
const book = all
  .filter((r) => r._kind === "contract")
  .map((r) => r as unknown as BookContract);

const text = (d: Rec): string =>
  [
    d["title"], d["question"], d["chosen"], d["why"], d["source"],
    ...((d["options"] as { label: string; text: string }[]) ?? []).flatMap((o) => [o.label, o.text]),
    ...((d["affects"] as { _kind: string; id: string }[]) ?? []).map((a) => a.id),
  ].join("\n");
const decisions = Object.fromEntries(all.filter((r) => r._kind === "decision").map((d) => [d.id, text(d)]));

const report: Report = compareContracts({ book, code, deployed, allowances: CONTRACT_ALLOWANCES, decisions });
const ok = report.failures.length === 0;

if (json) {
  console.log(JSON.stringify({ ok, exportHash: exported.sourceHash, ...report }, null, 2));
} else {
  const c = report.compared;
  console.log(
    `check-contracts: compared ${c.contracts} contracts (${c.functions} functions, ${c.events} events, ${c.errors} errors) of the code with the book's records` +
      `; ${report.thirdParty.length} third-party records not compared (${report.thirdParty.join(", ")})`,
  );
  if (report.allowed.length > 0) {
    console.log(`\n${report.allowed.length} allowed difference${report.allowed.length === 1 ? "" : "s"} (each named by a decision):`);
    for (const a of report.allowed) console.log(`  ${a.decision}: ${a.message}`);
  }
  if (!ok) {
    console.log(`\n${report.failures.length} undeclared difference${report.failures.length === 1 ? "" : "s"}:`);
    for (const f of report.failures) console.log(`  - ${f.message}`);
    console.log("\nThe code is the truth: change the book's record (and add a decision), or run `pnpm contracts:export-abi` if the source moved on.");
  } else console.log("\n0 undeclared differences.");
}
process.exit(ok ? 0 : 1);
