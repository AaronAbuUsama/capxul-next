#!/usr/bin/env node
// Once at world birth, before authority/clock services start. Never mine a retained stopped world.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const url = new URL(process.env.RPC_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("History preparation requires loopback Anvil");
const deploymentFile = process.env.DEPLOYMENT_FILE;
const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
async function rpc(method, params = []) {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const reply = await response.json();
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}
if (!/^anvil/i.test(await rpc("web3_clientVersion")) || Number(await rpc("eth_chainId")) !== 84532) {
  throw new Error("History preparation requires the seeded development Anvil chain 84532");
}
async function history() {
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const number = Number(head.number);
  const older = number >= 90 ? await rpc("eth_getBlockByNumber", [`0x${(number - 90).toString(16)}`, false]) : null;
  return { number, valid: older !== null && Number(head.timestamp) - Number(older.timestamp) >= 180 };
}
const before = await history();
let mined = 0;
if (!before.valid) {
  if (existsSync(join(dirname(deploymentFile), "clock.json"))) {
    throw new Error("Retained world lacks Ponder history; refusing to advance its clock. Prepare a fresh world before authority starts");
  }
  mined = Number(deployment.deployedBlock) + 200 - before.number;
  if (!Number.isSafeInteger(mined) || mined < 1 || mined > 200) {
    throw new Error("World birth history is inconsistent with deployment; refusing automatic mining");
  }
  await rpc("anvil_setBlockTimestampInterval", [2]);
  await rpc("anvil_mine", [`0x${mined.toString(16)}`]);
}
const after = await history();
if (!after.valid) throw new Error("Ponder needs an available head-minus-90 block at least 180 seconds older than head");
console.log(JSON.stringify({ ponderHistory: "ready", before: before.number, after: after.number, mined }));
