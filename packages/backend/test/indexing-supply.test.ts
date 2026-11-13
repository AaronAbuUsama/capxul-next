import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { keccak256, stringToHex, type Abi } from "viem";
import { connect } from "../../devnet/src/modules/chain/service.ts";
import { createCompany } from "../../devnet/src/modules/company/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("hat supply controls require a named disposable real Ponder/v4 world");

test("native Ponder retains hat uint32 supply range across the signed boundary", async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const installer = JSON.parse(await readFile(new URL("../../contracts/out/Installer.sol/Installer.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const limits = [2_147_483_647, 2_147_483_648, 4_294_967_295];
  const name = `Hat uint32 ${crypto.randomUUID()}`;
  const company = await createCompany({ chain, record, installerAbi: installer.abi as Abi }, {
    tierService: testKey("tierService").key, relayer: testKey("deployer").key, founder: testKey("founder").key,
  }, { founderEmail: "founder@core.test", company: name, token: fixture.token,
    officers: limits.map((maxSupply) => ({ details: `Supply ${maxSupply}`, maxSupply })),
    ceiling: 1_000_000_000n, topAmount: 1_000_000_000n, salt: keccak256(stringToHex(name)),
  });
  const ids = company.officerHats.map((id) => `0x${id.toString(16).padStart(64, "0")}`);
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await sql.connect();
  try {
    let rows: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 200; attempt++) {
      rows = (await sql.query("select hat_id,max_supply,supply from app.chain_hats where hat_id=any($1) order by max_supply", [ids])).rows;
      if (rows.length === limits.length) break;
      await setTimeout(100);
    }
    assert.deepEqual(rows.map((row) => row.max_supply), limits.map(String),
      "actual admitted officer hats must persist on both sides of int32 and at uint32 max");
    assert(rows.every((row) => row.supply === "0"), "bigint projection fields use decimal-string SQL representation");
  } finally { await sql.end(); }
});
