// Disposable v4 fixture. Keys come from devnet's public Anvil fixtures, never Core's directory or app state.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeFunctionData, keccak256, parseAbi, stringToHex, type Abi, type Hex } from "viem";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { createCompany, createDepartment, grantHat, setBudget, board, AGENT_OWNER, ERC20, type Protocol } from "../../devnet/src/modules/company/service.ts";
import { THIRD_PARTY } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main") throw new Error("a named disposable world is required");
const dir = resolve(process.env.CORE_PROOF_DIR ?? "../../.amp/in/scratchpad/core-proof");
const contracts = new URL("../../contracts/", import.meta.url);
const artifact = async (file: string) => JSON.parse(await readFile(new URL(`out/${file}.sol/${file}.json`, contracts), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const record = JSON.parse(await readFile(new URL("deployments/devnet.json", contracts), "utf8"));
const chain = await connect(process.env.RPC_URL ?? "http://127.0.0.1:8545");
const start = await chain.client.getBlockNumber();
const deployer = testKey("deployer");
const token = await artifact("MockERC20");
const tx = await chain.walletFor(deployer.key).deployContract({ abi: token.abi, bytecode: token.bytecode.object, args: ["Core proof USD", "USDC", 6] });
const usdc = (await chain.client.waitForTransactionReceipt({ hash: tx })).contractAddress!;
const protocol: Protocol = { chain, record, installerAbi: (await artifact("Installer")).abi };
const companyName = `Core restart ${Date.now()}`;
const hash = (s: string) => keccak256(stringToHex(s));
const company = await createCompany(protocol, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
  founderEmail: "founder@core.test", company: companyName, token: usdc,
  officers: [{ details: "Finance", maxSupply: 2 }], ceiling: 1_000_000_000n, topAmount: 1_000_000_000n, salt: hash(companyName),
});
const hat = company.officerHats[0]!;
const department = await createDepartment(protocol, company, hat);
await grantHat(protocol, company, hat, testKey("second").address);
await setBudget(protocol, company, department, 600_000_000n);
await send(chain, { from: deployer.key, to: usdc, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [company.companySafe, 900_000_000n] }) });
const agentSigner = testKey("agent").address;
const agentTx = await board(protocol, company, [{ to: record.contracts.AgentOwner.address,
  data: encodeFunctionData({ abi: AGENT_OWNER, functionName: "create", args: [agentSigner, company.companySafe] }) }]);
const agentSafe = await chain.client.readContract({ address: record.contracts.AgentOwner.address, abi: AGENT_OWNER,
  functionName: "safeAddressFor", args: [agentSigner, company.companySafe] });
// A hat ruled by a module, as an Elections clone rules the Director hat: its eligibility and toggle answer every call
// with 64 bytes (runtime PUSH1 0x40 PUSH1 0 RETURN), so Hats reads them live and no event tracks its wearers.
const module = (await chain.client.waitForTransactionReceipt({ hash: await chain.walletFor(deployer.key).sendTransaction({
  data: "0x6005600c60003960056000f360406000f3" }) })).contractAddress!;
await board(protocol, company, [{ to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: parseAbi([
  "function createHat(uint256 admin,string details,uint32 maxSupply,address eligibility,address toggle,bool mutable_,string imageURI) returns (uint256)"]),
  functionName: "createHat", args: [company.boardTopHat, "Core module-ruled hat", 1, module, module, true, ""] }) }]);
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/deployment.json`, JSON.stringify({ chainId: chain.chainId, usdc, payments: record.contracts.Payments.address,
  budgets: record.contracts.Budgets.address, agreements: record.contracts.Agreements.address, agentOwner: record.contracts.AgentOwner.address,
  hats: THIRD_PARTY.hats, installer: record.contracts.Installer.address, companiesHouse: record.companiesHouse, deployedBlock: Number(start) }, null, 2));
await writeFile(`${dir}/fixture.json`, JSON.stringify({ disposable: true, world: process.env.CAPXUL_WORLD, slug: "core-proof", companyName, safe: company.companySafe, founderSafe: company.founderSafe, agentSafe, agentSigner, agentTx, token: usdc, hat: hat.toString(), department: department.toString(), moduleHatDetails: "Core module-ruled hat", startBlock: Number(start), documentHash: hash(`${companyName} supplier invoice`), deploymentFile: `${dir}/deployment.json` }, null, 2));
console.log(`Real v4 company, Finance hat, budget and 900 USDC funding seeded: ${dir}/fixture.json`);
