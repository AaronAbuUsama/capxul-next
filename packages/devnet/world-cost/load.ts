// Gives a world an honest history to index: N companies born on the real v4 contracts (claim, mint, install), each with
// a department, a hat granted, a budget set and P supplier payments with document hashes. Prints the token address and
// the block range it wrote, as JSON on the last line.
//   node --experimental-strip-types load.ts --rpc http://127.0.0.1:18545 --companies 20 --payments 10
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, keccak256, stringToHex, type Abi, type Hex } from "viem";

import { connect, send } from "../src/modules/chain/service.ts";
import { createCompany, createDepartment, ERC20, grantHat, pay, setBudget, type Protocol } from "../src/modules/company/service.ts";
import type { DeploymentRecord } from "../src/modules/protocol/types.ts";
import { testKey } from "../src/modules/test-keys/service.ts";

const { values } = parseArgs({ options: { rpc: { type: "string" }, companies: { type: "string", default: "10" }, payments: { type: "string", default: "10" }, token: { type: "string" }, tag: { type: "string", default: "w" } } });
const contracts = join(fileURLToPath(new URL(".", import.meta.url)), "../../contracts");
const UNIT = 1_000_000n;
const hash = (t: string): Hex => keccak256(stringToHex(t));

const chain = await connect(values.rpc as string);
const record = JSON.parse(await readFile(join(contracts, "deployments/devnet.json"), "utf8")) as DeploymentRecord;
const artifact = async (file: string, name: string) => JSON.parse(await readFile(join(contracts, "out", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const p: Protocol = { chain, record, installerAbi: (await artifact("Installer.sol", "Installer")).abi };
const deployer = testKey("deployer");
const first = await chain.client.getBlockNumber();

let token = values.token as Hex | undefined;
if (token === undefined) {
  const t = await artifact("MockERC20.sol", "MockERC20");
  const h = await chain.walletFor(deployer.key).deployContract({ abi: t.abi, bytecode: t.bytecode.object, args: ["Test USD", "TUSD", 6] });
  token = (await chain.client.waitForTransactionReceipt({ hash: h })).contractAddress as Hex;
}
const started = Date.now();
let payments = 0;
for (let i = 0; i < Number(values.companies); i++) {
  const name = `${values.tag}-co-${i}-${started}`;
  const c = await createCompany(p, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: `${name}@acme.test`, company: name, token, officers: [{ details: "Finance", maxSupply: 3 }],
    ceiling: 1_000_000n * UNIT, topAmount: 1_000_000n * UNIT, salt: hash(name),
  });
  await send(chain, { from: deployer.key, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [c.companySafe, 100_000n * UNIT] }) });
  const finance = c.officerHats[0] as bigint;
  const dept = await createDepartment(p, c, finance);
  const holder = testKey("second");
  await grantHat(p, c, finance, holder.address);
  await setBudget(p, c, dept, 50_000n * UNIT);
  for (let j = 0; j < Number(values.payments); j++) {
    const r = await pay(p, { key: holder.key, budget: dept, to: testKey("payee").address, amount: 1_000_000n + BigInt(j), kind: 1, documentHash: hash(`${name} inv ${j}`), jobNonce: hash(`${name} job ${j}`) });
    if (!r.ok) throw new Error(JSON.stringify(r));
    payments++;
  }
}
const last = await chain.client.getBlockNumber();
console.log(JSON.stringify({ token, firstBlock: Number(first), lastBlock: Number(last), companies: Number(values.companies), payments, seconds: (Date.now() - started) / 1000 }));
